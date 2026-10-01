const $=id=>document.getElementById(id);let endpoint='',busy=false;const format=()=>document.querySelector('[name=format]:checked').value;
function bytes(){const raw=$('data').value;if(format()==='ASCII'){if(/[^\x00-\x7f]/.test(raw))throw Error('ASCII รองรับเฉพาะอักขระ 0–127 กรุณาใช้ HEX สำหรับข้อมูลอื่น');return Array.from(raw,c=>c.charCodeAt(0));}const hex=raw.replace(/\s/g,'');if(!/^[0-9a-f]*$/i.test(hex)||hex.length%2)throw Error('HEX ต้องเป็น 0–9, A–F และครบคู่ เช่น 48 45 4C 4C 4F');return (hex.match(/../g)||[]).map(x=>parseInt(x,16));}
function update(){try{const n=bytes().length;$('length').value=String(n);$('count').textContent=n+' bytes';$('error').textContent='';}catch(e){$('length').value='—';$('count').textContent='ข้อมูลไม่ถูกต้อง';$('error').textContent=e.message;}$('hint').textContent=format()==='ASCII'?'ASCII รองรับตัวอักษรอังกฤษ ตัวเลข และสัญลักษณ์':'ใส่เลขฐานสิบหกเป็นคู่ คั่นด้วยช่องว่างได้';$('write').disabled=busy||!endpoint;}
function payload(){const epc=$('epc').value.trim().toUpperCase();if(!/^(?:[0-9A-F]{2})+$/.test(epc))throw Error('กรุณาระบุ EPC เป็นเลขฐานสิบหกครบคู่');const bank=$('memoryBank').value;if(!['USER','EPC','TID','RESERVED'].includes(bank))throw Error('เลือก Memory Bank');const offset=Number($('offset').value);if($('offset').value===''||!Number.isSafeInteger(offset)||offset<0||offset%2)throw Error('Offset ต้องเป็นจำนวนเต็มคู่ ตั้งแต่ 0 ขึ้นไป');const b=bytes();if(!b.length)throw Error('กรุณากรอกข้อมูลที่ต้องการเขียน');if(b.length%2)throw Error('ข้อมูลต้องมีจำนวนไบต์เป็นเลขคู่ กรุณาเพิ่มข้อมูลอีก 1 byte (ระบบไม่เติมข้อมูลอัตโนมัติ)');return {requestId:crypto.randomUUID(),operation:'write',memoryBank:$('memoryBank').value,epc,offsetBytes:offset,lengthBytes:b.length,encoding:format(),dataHex:b.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase()};}
function result(kind,title,message){const r=$('result');r.className=kind;r.replaceChildren();const icon=document.createElement('div');icon.className='resulticon';icon.textContent=kind==='success'?'✓':kind==='failure'?'!':'…';const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=message;r.append(icon,h,p);}
const saveEndpoint=$('save');if(saveEndpoint)saveEndpoint.onclick=()=>{try{const u=new URL($('endpoint').value.trim());if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error();endpoint=u.href;$('configstatus').textContent='กำหนด URL แล้ว · ยังไม่ได้ทดสอบการเชื่อมต่อ';document.querySelector('.connection').textContent='กำหนด webhook แล้ว';$('below').textContent='ตรวจสอบ EPC และข้อมูลก่อนเขียนลงแท็ก';update();}catch{$('configstatus').textContent='กรุณาระบุ HTTPS URL ที่ถูกต้อง โดยไม่ใส่รหัสผ่านใน URL';}};
$('writer').onsubmit=async e=>{e.preventDefault();if(busy)return;try{if(!endpoint)throw Error('กรุณากำหนด webhook ก่อน');const body=payload();busy=true;update();$('write').textContent='กำลังส่งคำสั่ง…';result('','กำลังรอผลการเขียน','อย่ากดส่งซ้ำขณะรอผล');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000),credentials:'omit',redirect:'error'});if(!response.ok)throw Error('Webhook ตอบกลับ HTTP '+response.status);const data=await response.json();if(data.requestId!==body.requestId||data.epc?.toUpperCase()!==body.epc)throw Error('ผลตอบกลับไม่ตรงกับคำสั่งหรือ EPC ที่ส่ง');if(data.status==='success'){result('success','เขียนข้อมูลสำเร็จ',`${body.lengthBytes} bytes · Offset ${body.offsetBytes} · EPC ${body.epc}`);}else if(data.status==='failed'){result('failure','เขียนไม่สำเร็จ',String(data.message||'อุปกรณ์รายงานว่าเขียนไม่สำเร็จ'));}else{result('','ยังไม่ยืนยันผลการเขียน','Webhook ยังไม่ส่งผลสำเร็จจากอุปกรณ์ กรุณาตรวจสอบที่ bridge ก่อนส่งใหม่');}}catch(e){$('error').textContent=e.message;if(busy)result('failure','ยังยืนยันผลไม่ได้','ตรวจสอบที่ bridge ก่อนส่งซ้ำ: '+e.message);}finally{busy=false;$('write').innerHTML='<span>✎</span> เขียนข้อมูล USER';$('write').disabled=!endpoint;}};
$('data').addEventListener('input',update);document.querySelectorAll('[name=format]').forEach(el=>el.addEventListener('change',update));update();
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'preview_user_tag_write',description:'Validate current visible USER tag form and return the proposed payload without sending or writing a tag.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{try{return {valid:true,payload:payload()};}catch(e){return {valid:false,error:e.message};}}})).catch(()=>{});}catch{}}

