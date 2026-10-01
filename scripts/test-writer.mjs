import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
test('outbound writer queue claims once and returns verified result with request-id deduplication',async()=>{
 const db=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
 const env={WRITE_BRIDGE_TOKEN:'bridge-test',WRITE_OPERATOR_KEY:'operator-test',DB:{prepare(sql){const stmt=db.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async run(){return stmt.run(...args);},async all(){return {results:stmt.all(...args)};}};}}};
 const post=(path,body,key='operator-test')=>worker.fetch(new Request('https://test'+path,{method:'POST',headers:{'x-write-key':key,authorization:'Bearer '+(path.includes('bridge')?'bridge-test':''),'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const body={requestId:'test-request-1234',operation:'write',memoryBank:'EPC',epc:'AABB',offsetBytes:4,lengthBytes:2,dataHex:'CCDD'};
 try{
 assert.equal((await post('/api/write',body)).status,202);const poll=await (await post('/api/bridge/poll',{})).json();assert.deepEqual(poll.command,body);assert.equal((await (await post('/api/bridge/poll',{})).json()).command,null);
 const result={requestId:body.requestId,epc:body.epc,status:'success',verified:true,afterHex:'CCDD'};await post('/api/bridge/poll',{result});
 const saved=await worker.fetch(new Request('https://test/api/write/result?requestId='+body.requestId,{headers:{'x-write-key':'operator-test'}}),env);assert.deepEqual(await saved.json(),result);
 await post('/api/write',body);assert.equal((await (await post('/api/bridge/poll',{})).json()).command,null);assert.equal((await post('/api/write',{...body,dataHex:'EEFF'})).status,409);
 assert.equal((await post('/api/write',body,'bad')).status,401);
 }finally{db.close();}
});
