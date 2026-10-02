import https from 'node:https';
import {createInterface} from 'node:readline';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const input=createInterface({input:process.stdin,terminal:false});
console.log('Ready for reader configuration on stdin');
const config=JSON.parse(await new Promise(resolve=>input.once('line',resolve)));input.close();
function request(path,method='GET',body,auth){return new Promise((resolve,reject)=>{
 const req=https.request(new URL(path,config.reader),{method,rejectUnauthorized:false,headers:{...(auth?{Authorization:auth}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{
  let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error(`Reader ${method} ${path} HTTP ${res.statusCode}`));try{resolve(text?JSON.parse(text):null);}catch{reject(Error('Invalid reader response'));}});
 });req.setTimeout(10000,()=>req.destroy(Error('Reader timeout')));req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
});}
const login=await request('/cloud/localRestLogin','GET',null,'Basic '+Buffer.from(config.username+':'+config.password).toString('base64'));
if(login.code!==0||!login.message)throw Error('Reader login failed');const auth='Bearer '+login.message;
const status=await request('/cloud/status','GET',null,auth);
const endpoints=status.interfaceConnectionStatus?.data||[];
if(!endpoints.length)throw Error('No Tag Data endpoint configured');
if(endpoints.some(endpoint=>endpoint.connectionStatus!=='connected')){
 const mode=await request('/cloud/mode','GET',null,auth);
 if(mode.accesses?.some(access=>['WRITE','LOCK','KILL'].includes(access.type)))throw Error('A tag operation is configured; wait until it finishes before reconnecting');
 const settings=await request('/cloud/config','GET',null,auth),gateway=settings['READER-GATEWAY'];
 if(!gateway?.endpointConfig?.data?.event?.connections?.length)throw Error('Tag Data configuration missing');
 // Resubmit only the gateway JSON. Preserve radio mode, power, endpoints and credentials.
 await request('/cloud/config','PUT',{'READER-GATEWAY':gateway},auth);
 console.log('HTTP POST gateway configuration reloaded');
}else console.log('Tag Data endpoint is already connected');
const started=Date.now();let verified=false;
while(Date.now()-started<20000){
 const state=await request('/cloud/status','GET',null,auth);
 const response=await fetch(new URL('/api/events',config.site),{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Site event API HTTP '+response.status);
 const data=await response.json(),epcs=new Set();let latest=0;
 for(const event of data.events||[]){const at=Date.parse(event.receivedAt);if(Date.now()-at>5000)continue;const queue=[event.payload];while(queue.length){const item=queue.shift();if(!item||typeof item!=='object')continue;for(const [key,value] of Object.entries(item)){if(/^(idHex|epc|epcHex)$/i.test(key)&&typeof value==='string'&&/^(?:[a-f0-9]{2})+$/i.test(value)){epcs.add(value.toUpperCase());latest=Math.max(latest,Number(event.id));}else if(value&&typeof value==='object')queue.push(value);}}}
 if(state.interfaceConnectionStatus?.data?.every(endpoint=>endpoint.connectionStatus==='connected')&&epcs.size){console.log(JSON.stringify({tagData:'connected',radio:state.radioActivity,detectedTags:epcs.size,latestEventId:latest}));verified=true;break;}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!verified)throw Error('No current tag data confirmed. Check tags, antenna and reader connection status.');