const feedList=document.getElementById('eventList');
const LIVE_TAG_TTL_MS=5000;
let olderCursor=null,onOlderPage=false,feedLoading=false,liveBusy=false,feedSignature='',latestId=0,visibleEvents=[],pendingEvents=0,selectedEpc='';
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;}
function findEpcs(value){
 const found=new Set(),queue=[value];
 while(queue.length){const v=queue.shift();if(!v||typeof v!=='object')continue;
 for(const [k,x] of Object.entries(v)){if(typeof x==='string'&&/^(epc|epcHex|idHex)$/i.test(k)&&/^(?:[0-9a-f]{2})+$/i.test(x)&&!(k==='idHex'&&v.format&&String(v.format).toLowerCase()!=='epc'))found.add(x.toUpperCase());else if(x&&typeof x==='object')queue.push(x);}}
 return [...found];
}
function fields(value,prefix='',out=[]){
 if(value!==null&&typeof value==='object'&&Object.keys(value).length){for(const [k,v] of Object.entries(value))fields(v,prefix?prefix+'.'+k:k,out);}
 else out.push([prefix||'value',value!==null&&typeof value==='object'?JSON.stringify(value):String(value)]);
 return out;
}
function isRecent(event){const now=Date.now(),at=Date.parse(event.receivedAt);return Number.isFinite(at)&&now-at>=-1000&&now-at<LIVE_TAG_TTL_MS;}
function renderEvents(events){
 const openCards=new Set([...feedList.querySelectorAll('.eventcard[open]')].map(card=>card.dataset.epc||card.dataset.eventId));
 const openRaw=new Set([...feedList.querySelectorAll('details[data-raw-key][open]')].map(card=>card.dataset.rawKey));
 feedList.replaceChildren();
  if(!events.length){feedList.append(el('p','ไม่พบแท็กในช่วง 5 วินาทีล่าสุด · ข้อมูลย้อนหลังยังคงบันทึกไว้','empty'));updateTagDetails(null);return;}
 const grouped=new Map(),display=[];
 for(const event of [...events].sort((a,b)=>Number(a.id)-Number(b.id))){
  const epcs=findEpcs(event.payload);
  if(!epcs.length)continue;
  for(const epc of epcs){const item=grouped.get(epc)||{event,epc,count:0};item.event=event;item.count++;grouped.set(epc,item);}
 }
  display.push(...grouped.values());
  display.sort((a,b)=>Date.parse(b.event.receivedAt)-Date.parse(a.event.receivedAt));
  if(!display.length){feedList.append(el('p','ยังไม่มีข้อมูล EPC ในช่วง 5 วินาทีล่าสุด','empty'));updateTagDetails(null);return;}
  const selected=display.find(item=>item.epc===selectedEpc)||display[0];selectedEpc=selected.epc;updateTagDetails(selected);
  for(const item of display){
  const event=item.event;
  const card=el('details',undefined,'eventcard'),summary=el('summary');
  card.dataset.epc=item.epc||'';card.dataset.eventId=String(event.id);
  if(openCards.has(card.dataset.epc||card.dataset.eventId))card.open=true;
  summary.append(el('strong',item.epc?item.epc+' · อ่านพบ '+item.count+' ครั้ง':'Event / สถานะเครื่อง'),el('span',new Date(event.receivedAt).toLocaleString('th-TH')+' · #'+event.id));
  card.append(summary);summary.addEventListener('click',()=>{selectedEpc=item.epc;updateTagDetails(item);});
  const buttons=el('div',undefined,'epcButtons');
  if(item.epc){const button=el('button','ใช้ EPC '+item.epc);button.type='button';button.onclick=()=>{selectedEpc=item.epc;updateTagDetails(item);$('epc').value=item.epc;$('epc').scrollIntoView({behavior:'smooth',block:'center'});$('epc').focus();};buttons.append(button);}
  card.append(buttons);if(item.epc)card.append(memorySummary(event.payload,item.epc,item.count,event.receivedAt));
  const table=el('table'),tbody=el('tbody');
  for(const [key,value] of fields(event.payload)){const tr=el('tr');tr.append(el('th',key),el('td',value));tbody.append(tr);}table.append(tbody);card.append(table);
  const raw=el('details'),rawLabel=el('summary','JSON ต้นฉบับครบทุกฟิลด์');raw.dataset.rawKey=item.epc?'raw-'+item.epc:'raw-event-'+event.id;if(openRaw.has(raw.dataset.rawKey))raw.open=true;raw.append(rawLabel,el('pre',JSON.stringify(event.payload,null,2)));card.append(raw);feedList.append(card);
 }
}
function readSummary(events){const epcs=new Set();let reads=0;for(const event of events){const values=findEpcs(event.payload);reads+=values.length;for(const epc of values)epcs.add(epc);}return epcs.size+' แท็กไม่ซ้ำ · '+reads+' ครั้งที่อ่าน';}
async function loadEvents(before=null,manual=false){
 if(feedLoading)return;feedLoading=true;
 try{
  const response=await fetch('/api/events'+(before?'?before='+before:''),{cache:'no-store',signal:AbortSignal.timeout(12000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'โหลดข้อมูลไม่ได้');
  olderCursor=data.nextBefore;onOlderPage=!!before;
  visibleEvents=onOlderPage?data.events:data.events.filter(isRecent);for(const item of data.events)latestId=Math.max(latestId,Number(item.id));pendingEvents=0;
  const signature=visibleEvents.map(e=>e.id).join(',');
  renderEvents(visibleEvents);feedSignature=signature;
  $('olderEvents').hidden=!olderCursor;
  $('feedStatus').textContent=(onOlderPage?'รายการก่อนหน้า':'LIVE · ล้างเมื่อไม่พบแท็ก 5 วินาที')+' · '+readSummary(visibleEvents);
 }catch(e){$('feedStatus').textContent='โหลดข้อมูลไม่ได้: '+e.message+' · จะลองใหม่อัตโนมัติ';}
 finally{feedLoading=false;}
}
$('latestEvents').onclick=()=>loadEvents(null,true);
$('olderEvents').onclick=()=>olderCursor&&loadEvents(olderCursor,true);
async function pollLive(){
 if(document.hidden||liveBusy)return;liveBusy=true;
 try{
  const response=await fetch('/api/events/live?after='+latestId,{cache:'no-store',signal:AbortSignal.timeout(8000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'รับข้อมูลสดไม่ได้');
  if(data.events.length){for(const item of data.events)latestId=Math.max(latestId,Number(item.id));
   if(onOlderPage){pendingEvents+=data.events.length;$('latestEvents').textContent='ข้อมูลล่าสุด (+'+pendingEvents+')';}
   else {const combined=[...data.events,...visibleEvents];const unique=[...new Map(combined.map(item=>[Number(item.id),item])).values()].sort((a,b)=>Number(b.id)-Number(a.id));visibleEvents=unique.filter(isRecent).slice(0,50);olderCursor=unique.length>50?unique[49].id:olderCursor;renderEvents(visibleEvents);feedSignature=visibleEvents.map(e=>e.id).join(',');$('olderEvents').hidden=!olderCursor;$('feedStatus').textContent='LIVE · '+readSummary(visibleEvents);}
  }
  if(!data.events.length&&!onOlderPage){if(!visibleEvents.length)renderEvents([]);$('feedStatus').textContent='LIVE · '+readSummary(visibleEvents);}
 }catch(e){$('feedStatus').textContent='เชื่อมต่อข้อมูลสดไม่ได้: '+e.message+' · กำลังลองใหม่';}
 finally{liveBusy=false;}
}
function expireOldReads(){
 if(onOlderPage)return;
 const current=visibleEvents.filter(isRecent);
 if(current.length===visibleEvents.length)return;
 visibleEvents=current;renderEvents(visibleEvents);feedSignature=visibleEvents.map(e=>e.id).join(',');
 $('feedStatus').textContent=visibleEvents.length?'LIVE · '+readSummary(visibleEvents):'ไม่พบแท็กใน 5 วินาทีล่าสุด';
}
let statusBusy=false;
function setReaderStatus(state,label){const node=$('readerStatus');if(!node)return;node.classList.remove('online','offline','unknown');node.classList.add(state);node.replaceChildren(el('i'),document.createTextNode(label));}
function elapsedLabel(ms){if(ms<1000)return 'เมื่อสักครู่';if(ms<60000)return Math.floor(ms/1000)+' วินาทีที่แล้ว';return Math.floor(ms/60000)+' นาทีที่แล้ว';}
async function pollReaderStatus(){
 if(document.hidden||statusBusy)return;statusBusy=true;
 try{
  const response=await fetch('/api/reader/status',{cache:'no-store',signal:AbortSignal.timeout(8000)}),data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||'อ่านสถานะ heartbeat ไม่ได้');
  const latest=data.readers?.[0];
  if(!latest){setReaderStatus('unknown','ยังไม่พบ Heartbeat · เลือก Management Events Interface');return;}
  const at=Date.parse(latest.receivedAt),age=Math.max(0,Date.now()-at),previous=Date.parse(latest.previousAt||'');
  const timeout=Number.isFinite(previous)?Math.max(5000,Math.min(60000,(at-previous)*3)):180000;
  const online=Number.isFinite(at)&&age<=timeout;
  setReaderStatus(online?'online':'offline',(online?'ออนไลน์':'ออฟไลน์')+' · '+latest.readerKey+' · Heartbeat '+elapsedLabel(age));
 }catch(e){setReaderStatus('unknown','เชื่อมต่อสถานะไม่ได้ · กำลังลองใหม่');}
 finally{statusBusy=false;}
}
$('latestEvents').textContent='ข้อมูลล่าสุด';
document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollLive();pollReaderStatus();}});

