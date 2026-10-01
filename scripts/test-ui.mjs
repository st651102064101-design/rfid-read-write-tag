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
 const state={events,live:[],readers:[],fail:false,writeAvailable:false,lastWrite:null,writeResult:null,...options};
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{url:'https://test/',pretendToBeVisual:true,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.Date.now=()=>now;w.AbortSignal=AbortSignal;
  w.setInterval=(fn,delay)=>{timers.push({fn,delay});return timers.length;};
  Object.defineProperty(w.crypto,'randomUUID',{value:()=> 'test-request-id-1234'});
  w.fetch=async(url,init)=>{calls.push(url);if(state.fail)throw Error('Network unavailable');
   if(url==='/api/write'&&init?.method==='POST'){const body=JSON.parse(init.body);state.lastWrite=body;const result=state.writeResult?.(body)||{requestId:body.requestId,epc:body.epc,status:'success',verified:true,newEpc:body.epc};return {ok:true,json:async()=>result};}
   const body=url.startsWith('/api/write/config')?{ok:true,available:state.writeAvailable}:url.startsWith('/api/reader/status')?{ok:true,readers:state.readers}:url.startsWith('/api/events/live')?{ok:true,events:state.live}:{ok:true,events:state.events,nextBefore:null};
   return {ok:true,json:async()=>body};
  };
 }});
 await new Promise(resolve=>setImmediate(resolve));
 return {dom,state,errors,calls,timers,doc:dom.window.document,advance:ms=>{now+=ms;},async tick(delay){for(const t of timers.filter(t=>t.delay===delay))t.fn();await new Promise(resolve=>setImmediate(resolve));},close(){dom.window.close();}};
}
const event=(id,epc='AABB',age=0)=>({id,receivedAt:new Date(Date.now()-age).toISOString(),payload:{tag_reads:[{epc,isHeartBeat:'false'}]}});
const writableEvent=(id,epc='AABB',user='00'.repeat(256))=>({...event(id,epc),payload:[{type:'INVENTORY',data:{idHex:epc,USER:user}}]});
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
test('odd byte payloads are submitted at exact length without adding 00',async()=>{
 const a=await setup([writableEvent(1)],{writeAvailable:true});try{a.doc.getElementById('epc').value='AABB';a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));assert.equal(a.doc.getElementById('autoPad'),null);const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));const data=a.doc.getElementById('data');data.value='BOX-008';data.dispatchEvent(new a.dom.window.Event('input'));
  assert.equal(a.doc.getElementById('length').value,'7');assert.equal(a.doc.getElementById('count').textContent,'7 / 256 bytes');assert.match(a.doc.getElementById('paddingNote').textContent,/รักษาไบต์ถัดไปเดิม/);assert.equal(a.doc.getElementById('write').disabled,false);
  await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));assert.equal(a.state.lastWrite.lengthBytes,7);assert.equal(a.state.lastWrite.dataHex.length,14);assert.equal(a.state.lastWrite.dataHex.endsWith('00'),false);
  data.value='BOX-0080';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('length').value,'8');assert.equal(a.doc.getElementById('count').textContent,'8 / 256 bytes');assert.match(a.doc.getElementById('paddingNote').textContent,/จำนวนไบต์เป็นเลขคู่/);assert.equal(a.doc.getElementById('write').disabled,false);
 }finally{a.close();}
});
test('write input is bounded by observed bank capacity and supports one byte',async()=>{
 const a=await setup([writableEvent(1,'AABB','00'.repeat(4))],{writeAvailable:true});try{
  const select=a.doc.getElementById('epc');select.value='AABB';select.dispatchEvent(new a.dom.window.Event('change'));
  const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));
  const data=a.doc.getElementById('data');data.value='';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('error').textContent,'กรอกข้อมูลอย่างน้อย 1 byte');assert.equal(a.doc.getElementById('paddingNote').textContent,'');assert.equal((a.doc.getElementById('error').textContent+a.doc.getElementById('paddingNote').textContent).match(/กรอกข้อมูลอย่างน้อย 1 byte/g).length,1);
  data.value='ABCDE';data.dispatchEvent(new a.dom.window.Event('input'));
  assert.equal(a.doc.getElementById('write').disabled,true);assert.equal(data.maxLength,4);assert.match(a.doc.getElementById('error').textContent,/สูงสุด 4 bytes/);
  data.value='A';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('write').disabled,false);assert.match(a.doc.getElementById('count').textContent,/1 \/ 4 bytes/);
  data.value='ABCD';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('write').disabled,false);assert.match(a.doc.getElementById('count').textContent,/4 \/ 4 bytes/);assert.match(a.doc.getElementById('paddingNote').textContent,/วัดได้ 4 bytes/);
  a.doc.getElementById('offset').value='2';a.doc.getElementById('offset').dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('write').disabled,true);assert.match(a.doc.getElementById('error').textContent,/สูงสุด 2 bytes/);
 }finally{a.close();}
});
test('unknown or unreadable bank capacity blocks writes with an explanation',async()=>{
 const e=event(1,'CCDD');e.payload=[{type:'INVENTORY',data:{idHex:'CCDD',USER:'Error: tag returned error code 0x03 = Memory overrun'}}];const a=await setup([e],{writeAvailable:true});try{
  a.doc.getElementById('epc').value='CCDD';a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));
  const data=a.doc.getElementById('data');data.value='ABCD';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('write').disabled,true);assert.match(a.doc.getElementById('error').textContent,/ยังไม่ทราบขนาด USER/);assert.equal(data.hasAttribute('maxlength'),false);
 }finally{a.close();}
});
test('switching ASCII and HEX preserves the entered bytes',async()=>{
 const a=await setup([writableEvent(1)],{writeAvailable:true});try{a.doc.getElementById('epc').value='AABB';a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));
 const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));
 const data=a.doc.getElementById('data'),ascii=a.doc.querySelector('[name=format][value="ASCII"]'),hex=a.doc.querySelector('[name=format][value="HEX"]');data.value='BOX-0070';data.dispatchEvent(new a.dom.window.Event('input'));
 hex.checked=true;hex.dispatchEvent(new a.dom.window.Event('change'));assert.equal(data.value,'424F582D30303730');assert.equal(a.doc.getElementById('length').value,'8');assert.equal(a.doc.getElementById('write').disabled,false);
 ascii.checked=true;ascii.dispatchEvent(new a.dom.window.Event('change'));assert.equal(data.value,'BOX-0070');assert.equal(a.doc.getElementById('length').value,'8');assert.equal(a.doc.getElementById('write').disabled,false);
 }finally{a.close();}
});
test('verified write shows a success toast fixed at the bottom-right',async()=>{
 const a=await setup([writableEvent(1,'AABB')],{writeAvailable:true});try{a.doc.getElementById('epc').value='AABB';a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));const data=a.doc.getElementById('data');data.value='EVEN';data.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('write').disabled,false);
  await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));const toast=a.doc.getElementById('toast');assert.equal(toast.hidden,false);assert.ok(toast.classList.contains('success'));assert.match(toast.textContent,/เขียนข้อมูลสำเร็จ/);assert.match(a.doc.getElementById('tagDetails').textContent,/EPC · AABB/);
  assert.match(readFileSync('public/style.css','utf8'),/\.toast\{position:fixed;right:24px;bottom:24px/);
 }finally{a.close();}
});
test('unconfirmed writes show the bridge reason instead of a generic warning',async()=>{
 const reason='Timed out waiting for hardware result. Do not repeat without checking the tag.',a=await setup([writableEvent(1,'AABB')],{writeAvailable:true,writeResult:body=>({requestId:body.requestId,epc:body.epc,status:'unknown',verified:false,message:reason})});try{a.doc.getElementById('epc').value='AABB';a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));
 const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));const data=a.doc.getElementById('data');data.value='EVEN';data.dispatchEvent(new a.dom.window.Event('input'));
 await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));assert.match(a.doc.getElementById('toast').textContent,/ไม่ได้รับผลยืนยันจาก FX9600/);assert.match(a.doc.getElementById('result').textContent,/USER · 4 bytes/);assert.match(a.doc.getElementById('result').textContent,/ป้องกันการเขียนซ้ำ/);
 }finally{a.close();}
});
test('insufficient-power tag error explains RF checks instead of implying a data-size issue',async()=>{
 const a=await setup([writableEvent(1,'AABB')],{writeAvailable:true,writeResult:body=>({requestId:body.requestId,epc:body.epc,status:'failed',verified:false,message:'Error: tag returned error code 0x0b = Insufficient power'})});try{
  a.doc.getElementById('epc').value='AABB';a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));const bank=a.doc.getElementById('memoryBank');bank.value='USER';bank.dispatchEvent(new a.dom.window.Event('change'));const data=a.doc.getElementById('data');data.value='55';data.dispatchEvent(new a.dom.window.Event('input'));
  await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));assert.match(a.doc.getElementById('toast').textContent,/พลังงาน RF ที่แท็กได้รับไม่พอ/);assert.match(a.doc.getElementById('result').textContent,/TX Power/);assert.match(a.doc.getElementById('result').textContent,/ห้ามเกินข้อจำกัด/);
 }finally{a.close();}
});
test('ASCII EPC replacement keeps current EPC length and previews all leading zero bytes',async()=>{
 const original='0000000000424F582D303130',a=await setup([event(1,original)],{writeAvailable:true});try{
 const select=a.doc.getElementById('epc');select.value=original;select.dispatchEvent(new a.dom.window.Event('change'));
 const data=a.doc.getElementById('data');data.value='BOX-007';data.dispatchEvent(new a.dom.window.Event('input'));
  assert.equal(a.doc.getElementById('length').value,'12');assert.equal(a.doc.getElementById('count').textContent,'12 / 12 bytes');
 assert.match(a.doc.getElementById('paddingNote').textContent,/เติม 00 ด้านหน้า 5 bytes/);assert.match(a.doc.getElementById('paddingNote').textContent,/HEX ที่จะเขียน: 0000000000424F582D303037/);assert.equal(a.doc.getElementById('write').disabled,false);
 await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));
 assert.deepEqual({bank:a.state.lastWrite.memoryBank,offset:a.state.lastWrite.offsetBytes,length:a.state.lastWrite.lengthBytes,epc:a.state.lastWrite.epc,hex:a.state.lastWrite.dataHex},{bank:'EPC',offset:4,length:12,epc:original,hex:'0000000000424F582D303037'});
 }finally{a.close();}
});
test('verified EPC write selects the new EPC immediately and keeps it selected pending the next reader event',async()=>{
 const original='0000000000424F582D303130',updated='0000000000424F582D303037';
 const a=await setup([event(1,original)],{writeAvailable:true,writeResult:body=>({requestId:body.requestId,epc:body.epc,status:'success',verified:true,newEpc:updated})});try{
 const select=a.doc.getElementById('epc');select.value=original;select.dispatchEvent(new a.dom.window.Event('change'));
 const data=a.doc.getElementById('data');data.value='BOX-007';data.dispatchEvent(new a.dom.window.Event('input'));
 await a.doc.getElementById('writer').onsubmit(new a.dom.window.Event('submit',{cancelable:true}));
 assert.equal(select.value,updated);assert.match([...select.options].find(option=>option.value===updated).textContent,/เขียนแล้ว · รอ reader อ่านซ้ำ/);
 assert.match(a.doc.getElementById('tagDetails').textContent,new RegExp(updated));assert.equal(a.doc.getElementById('write').disabled,false);
 a.state.live=[event(2,updated)];await a.tick(500);assert.equal(select.value,updated);assert.doesNotMatch([...select.options].find(option=>option.value===updated).textContent,/รอ reader อ่านซ้ำ/);
 }finally{a.close();}
});
test('tags are separated by observed USER read capability in cards, dropdown, and editor',async()=>{
 const epc1='AABB',epc2='CCDD',epc3='EEFF';
 const supported=event(1,epc1);supported.payload=[{type:'INVENTORY',data:{idHex:epc1,USER:'4142'}}];
 const overrun=event(2,epc2);overrun.payload=[{type:'CUSTOM',data:{idHex:epc2,MAC:'C4:7D:CC:74:AF:20',accessResults:['aabb','e280689420005026ce01a477','0000000000000000','Error: tag returned error code 0x03 = Memory overrun']}}];
 const unknown=event(3,epc3);const a=await setup([supported,overrun,unknown]);try{
  const options=[...a.doc.querySelectorAll('#epc option')].map(option=>option.textContent);assert.ok(options.some(option=>option.includes('AABB')&&option.includes('USER อ่านได้')));assert.ok(options.some(option=>option.includes('CCDD')&&option.includes('Memory overrun')));assert.ok(options.some(option=>option.includes('EEFF')&&option.includes('USER ยังไม่ทราบ')));
  assert.equal(a.doc.querySelectorAll('#eventList .tagCapability').length,0);
  a.doc.getElementById('epc').value=epc2;a.doc.getElementById('epc').dispatchEvent(new a.dom.window.Event('change'));assert.match(a.doc.getElementById('userCapability').textContent,/Memory overrun/);assert.match(a.doc.getElementById('userCapability').textContent,/ยังยืนยันการเขียนไม่ได้/);
 }finally{a.close();}
});
test('tag card selection toggles on and off and stays cleared during live updates',async()=>{
 const a=await setup([event(2,'CCDD'),event(1,'AABB')]);try{const button=[...a.doc.querySelectorAll('.chooseTag')].find(node=>node.getAttribute('aria-label')==='เลือก EPC CCDD ในฟอร์มเขียน');assert.ok(button);button.click();assert.equal(a.doc.getElementById('epc').value,'CCDD');assert.equal(button.getAttribute('aria-pressed'),'true');assert.match(button.textContent,/เลือกอยู่ · แตะเพื่อยกเลิก/);assert.match(a.doc.getElementById('tagDetails').textContent,/EPC · CCDD/);assert.equal(a.doc.querySelectorAll('#epc option').length,3);
  button.click();assert.equal(a.doc.getElementById('epc').value,'');assert.equal(button.getAttribute('aria-pressed'),'false');assert.match(a.doc.getElementById('tagDetails').textContent,/ยังไม่พบแท็ก/);
  a.state.live=[event(3,'EEFF')];await a.tick(500);assert.equal(a.doc.getElementById('epc').value,'');assert.equal(a.doc.querySelector('.chooseTag.selected'),null);
 }finally{a.close();}
});
test('filter modal searches live tags and closes back to its trigger',async()=>{
 const a=await setup([event(2,'0000424F582D303037'),event(1,'CCDD')]);try{
  const search=a.doc.getElementById('tagSearch');search.value='BOX-007';search.dispatchEvent(new a.dom.window.Event('input'));
  assert.equal([...a.doc.querySelectorAll('.eventitem')].filter(row=>!row.hidden).length,1);
  a.state.live=[event(3,'EEFF')];await a.tick(500);assert.equal([...a.doc.querySelectorAll('.eventitem')].filter(row=>!row.hidden).length,1);
  search.value='missing';search.dispatchEvent(new a.dom.window.Event('input'));assert.match(a.doc.getElementById('searchStatus').textContent,/ไม่พบแท็ก/);
  search.value='';search.dispatchEvent(new a.dom.window.Event('input'));assert.equal(a.doc.getElementById('searchStatus').hidden,true);
  a.doc.getElementById('openTagFilter').click();assert.ok(a.doc.getElementById('tagFilterDialog').hasAttribute('open'));a.doc.getElementById('applyTagFilter').click();assert.equal(a.doc.getElementById('tagFilterDialog').hasAttribute('open'),false);assert.equal(a.doc.activeElement,a.doc.getElementById('openTagFilter'));
 }finally{a.close();}
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


test('USER filters separate readable, overrun and unknown results without declaring chip support',async()=>{const overrun=event(2,'CCDD');overrun.payload=[{type:'INVENTORY',data:{idHex:'CCDD',USER:'Error: Memory overrun'}}];const a=await setup([writableEvent(1),overrun,event(3,'EEFF')]);try{assert.equal(a.doc.querySelector('[data-filter-count=all]').textContent,'3');const filter=a.doc.querySelector('[name=tagGroup][value=readable]');filter.checked=true;filter.dispatchEvent(new a.dom.window.Event('change'));assert.equal([...a.doc.querySelectorAll('.eventitem')].filter(row=>!row.hidden).length,1);assert.equal(a.doc.querySelector('[data-filter-count=overrun]').textContent,'1');a.doc.getElementById('resetTagFilter').click();assert.equal([...a.doc.querySelectorAll('.eventitem')].filter(row=>!row.hidden).length,3);assert.ok([...a.doc.querySelectorAll('.chooseTag')].every(button=>button.hidden));}finally{a.close();}});

test('clicking a tag selects without expanding, while the details icon expands independently',async()=>{const a=await setup([event(2,'CCDD'),event(1,'AABB')]);try{const rows=[...a.doc.querySelectorAll('.eventitem')],row=rows.find(row=>row.querySelector('.eventcard').dataset.epc==='CCDD'),other=rows.find(row=>row!==rows[0]);const card=row.querySelector('.eventcard');card.querySelector('summary').click();assert.equal(a.doc.getElementById('epc').value,'CCDD');assert.equal(card.open,false);assert.equal(card.querySelector('summary').getAttribute('aria-pressed'),'true');const detail=other.querySelector('.tagDetailButton');assert.ok(detail.querySelector('svg'));detail.click();assert.equal(other.querySelector('.eventcard').open,true);assert.equal(detail.getAttribute('aria-expanded'),'true');assert.equal(a.doc.getElementById('epc').value,'CCDD');detail.click();assert.equal(other.querySelector('.eventcard').open,false);}finally{a.close();}});
