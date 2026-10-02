const page = __PAGE__;
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const database=env=>{if(!env.DB)throw Error('Database unavailable');return env.DB;};
function truthy(value){return value===true||value===1||typeof value==='string'&&/^(true|1|yes)$/i.test(value.trim());}
function isHeartbeat(value){
 const queue=[value];
 while(queue.length){const current=queue.shift();if(!current||typeof current!=='object')continue;
  for(const [key,item] of Object.entries(current)){
   const normalized=key.toLowerCase().replace(/[^a-z]/g,'');
   if(normalized==='isheartbeat'&&truthy(item))return true;
   if(normalized==='heartbeat'&&(truthy(item)||item&&typeof item==='object'))return true;
   if(['event','eventtype','eventname','messagetype','type','name'].includes(normalized)&&typeof item==='string'&&/heartbeat/i.test(item))return true;
   if(item&&typeof item==='object')queue.push(item);
  }
 }
 return false;
}
function readerIdentity(value){
 const queue=[value];let fallback=null;
 while(queue.length){const current=queue.shift();if(!current||typeof current!=='object')continue;
  for(const [key,item] of Object.entries(current)){
   const normalized=key.toLowerCase().replace(/[^a-z]/g,'');
   if(typeof item==='string'&&item.trim()){
    if(['macaddress','readerid','serialnumber'].includes(normalized))return item.trim();
    if(['readername','hostname'].includes(normalized))fallback=item.trim();
   }else if(item&&typeof item==='object')queue.push(item);
  }
 }
 return fallback||'FX9600';
}
async function readBody(request){
 const reader=request.body?.getReader();if(!reader)throw Error('Empty body');
 const chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1000000){await reader.cancel();throw Error('Payload too large');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/api/reader/control'&&request.method==='GET'){
   const {results}=await database(env).prepare('SELECT reading,reader_seen,last_seen FROM writer_bridge WHERE id=1').all();const row=results[0],available=!!row&&typeof row.reading==='number'&&Date.now()-Date.parse(row.reader_seen)<10000&&Date.now()-Date.parse(row.last_seen)<10000;return json({ok:true,available,reading:available?row.reading===1:null});
  }
  if(url.pathname==='/api/reader/control'&&request.method==='POST'){
   if(!env.WRITE_BRIDGE_TOKEN)return json({error:'Reader bridge unavailable'},503);const body=await readBody(request);
   if(!body||typeof body.enabled!=='boolean'||!/^[a-z0-9-]{8,80}$/i.test(body.requestId||''))return json({error:'Invalid reading command'},422);
   const db=database(env),{results}=await db.prepare('SELECT reader_seen,last_seen FROM writer_bridge WHERE id=1').all();const row=results[0];if(!row||Date.now()-Date.parse(row.reader_seen)>=10000||Date.now()-Date.parse(row.last_seen)>=10000)return json({error:'Reader is unavailable'},503);
   const command={requestId:body.requestId,operation:'reading',enabled:body.enabled},payload=JSON.stringify(command);const {results:existing}=await db.prepare('SELECT payload FROM writer_commands WHERE request_id=?').bind(body.requestId).all();if(existing[0]&&existing[0].payload!==payload)return json({error:'Request ID already used'},409);
   await db.prepare("INSERT INTO writer_commands (request_id,created_at,status,payload) VALUES (?,?,'queued',?) ON CONFLICT(request_id) DO NOTHING").bind(body.requestId,new Date().toISOString(),payload).run();return json({requestId:body.requestId,status:'queued'},202);
  }
  if(url.pathname==='/api/write/config'&&request.method==='GET'){
   if(!env.WRITE_BRIDGE_TOKEN)return json({ok:true,available:false});
   const {results}=await database(env).prepare('SELECT last_seen FROM writer_bridge WHERE id=1').all();return json({ok:true,available:!!results[0]&&Date.now()-Date.parse(results[0].last_seen)<60000});
  }
  if(url.pathname==='/api/bridge/poll'&&request.method==='POST'){
   if(!env.WRITE_BRIDGE_TOKEN||request.headers.get('authorization')!=='Bearer '+env.WRITE_BRIDGE_TOKEN)return json({error:'Unauthorized'},401);
   const body=await readBody(request),db=database(env),now=new Date().toISOString();
   await db.prepare('INSERT INTO writer_bridge (id,last_seen) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen').bind(now).run();
   if(body.readerState&&typeof body.readerState.reading==='boolean'&&Number.isFinite(Date.parse(body.readerState.at)))await db.prepare('UPDATE writer_bridge SET reading=?,reader_seen=? WHERE id=1').bind(body.readerState.reading?1:0,body.readerState.at).run();
   if(body.result&&['success','failed','unknown'].includes(body.result.status))await db.prepare("UPDATE writer_commands SET status=?,result=? WHERE request_id=? AND status='running'").bind(body.result.status,JSON.stringify(body.result),body.result.requestId).run();
   const {results}=await db.prepare("UPDATE writer_commands SET status='running' WHERE request_id=(SELECT request_id FROM writer_commands WHERE status='queued' AND created_at>? ORDER BY created_at LIMIT 1) AND status='queued' RETURNING payload").bind(new Date(Date.now()-30000).toISOString()).all();
   return json({ok:true,command:results[0]?JSON.parse(results[0].payload):null});
  }
  if(url.pathname==='/api/write/result'&&request.method==='GET'){
   const {results}=await database(env).prepare('SELECT * FROM writer_commands WHERE request_id=?').bind(url.searchParams.get('requestId')||'').all();const row=results[0];if(!row)return json({error:'Request not found'},404);
   if(row.result)return json(JSON.parse(row.result));const p=JSON.parse(row.payload);return json({requestId:row.request_id,epc:p.epc,status:Date.now()-Date.parse(row.created_at)>300000?'unknown':row.status,verified:false});
  }
  if(url.pathname==='/api/write'&&request.method==='POST'){
   if(!env.WRITE_BRIDGE_TOKEN)return json({error:'Writer bridge is not configured'},503);
   const body=await readBody(request);
   if(!body||body.operation!=='write'||!['USER','EPC','TID','RESERVED'].includes(body.memoryBank)||!/^(?:[0-9a-f]{2})+$/i.test(body.epc||'')||!/^(?:[0-9a-f]{2})+$/i.test(body.dataHex||'')||body.dataHex.length>2048||body.lengthBytes!==body.dataHex.length/2||!Number.isSafeInteger(body.offsetBytes)||body.offsetBytes<0||body.offsetBytes%2)return json({error:'Invalid write request'},422);
   if(!/^[a-z0-9-]{8,80}$/i.test(body.requestId||''))return json({error:'Invalid request ID'},422);
   const db=database(env),saved=JSON.stringify(body);const {results:existing}=await db.prepare('SELECT payload FROM writer_commands WHERE request_id=?').bind(body.requestId).all();
   if(existing[0]&&existing[0].payload!==saved)return json({error:'Request ID already used'},409);
   await db.prepare("INSERT INTO writer_commands (request_id,created_at,status,payload) VALUES (?,?,'queued',?) ON CONFLICT(request_id) DO NOTHING").bind(body.requestId,new Date().toISOString(),saved).run();
   return json({requestId:body.requestId,epc:body.epc,status:'queued'},202);
  }
  if(url.pathname==='/rfid/events'){
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
   if(request.method==='GET')return json({ok:true,endpoint:'/rfid/events',method:'POST',storage:'enabled'});
   if(request.method!=='POST')return json({ok:false,error:'Method not allowed'},405);
   if(!(request.headers.get('content-type')||'').toLowerCase().includes('application/json'))return json({ok:false,error:'Expected application/json'},415);
   let body;try{body=await readBody(request);}catch(e){return json({ok:false,error:e.message},e.message==='Payload too large'?413:400);}
   if(!body||typeof body!=='object')return json({ok:false,error:'Expected JSON object or array'},422);
   const receivedAt=new Date().toISOString();
   const db=database(env),payload=JSON.stringify(body);
   const saved=await db.prepare('INSERT INTO reader_events (received_at,payload) VALUES (?,?)').bind(receivedAt,payload).run();
   if(isHeartbeat(body)){
    const readerKey=readerIdentity(body);
    await db.prepare('INSERT INTO reader_heartbeats (reader_key,received_at,previous_at,payload) VALUES (?,?,NULL,?) ON CONFLICT(reader_key) DO UPDATE SET previous_at=reader_heartbeats.received_at,received_at=excluded.received_at,payload=excluded.payload').bind(readerKey,receivedAt,payload).run();
   }
   return json({ok:true,received:Array.isArray(body)?body.length:1,id:saved.meta.last_row_id,receivedAt});
  }
  if(url.pathname==='/api/reader/status'&&request.method==='GET'){
   const {results}=await database(env).prepare('SELECT reader_key AS readerKey,received_at AS receivedAt,previous_at AS previousAt,payload FROM reader_heartbeats ORDER BY received_at DESC LIMIT 20').all();
   return json({ok:true,readers:results.map(row=>({...row,payload:JSON.parse(row.payload)}))});
  }
  if(url.pathname==='/api/events'&&request.method==='GET'){
   const before=url.searchParams.get('before');if(before!==null&&!/^[1-9][0-9]{0,14}$/.test(before))return json({ok:false,error:'Invalid cursor'},400);
   const db=database(env);
   const statement=before?db.prepare('SELECT id,received_at,payload FROM reader_events WHERE id < ? ORDER BY id DESC LIMIT 51').bind(Number(before)):db.prepare('SELECT id,received_at,payload FROM reader_events ORDER BY id DESC LIMIT 51');
   const {results}=await statement.all();const rows=results.slice(0,50);
   return json({ok:true,events:rows.map(r=>({id:r.id,receivedAt:r.received_at,payload:JSON.parse(r.payload)})),nextBefore:results.length>50?rows.at(-1).id:null});
  }
  if(url.pathname==='/api/events/live'&&request.method==='GET'){
   const after=url.searchParams.get('after')??'0';if(!/^(0|[1-9][0-9]{0,14})$/.test(after))return json({ok:false,error:'Invalid cursor'},400);
   const {results}=await database(env).prepare('SELECT id,received_at,payload FROM reader_events WHERE id > ? ORDER BY id ASC LIMIT 100').bind(Number(after)).all();
   return json({ok:true,events:results.map(r=>({id:r.id,receivedAt:r.received_at,payload:JSON.parse(r.payload)}))});
  }
  if(url.pathname==='/'&&request.method==='GET')return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'}});
  return json({ok:false,error:'Not found'},404);
 }catch(e){console.error('RFID storage error',e.message);return json({ok:false,error:'Data storage is unavailable. Please try again.'},503);}
}};