loadEvents();
setInterval(()=>{pollLive();expireOldReads();},500);
pollReaderStatus();setInterval(pollReaderStatus,1000);

function updateTagDetails(item){
 const panel=$('tagDetails');if(!panel)return;
 if(!item){selectedEpc='';panel.replaceChildren(el('p','ยังไม่พบแท็กในช่วง 5 วินาทีล่าสุด · รายละเอียดจะแสดงเมื่อ reader อ่านพบแท็ก','empty'));return;}
 panel.replaceChildren(memorySummary(item.event.payload,item.epc,item.count,item.event.receivedAt));
}
function memorySummary(payload,epc,count=1,receivedAt=''){
 const root=el('div',undefined,'capacity');const openBanks=new Set([...$('tagDetails')?.querySelectorAll('details[data-bank][open]')||[]].map(node=>node.dataset.bank));const queue=[payload];let record=null;
 while(queue.length){const value=queue.shift();if(!value||typeof value!=='object')continue;
  if(Object.entries(value).some(([key,x])=>/^(epc|epcHex|idHex)$/i.test(key)&&typeof x==='string'&&x.toUpperCase()===epc)){record=value;break;}
  for(const nested of Object.values(value))if(nested&&typeof nested==='object')queue.push(nested);
 }
 const data=record?{...record,...(record.data&&typeof record.data==='object'&&!Array.isArray(record.data)?record.data:{})}:{};
 const lookup=(...names)=>{const wanted=names.map(name=>name.toLowerCase());const pair=Object.entries(data).find(([key,value])=>wanted.includes(key.toLowerCase())&&value!==undefined&&value!==null);return pair?.[1];};
 const asHex=value=>{
  if(typeof value==='string'){const hex=value.replace(/^0x/i,'').replace(/[\s:-]/g,'');return /^(?:[a-f0-9]{2})+$/i.test(hex)?hex.toUpperCase():null;}
  if(Array.isArray(value)&&value.length&&value.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))return value.map(byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(value&&typeof value==='object')for(const key of ['hex','dataHex','valueHex','value','data']){const hex=asHex(value[key]);if(hex)return hex;}
  return null;
 };
 root.append(el('h3','EPC · '+epc,'tagEpc'),el('small','อ่านพบ '+count+' ครั้ง'+(receivedAt?' · '+new Date(receivedAt).toLocaleString('th-TH'):''),'tagReadTime'));
 const table=el('table'),tbody=el('tbody');
 for(const bank of ['EPC','TID','USER','RESERVED']){
  const raw=lookup(bank),hex=bank==='EPC'?(asHex(raw)||asHex(epc)):asHex(raw),tr=el('tr');tr.append(el('th',bank));
  const cell=el('td');
  if(hex){const words=hex.length/4;cell.append(el('strong',(hex.length*4)+' bits · '+(hex.length/2)+' bytes · '+words+' '+(words===1?'word':'words')));const details=el('details',undefined,'bankraw');details.dataset.bank=bank;if(openBanks.has(bank))details.open=true;details.append(el('summary','ดูค่า HEX'));const value=el('code',hex);details.append(value);cell.append(details);}
  else cell.textContent=raw===undefined?'ไม่พบข้อมูลจาก reader':'มีข้อมูล แต่รูปแบบไม่ใช่ HEX';
  tr.append(cell);tbody.append(tr);
 }
 table.append(tbody);root.append(table,el('small','คำนวณจากข้อมูลที่ FX9600 ส่งมา ไม่ใช่ความจุสูงสุดของชิป · 1 word = 16 bits = 2 bytes'));
 const meta=el('dl',undefined,'tagMetadata');
 const values=[['PC',lookup('PC')],['CRC',lookup('CRC')],['เสาอากาศ',lookup('antenna')],['RSSI สูงสุด',lookup('peakRssi')],['ช่องความถี่',lookup('channel')],['รูปแบบ',lookup('format')],['เครื่องอ่าน',lookup('hostName')],['Event',lookup('eventNum')]];
 for(const [label,value] of values)if(value!==undefined){let shown=String(value);if(label==='PC'||label==='CRC'){const hex=asHex(value);if(hex)shown='0x'+hex+' · '+(hex.length*4)+' bits · '+(hex.length/4)+' words';}else if(label==='RSSI สูงสุด')shown+=' dBm';else if(label==='ช่องความถี่')shown+=' MHz';const item=el('div',undefined,'tagMetric');item.append(el('dt',label),el('dd',shown));meta.append(item);}
 if(meta.childElementCount)root.append(meta);
 return root;
}
$('memoryBank').addEventListener('change',()=>{
 const bank=$('memoryBank').value;$('offset').value=bank==='EPC'?'4':'0';
 $('bankNote').textContent=bank==='TID'?'TID มักล็อกถาวรจากโรงงาน เขียนได้เฉพาะชิปที่รองรับ':bank==='RESERVED'?'Reserved เก็บ Kill/Access password ต้องตรวจค่าก่อนเขียน':bank==='EPC'?'เริ่มที่ byte 4 (word 2) เพื่อไม่ทับ CRC/PC':'เขียน USER Memory';update();
});
