import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';
import worker from '../worker/index.js';

const html=await (await worker.fetch(new Request('https://test/'),{})).text();
test('public write API rejects malformed commands before forwarding',async()=>{
 const env={WRITE_BRIDGE_URL:'https://bridge.example',WRITE_BRIDGE_TOKEN:'test'};
 const invalid=await worker.fetch(new Request('https://test/api/write',{method:'POST',body:'{}'}),env);assert.equal(invalid.status,422);
 const unsupported=await worker.fetch(new Request('https://test/api/write',{method:'POST',body:JSON.stringify({operation:'write',memoryBank:'KILL',epc:'AABB',dataHex:'AABB',offsetBytes:0})}),env);assert.equal(unsupported.status,422);
 const missing=await worker.fetch(new Request('https://test/api/write',{method:'POST',body:'{}'}),{});assert.equal(missing.status,503);
});
async function setup(events=[],options={}){
 let now=Date.now();const errors=[],calls=[],timers=[];
 const state={events,live:[],readers:[],fail:false,writeAvailable:false,lastWrite:null,...options};
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'https://test/',pretendToBeVisual:true,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.Date.now=()=>now;w.AbortSignal=AbortSignal;
  w.setInterval=(fn,delay)=>{timers.push({fn,delay});return timers.length;};
  Object.defineProperty(w.crypto,'randomUUID',{value:()=> 'test-request-id-1234'});
  w.fetch=async(url,init)=>{calls.push(url);if(state.fail)throw Error('Network unavailable');
   if(url==='/api/write'&&init?.method==='POST'){const body=JSON.parse(init.body);state.lastWrite=body;return {ok:true,json:async()=>({requestId:body.requestId,epc:body.epc,status:'success',verified:true,newEpc:body.epc})};}
   const body=url.startsWith('/api/write/config')?{ok:true,available:state.writeAvailable}:url.startsWith('/api/reader/status')?{ok:true,readers:state.readers}:url.startsWith('/api/events/live')?{ok:true,events:state.live}:{ok:true,events:state.events,nextBefore:null};
   return {ok:true,json:async()=>body};
  };
 }});
 await new Promise(resolve=>setImmediate(resolve));
 return {dom,state,errors,calls,timers,doc:dom.window.document,advance:ms=>{now+=ms;},async tick(delay){for(const t of timers.filter(t=>t.delay===delay))t.fn();await new Promise(resolve=>setImmediate(resolve));},close(){dom.window.close();}};
}
const event=(id,epc='AABB',age=0)=>({id,receivedAt:new Date(Date.now()-age).toISOString(),payload:{tag_reads:[{epc,isHeartBeat:'false'}]}});
test('verified CUSTOM reader profile maps banks without confusing other readers',async()=>{
 const epc='0000000000424F582D303037';const e=event(1,epc);e.payload=[{type:'CUSTOM',timestamp:'2026-10-01T05:42:00Z',data:{idHex:epc,MAC:'C4:7D:CC:74:AF:20',accessResults:['80e23000'+epc,'e280689420005026ce01a477','0000000000000000','Error: tag returned error code 0x03 = Memory overrun']}}];
 const a=await setup([e]);try{const panel=a.doc.getElementById('tagDetails');assert.match(panel.querySelector('[data-memory="EPC"]').textContent,/128 bits/);assert.match(panel.querySelector('[data-memory="TID"]').textContent,/96 bits/);assert.match(panel.querySelector('[data-memory="RESERVED"]').textContent,/64 bits/);assert.match(panel.querySelector('[data-memory="USER"]').textContent,/อ่านเกินขอบเขต/);}finally{a.close();}
 e.payload[0].data.MAC='OTHER';const b=await setup([e]);try{assert.match(b.doc.querySelector('#tagDetails [data-memory="RESERVED"]').textContent,/ไม่พบข้อมูล/);}finally{b.close();}
});
test('nested reader payload is grouped with readable EPC and actionable memory error; raw data stays collapsed',async()=>{
 const epc='0000000000424F582D303037',e=event(1,epc);e.payload=[{type:'INVENTORY',data:{idHex:epc,USER:'Error: tag returned error code 0x03 = Memory overrun',TID:'e280689420005026ce01a477',antenna:1,PC:'3000',CRC:'80e2',peakRssi:-45}}];
 const a=await setup([e]);try{
 assert.equal(a.doc.querySelector('.tagText strong').textContent,'BOX-007');assert.match(a.doc.querySelector('[data-memory="USER"]').textContent,/อ่านเกินขอบเขตหน่วยความจำ/);
 const card=a.doc.querySelector('.eventcard');assert.equal(card.querySelectorAll(':scope > table').length,0);const raw=card.querySelector('[data-raw-key="raw-'+epc+'"]');assert.equal(raw.open,false);assert.match(raw.textContent,/Memory overrun/);
 card.open=true;raw.open=true;const bank=card.querySelector('[data-bank="EPC"]');bank.open=true;a.state.live=[{...e,id:2}];await a.tick(500);
 assert.ok(a.doc.querySelector('.eventcard').open);assert.ok(a.doc.querySelector('.eventcard [data-bank="EPC"]').open);assert.ok(a.doc.querySelector('.eventcard [data-raw-key="raw-'+epc+'"]').open);
 }finally{a.close();}
});
test('built page starts without removed webhook controls, shows fresh tags, and groups duplicates',async()=>{
 const a=await setup([event(3),event(2),event(1,'CCDD')]);try{
 assert.equal(a.errors.length,0);assert.equal(a.doc.getElementById('save'),null);
 assert.equal(a.doc.getElementById('epc').tagName,'SELECT');assert.deepEqual([...a.doc.getElementById('epc').options].slice(1).map(option=>option.value),['AABB','CCDD']);
 assert.equal(a.doc.querySelectorAll('.eventcard').length,2);
 assert.match(a.doc.getElementById('eventList').textContent,/AABB · อ่านพบ 2 ครั้ง/);
 assert.doesNotMatch(a.doc.getElementById('feedStatus').textContent,/กำลังโหลด/);
 }finally{a.close();}
});
test('user can select a previously read EPC from the dropdown',async()=>{
 const a=await setup([event(2,'CCDD'),event(1,'AABB')]);try{const select=a.doc.getElementById('epc');select.value='AABB';select.dispatchEvent(new a.dom.window.Event('change'));
 assert.equal(select.value,'AABB');assert.match(a.doc.getElementById('tagDetails').textContent,/EPC · AABB/);const preview=a.dom.window.document.getElementById('writer');
 a.doc.getElementById('offset').value='0';a.doc.getElementById('data').value='OK';a.doc.getElementById('data').dispatchEvent(new a.dom.window.Event('input'));
 assert.equal(a.dom.window.document.getElementById('tagDetails').textContent.includes('EPC · AABB'),true);
 }finally{a.close();}
});
test('odd byte payloads are never padded and cannot be submitted',async()=>{
 const a=await setup([],{writeAvailable:true});try{assert.equal(a.doc.getElementById('autoPad'),null);const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));const data=a.doc.getElementById('data');data.value='BOX-008';data.dispatchEvent(new a.dom.window.Event('input'));
  assert.equal(a.doc.getElementById('length').value,'7');assert.equal(a.doc.getElementById('count').textContent,'7 bytes');assert.match(a.doc.getElementById('paddingNote').textContent,/ไม่เติม 00 อัตโนมัติ/);assert.equal(a.doc.getElementById('write').disabled,true);
  data.value='BOX-0080';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('length').value,'8');assert.equal(a.doc.getElementById('count').textContent,'8 bytes');assert.match(a.doc.getElementById('paddingNote').textContent,/จำนวนไบต์เป็นเลขคู่/);assert.equal(a.doc.getElementById('write').disabled,false);
 }finally{a.close();}
});
test('verified write shows a success toast fixed at the bottom-right',async()=>{
 const a=await setup([event(1,'AABB')],{writeAvailable:true});try{const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));const data=a.doc.getElementById('data');data.value='EVEN';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('write').disabled,false);
  await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));const toast=a.doc.getElementById('toast');assert.equal(toast.hidden,false);assert.ok(toast.classList.contains('success'));assert.match(toast.textContent,/เขียนข้อมูลสำเร็จ/);assert.match(a.doc.getElementById('tagDetails').textContent,/EPC · AABB/);
  assert.match(readFileSync('public/style.css','utf8'),/\.toast\{position:fixed;right:24px;bottom:24px/);
 }finally{a.close();}
});
test('ASCII EPC replacement keeps current EPC length and previews all leading zero bytes',async()=>{
 const original='0000000000424F582D303130',a=await setup([event(1,original)],{writeAvailable:true});try{
 const select=a.doc.getElementById('epc');select.value=original;select.dispatchEvent(new a.dom.window.Event('change'));
 const data=a.doc.getElementById('data');data.value='BOX-007';data.dispatchEvent(new a.dom.window.Event('input'));
 assert.equal(a.doc.getElementById('length').value,'12');assert.equal(a.doc.getElementById('count').textContent,'12 bytes · 00 นำหน้า 5 bytes');
 assert.match(a.doc.getElementById('paddingNote').textContent,/เติม 00 ด้านหน้า 5 bytes/);assert.match(a.doc.getElementById('paddingNote').textContent,/HEX ที่จะเขียน: 0000000000424F582D303037/);assert.equal(a.doc.getElementById('write').disabled,false);
 await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));
 assert.deepEqual({bank:a.state.lastWrite.memoryBank,offset:a.state.lastWrite.offsetBytes,length:a.state.lastWrite.lengthBytes,epc:a.state.lastWrite.epc,hex:a.state.lastWrite.dataHex},{bank:'EPC',offset:4,length:12,epc:original,hex:'0000000000424F582D303037'});
 }finally{a.close();}
});
test('tags are separated by observed USER read capability in cards, dropdown, and editor',async()=>{
 const epc1='AABB',epc2='CCDD',epc3='EEFF';
 const supported=event(1,epc1);supported.payload=[{type:'INVENTORY',data:{idHex:epc1,USER:'4142'}}];
 const overrun=event(2,epc2);overrun.payload=[{type:'CUSTOM',data:{idHex:epc2,MAC:'C4:7D:CC:74:AF:20',accessResults:['aabb','e280689420005026ce01a477','0000000000000000','Error: tag returned error code 0x03 = Memory overrun']}}];
 const unknown=event(3,epc3);const a=await setup([supported,overrun,unknown]);try{
  const options=[...a.doc.querySelectorAll('#epc option')].map(option=>option.textContent);assert.ok(options.some(option=>option.includes('AABB')&&option.includes('USER อ่านได้')));assert.ok(options.some(option=>option.includes('CCDD')&&option.includes('Memory overrun')));assert.ok(options.some(option=>option.includes('EEFF')&&option.includes('USER ยังไม่ทราบ')));
  const badges=[...a.doc.querySelectorAll('.tagCapability')].map(node=>node.textContent);assert.ok(badges.includes('USER ตอบ Memory overrun'));
  a.doc.getElementById('epc').value=epc2;a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));assert.match(a.doc.getElementById('userCapability').textContent,/Memory overrun/);assert.match(a.doc.getElementById('userCapability').textContent,/ยังยืนยันการเขียนไม่ได้/);
 }finally{a.close();}
});
test('tag card has a direct select-for-writing action and keeps dropdown in sync',async()=>{
 const a=await setup([event(2,'CCDD'),event(1,'AABB')]);try{const button=[...a.doc.querySelectorAll('.chooseTag')].find(node=>node.getAttribute('aria-label')==='เลือก EPC CCDD ในฟอร์มเขียน');assert.ok(button);button.click();assert.equal(a.doc.getElementById('epc').value,'CCDD');assert.match(a.doc.getElementById('tagDetails').textContent,/EPC · CCDD/);assert.equal(a.doc.querySelectorAll('#epc option').length,3);}finally{a.close();}
});
test('empty and stale initial responses render an explicit empty state',async()=>{
 for(const events of [[],[event(1,'AABB',6000)]]){const a=await setup(events);try{assert.match(a.doc.getElementById('eventList').textContent,/ไม่พบแท็ก/);assert.equal(a.doc.querySelectorAll('.eventcard').length,0);}finally{a.close();}}
});
test('live updates count once per event, then expire after five seconds',async()=>{
 const a=await setup([event(1)]);try{a.state.live=[event(2)];await a.tick(500);await a.tick(500);
 assert.equal(a.doc.querySelectorAll('.eventcard').length,1);assert.match(a.doc.getElementById('eventList').textContent,/อ่านพบ 2 ครั้ง/);
 a.state.live=[];a.advance(6000);await a.tick(500);assert.equal(a.doc.querySelectorAll('.eventcard').length,0);assert.match(a.doc.getElementById('eventList').textContent,/ไม่พบแท็ก/);
 assert.match(a.doc.getElementById('tagDetails').textContent,/EPC · AABB/);assert.match(a.doc.getElementById('eventList').textContent,/ไม่พบแท็ก/);
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

test('EPC is the default memory bank and initializes its safe offset',async()=>{const e=event(1);e.payload.tag_reads[0].USER='AB'.repeat(256);e.payload.tag_reads[0].TID='CD'.repeat(12);const a=await setup([e]);try{const text=a.doc.querySelector('.capacity').textContent;assert.match(text,/2048 bits · 256 bytes · 128 words/);assert.match(text,/96 bits · 12 bytes · 6 words/);assert.match(text,/ไม่พบข้อมูลจาก reader/);const select=a.doc.getElementById('memoryBank');assert.equal(select.value,'EPC');assert.equal(a.doc.getElementById('offset').value,'4');assert.match(a.doc.getElementById('bankNote').textContent,/byte 4/);select.value='USER';select.dispatchEvent(new a.dom.window.Event('change'));assert.equal(a.doc.getElementById('offset').value,'0');}finally{a.close();}});

test('right-side tag details read nested Zebra FX9600 data banks and metadata',async()=>{
 const epc='E2806F12000000022DF13118',e=event(1,epc);
 e.payload=[{type:'INVENTORY',eventNum:12,format:'epc',hostName:'FX9600',idHex:epc.toLowerCase(),peakRssi:-24,antenna:1,channel:923.25,data:{PC:'3000',CRC:'2827',TID:'E2806F12200094022DF13118',USER:'48454C4C4F2052464944'}}];
 const a=await setup([e]);try{const detail=a.doc.getElementById('tagDetails').textContent;
  assert.match(detail,new RegExp(epc));assert.match(detail,/80 bits · 10 bytes · 5 words/);assert.match(detail,/96 bits · 12 bytes · 6 words/);assert.match(detail,/0x3000 · 16 bits · 1 word/);assert.match(detail,/-24 dBm/);assert.match(detail,/923\.25 MHz/);
  assert.equal(a.doc.querySelectorAll('#tagDetails .bankraw').length,3);assert.ok([...a.doc.querySelectorAll('#tagDetails .asciiValue code')].some(node=>node.textContent==='HELLO RFID'));assert.match(detail,/ASCII \(7-bit\)/);assert.match(detail,/แทน byte ที่พิมพ์ไม่ได้ด้วย ·/);
 }finally{a.close();}
});

