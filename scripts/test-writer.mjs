import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../worker/index.js';
import {readerRecords,recordEpc,recordAccessResults} from '../reader/write-bridge-utils.mjs';
import {accessSequenceMatches,adjacentWordFromRead,buildWordWritePlan,chunkWordAccess,writeChunkPhases,writeResultVerified,writeWaitTimeoutMs} from '../reader/write-bridge-utils.mjs';
test('bridge finds FX9600 records and write results inside nested webhook payloads',()=>{
 const epc='0000000000424F582D303037',payload={envelope:{events:[{type:'CUSTOM',timestamp:'2026-10-01T07:00:00Z',data:{idHex:epc,accessResults:['AA','success','BB']}}]}};
 const records=readerRecords(payload);assert.equal(records.length,1);assert.equal(recordEpc(records[0]),epc);assert.deepEqual(recordAccessResults(records[0]),['AA','success','BB']);
});
test('odd byte writes preserve the adjacent byte without padding and verify both bytes',()=>{
 const request={offsetBytes:0,lengthBytes:3,dataHex:'414243'},before='3344',plan=buildWordWritePlan(request,before);
 assert.equal(plan.wordCount,2);assert.equal(plan.writeHex,'41424344');
 assert.equal(writeResultVerified(request,plan,before,'success','41424344'),true);
 assert.equal(writeResultVerified(request,plan,before,'success','41424300'),false);
 assert.equal(writeResultVerified(request,plan,before,'success','41424444'),false);
 assert.throws(()=>buildWordWritePlan(request,'112233'),/adjacent tag word/);
 assert.equal(adjacentWordFromRead(request,'3344','1122334455667788'),'3344');
 assert.equal(adjacentWordFromRead(request,'1122334455667788','1122334455667788'),'3344');
});
test('large writes are split into reader-sized word operations with matching pointers',()=>{
 const chunks=chunkWordAccess({dataHex:'A'.repeat(66*2),wordPointer:12});
 assert.deepEqual(chunks.map(({wordPointer,wordCount})=>({wordPointer,wordCount})),[{wordPointer:12,wordCount:32},{wordPointer:44,wordCount:1}]);
 assert.equal(chunks.map(chunk=>chunk.dataHex).join(''),'A'.repeat(132));
});
test('large writes use one write or read per reader access sequence',()=>{
 const chunks=chunkWordAccess({dataHex:'22'.repeat(256),wordPointer:0}),phases=writeChunkPhases({chunks,memoryBank:'USER'});
 assert.equal(chunks.length,4);assert.equal(phases.length,8);assert.ok(phases.every(phase=>phase.accesses.length===1));
 assert.deepEqual(phases.map(phase=>phase.phase),['write','read','write','read','write','read','write','read']);
 assert.deepEqual(phases.filter(phase=>phase.phase==='write').map(phase=>phase.accesses[0].config.wordPointer),[0,32,64,96]);
 assert.ok(phases.every(phase=>phase.chunk.wordCount<=32));
 const secured=writeChunkPhases({chunks:chunks.slice(0,1),memoryBank:'USER',accessPassword:'12345678'});assert.ok(secured.every(phase=>phase.accesses.length===2&&phase.accesses[0].type==='ACCESS'));
});
test('reader mode verification accepts normalized HEX while requiring the requested access sequence',()=>{
 const expected=[{type:'WRITE',config:{membank:'USER',wordPointer:0,data:'5A62'}},{type:'READ',config:{membank:'USER',wordPointer:0,wordCount:1}}];
 assert.equal(accessSequenceMatches([{type:'WRITE',config:{membank:'USER',wordPointer:0,data:'5a62'}},{type:'READ',config:{membank:'USER',wordPointer:0,wordCount:1}}],expected),true);
 assert.equal(accessSequenceMatches([{type:'READ',config:{membank:'USER',wordPointer:0,wordCount:1}}],expected),false);
});
test('even byte writes use exact payload and each chunk has a bounded result wait',()=>{
 const request={lengthBytes:4,dataHex:'41424344'},before='1122334455667788',plan=buildWordWritePlan(request,before);
 assert.equal(plan.wordCount,2);assert.equal(plan.writeHex,'41424344');
 assert.equal(writeResultVerified(request,plan,before,'success','41424344'),true);
 assert.ok(writeWaitTimeoutMs(2)>=20000);assert.ok(writeWaitTimeoutMs(64)<=30000);assert.equal(writeWaitTimeoutMs(256),30000);
});
test('outbound writer queue claims once and returns verified result with request-id deduplication',async()=>{
 const db=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
 const env={WRITE_BRIDGE_TOKEN:'bridge-test',WRITE_OPERATOR_KEY:'operator-test',DB:{prepare(sql){const stmt=db.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async run(){return stmt.run(...args);},async all(){return {results:stmt.all(...args)};}};}}};
 const post=(path,body,key='operator-test')=>worker.fetch(new Request('https://test'+path,{method:'POST',headers:{'x-write-key':key,authorization:'Bearer '+(path.includes('bridge')?'bridge-test':''),'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const body={requestId:'test-request-1234',operation:'write',memoryBank:'USER',epc:'AABB',offsetBytes:0,lengthBytes:3,dataHex:'CCDDEE'};
 try{
 assert.equal((await post('/api/write',body)).status,202);const poll=await (await post('/api/bridge/poll',{})).json();assert.deepEqual(poll.command,body);assert.equal((await (await post('/api/bridge/poll',{})).json()).command,null);
 const result={requestId:body.requestId,epc:body.epc,status:'success',verified:true,afterHex:'CCDDEE'};await post('/api/bridge/poll',{result});
 const saved=await worker.fetch(new Request('https://test/api/write/result?requestId='+body.requestId,{headers:{'x-write-key':'operator-test'}}),env);assert.deepEqual(await saved.json(),result);
 await post('/api/write',body);assert.equal((await (await post('/api/bridge/poll',{})).json()).command,null);assert.equal((await post('/api/write',{...body,dataHex:'AABBCC'})).status,409);
 assert.equal((await post('/api/write',body,'bad')).status,202);
 }finally{db.close();}
});
import {measureOperation} from '../reader/operation-timing.mjs';
test('operation timing measures asynchronous work in milliseconds and preserves the result',async()=>{let now=100;const result=await measureOperation(async()=>{await Promise.resolve();now=1334.6;return {status:'success',verified:true};},()=>now);assert.deepEqual(result,{status:'success',verified:true,durationMs:1235});});
test('operation failures retain elapsed milliseconds without becoming success',async()=>{let now=10;const failure=Error('Reader rejected write');await assert.rejects(measureOperation(async()=>{now=260;throw failure;},()=>now),error=>error===failure&&error.durationMs===250);});
