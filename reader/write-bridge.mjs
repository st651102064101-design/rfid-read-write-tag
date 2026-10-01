import http from 'node:http';
import https from 'node:https';
import {createInterface} from 'node:readline';
import {timingSafeEqual} from 'node:crypto';
import {readerRecords,recordEpc,recordAccessResults,accessSequenceMatches,adjacentWordFromRead,buildWordWritePlan,chunkWordAccess,writeResultVerified,writeWaitTimeoutMs} from './write-bridge-utils.mjs';
// Read secrets from hidden stdin, never source or command-line arguments.
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=createInterface({input:process.stdin,terminal:false});
console.log('Ready for bridge configuration on stdin');
const config=JSON.parse(await new Promise(resolve=>input.once('line',resolve)));input.close();
const site=new URL(config.site).origin,reader=new URL(config.reader).origin;
if(!config.token||!config.username||!config.password)throw Error('Missing configuration');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let busy=false;const completed=new Map();
function request(path,method='GET',body,auth){return new Promise((resolve,reject)=>{
 const req=https.request(reader+path,{method,rejectUnauthorized:false,headers:{...(auth?{Authorization:auth}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error(`Reader ${method} ${path} HTTP ${res.statusCode}${text?': '+text.slice(0,180):''}`));try{resolve(text?JSON.parse(text):null);}catch{reject(Error('Invalid reader response'));}});});
 req.setTimeout(10000,()=>req.destroy(Error('Reader timeout')));req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
});}
async function events(after=0){const response=await fetch(site+'/api/events'+(after?'/live?after='+after:''),{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Event API HTTP '+response.status);return (await response.json()).events;}
function validate(b){
 if(!b||b.operation!=='write'||!['EPC','TID','USER','RESERVED'].includes(b.memoryBank)||!/^(?:[0-9a-f]{2})+$/i.test(b.epc||'')||!/^[a-z0-9-]{8,80}$/i.test(b.requestId||''))throw Error('Invalid write request');
 if(!Number.isSafeInteger(b.offsetBytes)||b.offsetBytes<0||b.offsetBytes%2||!/^(?:[0-9a-f]{2})+$/i.test(b.dataHex||'')||b.dataHex.length>2048||b.lengthBytes!==b.dataHex.length/2)throw Error('Invalid offset or data');
 if(b.memoryBank==='EPC'&&b.offsetBytes<4)throw Error('EPC data starts at byte 4; CRC/PC are protected');
 if(b.memoryBank==='RESERVED'&&b.offsetBytes+b.lengthBytes>8)throw Error('Reserved password region is bytes 0–7');
 if(b.accessPassword&&!/^[0-9a-f]{8}$/i.test(b.accessPassword))throw Error('Access password must be 8 HEX digits');
 if(['TID','RESERVED'].includes(b.memoryBank)&&b.confirmSensitive!==true)throw Error('Confirm sensitive bank before writing');
}
async function write(b){
 validate(b);const login=await request('/cloud/localRestLogin','GET',null,'Basic '+Buffer.from(config.username+':'+config.password).toString('base64'));
 if(login.code!==0||!login.message)throw Error('Reader login failed');const auth='Bearer '+login.message;
 const original=await request('/cloud/mode','GET',null,auth),status=await request('/cloud/status','GET',null,auth);
 const epc=b.epc.toUpperCase(),fresh=await events();
 const records=fresh.flatMap(event=>readerRecords(event.payload));const tag=records.find(record=>recordEpc(record)===epc);
 const d=tag?.data||tag||{},tid=d.TID||(tag?.type==='CUSTOM'&&d.MAC==='C4:7D:CC:74:AF:20'&&d.accessResults?.length===4?d.accessResults[1]:null);
 if(!tag)throw Error('Target EPC was not found in recent reader events');
 if(b.memoryBank==='EPC'&&b.offsetBytes+b.lengthBytes>epc.length/2+4)throw Error('Write exceeds current EPC length; PC length change is not supported');
 const identity=/^(?:[a-f0-9]{4})+$/i.test(tid||'')?{membank:'TID',pointer:0,length:tid.length*4,mask:tid}:{membank:'EPC',pointer:32,length:epc.length*4,mask:epc};
 const firstWord=b.offsetBytes/2,wordCount=Math.ceil(b.lengthBytes/2),planBase={membank:b.memoryBank,wordPointer:firstWord,wordCount};
 let baseline=Math.max(0,...fresh.map(event=>Number(event.id))),changed=false;const at=Date.now();let result;
 try{
  const makeMode=accesses=>({type:'CUSTOM',antennas:[Number(d.antenna)||1],transmitPower:[original.transmitPower?.[0]||15],query:{session:'S0',target:'A',sel:'NOT_SL'},selects:[{target:'S0',action:'INVA_INVB',...identity}],accesses,radioStopConditions:{antennaCycles:1}});
  const runPhase=async(accesses,minResults,timeoutMs,acceptedEpcs)=>{
   await request('/cloud/stop','PUT',null,auth);changed=true;await request('/cloud/mode','PUT',makeMode(accesses),auth);
   const activeMode=await request('/cloud/mode','GET',null,auth),matches=activeMode.type==='CUSTOM'&&accessSequenceMatches(activeMode.accesses,accesses);
   if(!matches)throw Error('Reader did not apply the requested access sequence; nothing was written');
   const queuedEvents=await events();baseline=Math.max(baseline,...queuedEvents.map(event=>Number(event.id)||0));await request('/cloud/start','PUT',null,auth);const started=Date.now();
   while(Date.now()-started<timeoutMs){await delay(350);const incoming=await events(baseline);for(const event of incoming){baseline=Math.max(baseline,Number(event.id));for(const record of readerRecords(event.payload)){
    const values=recordAccessResults(record),id=recordEpc(record);if(record.type==='CUSTOM'&&Array.isArray(values)&&values.length>=minResults&&acceptedEpcs.includes(id)&&Date.parse(record.timestamp)>=started-250)return {record,values};
   }} }
   throw Error('Timed out waiting for hardware result. Do not repeat without checking the tag.');
  };
  const newEpc=b.memoryBank==='EPC'?epc.slice(0,(b.offsetBytes-4)*2)+b.dataHex.toUpperCase()+epc.slice((b.offsetBytes-4+b.lengthBytes)*2):epc;
  const acceptedEpcs=[epc,newEpc];let before;
  if(b.lengthBytes%2){const readAccesses=[];if(b.accessPassword)readAccesses.push({type:'ACCESS',config:{password:b.accessPassword}});readAccesses.push({type:'READ',config:{membank:b.memoryBank,wordPointer:firstWord+Math.floor(b.lengthBytes/2),wordCount:1}});const preRead=await runPhase(readAccesses,readAccesses.length,30000,[epc]);const returned=preRead.values.at(-1),knownBankRecord=records.find(record=>recordEpc(record)===epc&&/^(?:[0-9a-f]{4})+$/i.test(record?.data?.[b.memoryBank]||'')),accessRecord=records.find(record=>recordEpc(record)===epc&&Array.isArray(recordAccessResults(record))&&recordAccessResults(record).length>=4&&/^(?:[0-9a-f]{4})+$/i.test(recordAccessResults(record).at(-1)||'')),knownBank=knownBankRecord?.data?.[b.memoryBank]||d[b.memoryBank]||(accessRecord?recordAccessResults(accessRecord).at(-1):'');before=adjacentWordFromRead(b,returned,knownBank);if(!before)throw Error(`Could not read the adjacent word needed to preserve its byte; nothing was written. Reader returned ${typeof returned==='string'?`${returned.length/2} bytes`:typeof returned}; matching bank ${knownBank.length/2} bytes`);}
  const plan=buildWordWritePlan(b,before),writeChunks=chunkWordAccess({dataHex:plan.writeHex,wordPointer:firstWord}),readChunks=writeChunks.map(({wordPointer,wordCount})=>({membank:b.memoryBank,wordPointer,wordCount}));
  const writeAccesses=[];if(b.accessPassword)writeAccesses.push({type:'ACCESS',config:{password:b.accessPassword}});for(const chunk of writeChunks)writeAccesses.push({type:'WRITE',config:{membank:b.memoryBank,wordPointer:chunk.wordPointer,data:chunk.dataHex}});for(const chunk of readChunks)writeAccesses.push({type:'READ',config:chunk});
  const completed=await runPhase(writeAccesses,writeAccesses.length,writeWaitTimeoutMs(b.lengthBytes),acceptedEpcs),values=completed.values,passwordOffset=b.accessPassword?1:0;
  const writeResults=values.slice(passwordOffset,passwordOffset+writeChunks.length),readResults=values.slice(passwordOffset+writeChunks.length,passwordOffset+writeChunks.length*2),written=writeResults.every(value=>/^success$/i.test(value||''))?'success':writeResults.find(value=>!/^success$/i.test(value||''))||'Not Attempted',after=readResults.join(''),verified=writeResultVerified(b,plan,before,written,after);
  result={requestId:b.requestId,epc,status:verified?'success':'failed',memoryBank:b.memoryBank,offsetBytes:b.offsetBytes,beforeHex:before,afterHex:after,newEpc:verified?newEpc:undefined,verified,message:verified?'Written and read back from FX9600'+(b.lengthBytes%2?' · adjacent byte preserved':''):String(written==='Not Attempted'?written:written),readerEvent:completed.record.data.eventNum};
 }finally{
  if(changed){try{await request('/cloud/stop','PUT',null,auth);await request('/cloud/mode','PUT',original,auth);if(status.radioActivity==='active')await request('/cloud/start','PUT',null,auth);}catch{if(result)result.resumeWarning='Reader mode could not be restored; check reader console';else throw Error('Operation uncertain and reader mode restore failed');}}
 }
 return result;
}
const server=http.createServer(async(req,res)=>{
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const supplied=Buffer.from((req.headers.authorization||'').replace(/^Bearer /,'')),expected=Buffer.from(config.token);
 if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(401,{error:'Unauthorized'});
 if(req.url==='/health'&&req.method==='GET')return send(200,{ok:true,busy});
 if(req.url!=='/write'||req.method!=='POST')return send(404,{error:'Not found'});
 let b;try{let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)throw Error('Too large');}b=JSON.parse(text);validate(b);}catch(e){return send(400,{error:e.message});}
 if(completed.has(b.requestId))return send(200,completed.get(b.requestId));if(busy)return send(409,{error:'Reader busy'});busy=true;
 try{const result=await write(b);completed.set(b.requestId,result);send(200,result);}catch(error){const result={requestId:b.requestId,epc:b.epc,status:'unknown',verified:false,message:String(error?.message||'Bridge could not confirm the operation. Check tag and reader before retrying.').slice(0,240)};completed.set(b.requestId,result);send(200,result);}finally{busy=false;}
});server.listen(5051,'127.0.0.1',()=>console.log('FX9600 writer bridge listening on localhost:5051'));
// Outbound polling: no public tunnel or inbound network port is required.
let pendingResult=null;
async function poll(){
 if(busy)return;
 try{
  const response=await fetch(site+'/api/bridge/poll',{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({result:pendingResult}),signal:AbortSignal.timeout(8000)});
  if(!response.ok)return;const data=await response.json();pendingResult=null;
  if(data.command){const b=data.command;busy=true;try{pendingResult=completed.get(b.requestId)||await write(b);completed.set(b.requestId,pendingResult);}catch(error){pendingResult={requestId:b.requestId,epc:b.epc,status:'unknown',verified:false,message:String(error?.message||'Hardware result not confirmed. Check tag before retrying.').slice(0,240)};completed.set(b.requestId,pendingResult);}finally{busy=false;}}
 }catch{/* Keep pending result and retry delivering it; never repeat the write. */}
}
setInterval(poll,1000);poll();
