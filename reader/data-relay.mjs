import https from 'node:https';
import http from 'node:http';
import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin,terminal:false});
const config=JSON.parse(await new Promise(resolve=>input.once('line',resolve)));input.close();
const reader=new URL(config.reader),site=new URL(config.site);
if(site.protocol!=='https:')throw Error('Site must use HTTPS');
const host=config.relayHost||'192.168.137.1',port=8766;
function request(path,method='GET',body,auth){return new Promise((resolve,reject)=>{
 const req=https.request(new URL(path,reader),{method,rejectUnauthorized:false,headers:{Authorization:auth,...(body?{'Content-Type':'application/json'}:{})}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{if(res.statusCode>=300)return reject(Error('Reader HTTP '+res.statusCode));try{resolve(text?JSON.parse(text):null)}catch{reject(Error('Invalid reader response'))}})});
 req.setTimeout(10000,()=>req.destroy(Error('Reader timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
})}
let delivered=0;
const server=http.createServer(async(req,res)=>{
 if(req.socket.remoteAddress!==reader.hostname){res.writeHead(403);return res.end()}
 if(req.method!=='POST'||req.url!=='/rfid/events'){res.writeHead(404);return res.end()}
 try{
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413);res.end();req.destroy();return}chunks.push(chunk)}
  const body=Buffer.concat(chunks);JSON.parse(body.toString());
  const response=await fetch(new URL('/rfid/events',site),{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});
  const text=await response.text();res.writeHead(response.status,{'Content-Type':'application/json'});res.end(text);
  if(response.ok){delivered++;if(delivered===1||delivered%20===0)console.log(JSON.stringify({relay:'connected',batches:delivered,at:new Date().toISOString()}))}
 }catch(error){if(!res.headersSent)res.writeHead(502);res.end();console.error('Relay failed:',error.message)}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve)});
console.log('Reader relay listening on '+host+':'+port);
async function configure(){
 const login=await request('/cloud/localRestLogin','GET',null,'Basic '+Buffer.from(config.username+':'+config.password).toString('base64'));
 if(login.code!==0||!login.message)throw Error('Reader login failed');const auth='Bearer '+login.message;
 const settings=await request('/cloud/config','GET',null,auth),gateway=settings['READER-GATEWAY'];
 const connection=gateway?.endpointConfig?.data?.event?.connections?.[0];if(!connection?.options)throw Error('Tag Data endpoint missing');
 const url='http://'+host+':'+port+'/rfid/events';
 if(connection.options.URL!==url){connection.options.URL=url;await request('/cloud/config','PUT',{'READER-GATEWAY':gateway},auth)}
 console.log('Reader Tag Data endpoint configured');
}
while(true){try{await configure();break}catch(error){console.error('Waiting for reader:',error.message);await new Promise(r=>setTimeout(r,10000))}}
