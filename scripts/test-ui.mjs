import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM, VirtualConsole} from 'jsdom';
import worker from '../worker/index.js';

const html=await (await worker.fetch(new Request('https://test/'),{})).text();
async function setup(events=[],options={}){
 let now=Date.now();const errors=[],calls=[],timers=[];
 const state={events,live:[],readers:[],fail:false,...options};
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'https://test/',pretendToBeVisual:true,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.Date.now=()=>now;w.AbortSignal=AbortSignal;
  w.setInterval=(fn,delay)=>{timers.push({fn,delay});return timers.length;};
  w.fetch=async url=>{calls.push(url);if(state.fail)throw Error('Network unavailable');
   const body=url.startsWith('/api/reader/status')?{ok:true,readers:state.readers}:url.startsWith('/api/events/live')?{ok:true,events:state.live}:{ok:true,events:state.events,nextBefore:null};
   return {ok:true,json:async()=>body};
  };
 }});
 await new Promise(resolve=>setImmediate(resolve));
 return {dom,state,errors,calls,timers,doc:dom.window.document,advance:ms=>{now+=ms;},async tick(delay){for(const t of timers.filter(t=>t.delay===delay))t.fn();await new Promise(resolve=>setImmediate(resolve));},close(){dom.window.close();}};
}
const event=(id,epc='AABB',age=0)=>({id,receivedAt:new Date(Date.now()-age).toISOString(),payload:{tag_reads:[{epc,isHeartBeat:'false'}]}});
test('built page starts without removed webhook controls, shows fresh tags, and groups duplicates',async()=>{
 const a=await setup([event(3),event(2),event(1,'CCDD')]);try{
 assert.equal(a.errors.length,0);assert.equal(a.doc.getElementById('save'),null);
 assert.equal(a.doc.querySelectorAll('.eventcard').length,2);
 assert.match(a.doc.getElementById('eventList').textContent,/AABB · อ่านพบ 2 ครั้ง/);
 assert.doesNotMatch(a.doc.getElementById('feedStatus').textContent,/กำลังโหลด/);
 }finally{a.close();}
});
test('empty and stale initial responses render an explicit empty state',async()=>{
 for(const events of [[],[event(1,'AABB',6000)]]){const a=await setup(events);try{assert.match(a.doc.getElementById('eventList').textContent,/ไม่พบแท็ก/);assert.equal(a.doc.querySelectorAll('.eventcard').length,0);}finally{a.close();}}
});
test('live updates count once per event, then expire after five seconds',async()=>{
 const a=await setup([event(1)]);try{a.state.live=[event(2)];await a.tick(500);await a.tick(500);
 assert.equal(a.doc.querySelectorAll('.eventcard').length,1);assert.match(a.doc.getElementById('eventList').textContent,/อ่านพบ 2 ครั้ง/);
 a.state.live=[];a.advance(6000);await a.tick(500);assert.equal(a.doc.querySelectorAll('.eventcard').length,0);assert.match(a.doc.getElementById('eventList').textContent,/ไม่พบแท็ก/);
 assert.match(a.doc.getElementById('tagDetails').textContent,/ยังไม่พบแท็ก/);assert.doesNotMatch(a.doc.getElementById('tagDetails').textContent,/AABB/);
 }finally{a.close();}
});
test('large expired backlog does not throw or leave loading status stuck',async()=>{
 const a=await setup();try{a.state.live=Array.from({length:100},(_,i)=>event(i+1,'AABB',10000));await a.tick(500);assert.equal(a.errors.length,0);assert.doesNotMatch(a.doc.getElementById('feedStatus').textContent,/ไม่ได้/);}finally{a.close();}
});
test('network failure becomes an error and recovers automatically',async()=>{
 const a=await setup([],{fail:true});try{assert.match(a.doc.getElementById('feedStatus').textContent,/โหลดข้อมูลไม่ได้/);a.state.fail=false;await a.tick(500);assert.match(a.doc.getElementById('feedStatus').textContent,/LIVE/);assert.match(a.doc.getElementById('eventList').textContent,/ไม่พบแท็ก/);}finally{a.close();}
});
test('heartbeat online, offline, and unavailable states are independent of tag reads',async()=>{
 const now=Date.now(),a=await setup([],{readers:[{readerKey:'FX-test',receivedAt:new Date(now).toISOString(),previousAt:new Date(now-5000).toISOString()}]});try{
 assert.ok(a.doc.getElementById('readerStatus').classList.contains('online'));
 a.advance(16000);await a.tick(1000);assert.ok(a.doc.getElementById('readerStatus').classList.contains('offline'));
 a.state.fail=true;await a.tick(1000);assert.ok(a.doc.getElementById('readerStatus').classList.contains('unknown'));
 assert.equal(a.errors.length,0);
 }finally{a.close();}
});

test('memory sizes reflect received bytes and bank selector maps EPC offset',async()=>{const e=event(1);e.payload.tag_reads[0].USER='AB'.repeat(256);e.payload.tag_reads[0].TID='CD'.repeat(12);const a=await setup([e]);try{const text=a.doc.querySelector('.capacity').textContent;assert.match(text,/2048 bits · 256 bytes · 128 words/);assert.match(text,/96 bits · 12 bytes · 6 words/);assert.match(text,/ไม่พบข้อมูลจาก reader/);const select=a.doc.getElementById('memoryBank');select.value='EPC';select.dispatchEvent(new a.dom.window.Event('change'));assert.equal(a.doc.getElementById('offset').value,'4');}finally{a.close();}});

test('right-side tag details read nested Zebra FX9600 data banks and metadata',async()=>{
 const epc='E2806F12000000022DF13118',e=event(1,epc);
 e.payload=[{type:'INVENTORY',eventNum:12,format:'epc',hostName:'FX9600',idHex:epc.toLowerCase(),peakRssi:-24,antenna:1,channel:923.25,data:{PC:'3000',CRC:'2827',TID:'E2806F12200094022DF13118',USER:'AB'.repeat(256)}}];
 const a=await setup([e]);try{const detail=a.doc.getElementById('tagDetails').textContent;
  assert.match(detail,new RegExp(epc));assert.match(detail,/2048 bits · 256 bytes · 128 words/);assert.match(detail,/96 bits · 12 bytes · 6 words/);assert.match(detail,/0x3000 · 16 bits · 1 word/);assert.match(detail,/-24 dBm/);assert.match(detail,/923\.25 MHz/);
  assert.equal(a.doc.querySelectorAll('#tagDetails .bankraw').length,3);
 }finally{a.close();}
});
