const $=id=>document.getElementById(id);let endpoint='',busy=false;const tagChoices=new Map();const format=()=>document.querySelector('[name=format]:checked').value;
function decodeBytes(raw,encoding){if(encoding==='ASCII'){if(/[^\x00-\x7f]/.test(raw))throw Error('ASCII รองรับเฉพาะอักขระ 0–127 กรุณาใช้ HEX สำหรับข้อมูลอื่น');return Array.from(raw,c=>c.charCodeAt(0));}const hex=raw.replace(/\s/g,'');if(!/^[0-9a-f]*$/i.test(hex)||hex.length%2)throw Error('HEX ต้องเป็น 0–9, A–F และครบคู่ เช่น 48 45 4C 4C 4F');return (hex.match(/../g)||[]).map(x=>parseInt(x,16));}
function bytes(){return decodeBytes($('data').value,format());}
let previousFormat=format();
function changeFormat(){const next=format();if(next===previousFormat)return;try{const value=decodeBytes($('data').value,previousFormat);if(next==='ASCII'&&value.some(byte=>byte<32||byte>126))throw Error('ข้อมูล HEX มีไบต์ที่พิมพ์เป็น ASCII ไม่ได้ · คงโหมด HEX ไว้');$('data').value=next==='HEX'?value.map(byte=>byte.toString(16).padStart(2,'0').toUpperCase()).join(''):String.fromCharCode(...value);previousFormat=next;$('error').textContent='';update();}catch(error){document.querySelector('[name=format][value="'+previousFormat+'"]').checked=true;update();$('error').textContent=error.message;}}
function tagDataHex(value){if(typeof value==='string'){const hex=value.replace(/^0x/i,'').replace(/[\s:-]/g,'');return /^(?:[0-9a-f]{2})+$/i.test(hex)?hex:null;}if(Array.isArray(value)&&value.length&&value.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))return value.map(byte=>byte.toString(16).padStart(2,'0')).join('');if(value&&typeof value==='object')for(const key of ['hex','dataHex','valueHex','value','data']){const hex=tagDataHex(value[key]);if(hex)return hex;}return null;}
function preparedBytes(){const value=bytes(),bank=$('memoryBank').value,epc=$('epc').value.trim();if(bank==='EPC'&&format()==='ASCII'&&value.length){if(!/^(?:[0-9A-F]{2})+$/i.test(epc))throw Error('เลือกแท็ก EPC ที่อ่านพบก่อน เพื่อกำหนดความยาว EPC');if(Number($('offset').value)!==4)throw Error('เขียน EPC แบบ ASCII ทั้งชุดต้องเริ่มที่ byte 4 เพื่อรักษา CRC และ PC');const epcLength=epc.length/2;if(value.length>epcLength)throw Error('ข้อความยาวเกิน EPC ปัจจุบัน ('+epcLength+' bytes)');return [...Array(epcLength-value.length).fill(0),...value];}return value;}
function observedBankCapacity(bank,epc){if(bank==='EPC')return /^[0-9a-f]+$/i.test(epc)&&epc.length%2===0?epc.length/2+4:null;const item=tagChoices.get(epc);if(!item?.event)return null;const queue=[item.event.payload],seen=new Set();let candidate=null;while(queue.length){const value=queue.shift();if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);if(Array.isArray(value)){queue.push(...value);continue;}const nestedData=value.data&&typeof value.data==='object'?value.data:{};const recordEpc=value.idHex??value.epcHex??value.epc??value.EPC??nestedData.idHex??nestedData.epcHex??nestedData.epc;if(typeof recordEpc==='string'&&recordEpc.replace(/[^0-9a-f]/gi,'').toUpperCase()===epc.toUpperCase()){candidate={...value,...nestedData};if(value.type==='CUSTOM'&&nestedData.MAC==='C4:7D:CC:74:AF:20'&&Array.isArray(nestedData.accessResults)&&nestedData.accessResults.length===4){for(const [index,name] of ['EPC','TID','RESERVED','USER'].entries())candidate[name]=nestedData.accessResults[index];}break;}for(const nested of Object.values(value))if(nested&&typeof nested==='object')queue.push(nested);}const hex=tagDataHex(candidate?.[bank]??candidate?.[bank.toLowerCase()]);if(!hex)return null;if(bank==='EPC')return Math.max(0,hex.length/2-4);return hex.length/2;}
function update(){let ready=false;try{const raw=bytes(),bank=$('memoryBank').value,epc=$('epc').value.trim(),offset=Number($('offset').value),isEpcAscii=bank==='EPC'&&format()==='ASCII'&&raw.length>0;let output=raw,note='';if(isEpcAscii){output=preparedBytes();const prefix=output.length-raw.length,hex=output.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();note='แทน EPC ทั้งชุด · '+(prefix?'เติม 00 ด้านหน้า '+prefix+' bytes เพื่อคงความยาวเดิม · ':'')+'HEX ที่จะเขียน: '+hex;}else{note=raw.length%2?'จำนวนไบต์เป็นเลขคี่ · จะรักษาไบต์ถัดไปเดิมไว้โดยไม่เติม 00':raw.length?'จำนวนไบต์เป็นเลขคู่':'กรอกข้อมูลก่อนเขียน';}$('length').value=String(output.length);const capacity=observedBankCapacity(bank,epc),maxBytes=capacity===null?null:Math.max(0,capacity-offset),dataInput=$('data');if(maxBytes===null){dataInput.removeAttribute('maxlength');note+=(note?' · ':'')+'ยังไม่ทราบความจุ '+bank+' ของแท็กนี้ · อ่านแท็กและเลือกแท็กที่มีผลอ่าน bank นี้ก่อน';}else{dataInput.maxLength=format()==='ASCII'?maxBytes:Math.max(0,maxBytes*3-1);note+=(note?' · ':'')+'ใส่ได้สูงสุด '+maxBytes+' bytes ณ Offset '+offset+' · วัดได้ '+capacity+' bytes';if(output.length>maxBytes)throw Error('ข้อมูลเกินความจุที่อ่านได้ของ '+bank+' · สูงสุด '+maxBytes+' bytes ที่ Offset '+offset);}$('count').textContent=output.length+' / '+(maxBytes===null?'?':maxBytes)+' bytes';if(output.length<1)throw Error('กรอกข้อมูลอย่างน้อย 1 byte');if(capacity===null)throw Error('ยังไม่ทราบขนาด '+bank+' ของแท็กนี้ · กรุณาเลือกแท็กที่ reader อ่าน bank นี้ได้ก่อนเขียน');$('paddingNote').textContent=note;$('paddingNote').classList.toggle('warning',capacity===null||output.length>maxBytes);$('error').textContent='';ready=output.length>=1&&output.length<=maxBytes;}catch(e){const visibleBytes=(()=>{try{return bytes().length;}catch{return null;}})();$('length').value=(()=>{try{return String(preparedBytes().length);}catch{return visibleBytes===null?'—':String(visibleBytes);}})();$('count').textContent=visibleBytes===null?'ข้อมูลไม่ถูกต้อง':visibleBytes+' / '+(observedBankCapacity($('memoryBank').value,$('epc').value.trim())??'?')+' bytes';$('paddingNote').textContent='';$('paddingNote').classList.remove('warning');$('error').textContent=e.message;}$('hint').textContent=format()==='ASCII'?'ASCII รองรับตัวอักษรอังกฤษ ตัวเลข และสัญลักษณ์':'ใส่เลขฐานสิบหกเป็นคู่ คั่นด้วยช่องว่างได้';$('write').disabled=busy||!endpoint||!ready;}
function payload(){const epc=$('epc').value.trim().toUpperCase();if(!/^(?:[0-9A-F]{2})+$/.test(epc))throw Error('กรุณาระบุ EPC เป็นเลขฐานสิบหกครบคู่');const bank=$('memoryBank').value;if(!['USER','EPC','TID','RESERVED'].includes(bank))throw Error('เลือก Memory Bank');const offset=Number($('offset').value);if($('offset').value===''||!Number.isSafeInteger(offset)||offset<0||offset%2)throw Error('Offset ต้องเป็นจำนวนเต็มคู่ ตั้งแต่ 0 ขึ้นไป');const b=preparedBytes(),capacity=observedBankCapacity(bank,epc);if(capacity===null)throw Error('ยังไม่ทราบขนาด '+bank+' ของแท็กนี้ · กรุณาเลือกแท็กที่ reader อ่าน bank นี้ได้ก่อนเขียน');if(b.length<1)throw Error('กรอกข้อมูลอย่างน้อย 1 byte');if(offset+b.length>capacity)throw Error('ข้อมูลเกินความจุที่อ่านได้ของ '+bank+' · สูงสุด '+Math.max(0,capacity-offset)+' bytes ที่ Offset '+offset);return {requestId:crypto.randomUUID(),operation:'write',memoryBank:$('memoryBank').value,epc,offsetBytes:offset,lengthBytes:b.length,accessPassword:$('accessPassword').value.trim(),confirmSensitive:$('confirmSensitive').checked,encoding:format(),dataHex:b.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase()};}
function result(kind,title,message){const r=$('result');r.className=kind;r.replaceChildren();const icon=document.createElement('div');icon.className='resulticon';icon.textContent=kind==='success'?'✓':kind==='failure'?'!':'…';const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=message;r.append(icon,h,p);}
let toastTimer;function showToast(kind,message){const toast=$('toast');if(!toast)return;clearTimeout(toastTimer);toast.className='toast'+(kind?' '+kind:'');toast.textContent=message;toast.hidden=false;toast.setAttribute('role',kind==='failure'?'alert':'status');toast.setAttribute('aria-live',kind==='failure'?'assertive':'polite');toastTimer=setTimeout(()=>{toast.hidden=true;},5500);}
const saveEndpoint=$('save');if(saveEndpoint)saveEndpoint.onclick=()=>{try{const u=new URL($('endpoint').value.trim());if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error();endpoint=u.href;$('configstatus').textContent='กำหนด URL แล้ว · ยังไม่ได้ทดสอบการเชื่อมต่อ';document.querySelector('.connection').textContent='กำหนด webhook แล้ว';$('below').textContent='ตรวจสอบ EPC และข้อมูลก่อนเขียนลงแท็ก';update();}catch{$('configstatus').textContent='กรุณาระบุ HTTPS URL ที่ถูกต้อง โดยไม่ใส่รหัสผ่านใน URL';}};
function actionableWriteMessage(message){const detail=String(message||'Reader หรือ bridge ไม่ได้ส่งผลยืนยัน');if(/0x0b|insufficient power/i.test(detail))return 'แท็กตอบ 0x0B · พลังงาน RF ที่แท็กได้รับไม่พอสำหรับเขียน · วางแท็กชิดหน้าเสาอากาศและปรับทิศทางแท็ก ตรวจสาย/ขั้วเสาอากาศ และตรวจ TX Power ใน FX9600 โดยห้ามเกินข้อจำกัดของพื้นที่และเสาอากาศ · อ่านแท็กยืนยันค่าก่อนลองใหม่';if(/hardware result not confirmed|timed out waiting for hardware result/i.test(detail))return 'ไม่ได้รับผลยืนยันจาก FX9600 ภายในเวลา · อ่านแท็กและเทียบข้อมูลก่อนส่งคำสั่งอีกครั้ง เพื่อป้องกันการเขียนซ้ำ';return detail;}
function writeFailureMessage(data,body){const detail=actionableWriteMessage(data?.message);return `${body.memoryBank} · ${body.lengthBytes} bytes · ${detail}`;}
$('writer').onsubmit=async e=>{e.preventDefault();if(busy||$('write').disabled)return;try{if(!endpoint)throw Error('ปิดการเขียนแท็กจริงไว้');const body=payload();busy=true;update();$('write').textContent='กำลังส่งคำสั่ง…';result('','กำลังรอผลการเขียน','อย่ากดส่งซ้ำขณะรอผล');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(320000),credentials:'omit',redirect:'error'});if(!response.ok)throw Error((await response.json()).error||('HTTP '+response.status));let data=await response.json();const waitStarted=Date.now();while(data.status==="queued"||data.status==="running"){if(Date.now()-waitStarted>300000){data.status="unknown";break;}await new Promise(resolve=>setTimeout(resolve,600));const reply=await fetch("/api/write/result?requestId="+encodeURIComponent(body.requestId),{signal:AbortSignal.timeout(8000)});if(!reply.ok)throw Error("อ่านผลการเขียนไม่ได้");data=await reply.json();}if(data.requestId!==body.requestId||data.epc?.toUpperCase()!==body.epc)throw Error('ผลตอบกลับไม่ตรงกับคำสั่งหรือ EPC ที่ส่ง');if(data.status==='success'&&data.verified===true){const message=`${body.memoryBank} · ${body.lengthBytes} bytes · อ่านกลับตรงกัน · ${data.newEpc||body.epc}${data.resumeWarning?" · "+data.resumeWarning:""}`;result('success','เขียนข้อมูลสำเร็จ',message);showToast('success','เขียนข้อมูลสำเร็จ · '+message);if(body.memoryBank==='EPC'&&data.newEpc)selectWrittenEpc(data.newEpc);}else if(data.status==='failed'){const message=actionableWriteMessage(data.message||'อุปกรณ์รายงานว่าเขียนไม่สำเร็จ');result('failure','เขียนไม่สำเร็จ',message);showToast('failure','เขียนไม่สำเร็จ · '+message);}else{const message=writeFailureMessage(data,body);result('','ยังยืนยันผลการเขียนไม่ได้',message);showToast('warning','ยังยืนยันผลการเขียนไม่ได้ · '+message);}}catch(e){$('error').textContent=e.message;if(busy){result('failure','ยังยืนยันผลไม่ได้','ตรวจสอบที่ bridge ก่อนส่งซ้ำ: '+e.message);showToast('failure','ยังยืนยันผลไม่ได้ · '+e.message);}}finally{busy=false;$('write').innerHTML=endpoint?'<span>✎</span> เขียนข้อมูลแท็ก':'<span>✎</span> รอการเชื่อมต่อ';update();}};
$('data').addEventListener('input',update);$('offset').addEventListener('input',update);document.querySelectorAll('[name=format]').forEach(el=>el.addEventListener('change',changeFormat));update();
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'preview_user_tag_write',description:'Validate current visible USER tag form and return the proposed payload without sending or writing a tag.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{try{return {valid:true,payload:payload()};}catch(e){return {valid:false,error:e.message};}}})).catch(()=>{});}catch{}}

const feedList=document.getElementById('eventList');
const LIVE_TAG_TTL_MS=5000;
let olderCursor=null,onOlderPage=false,feedLoading=false,liveBusy=false,feedSignature='',latestId=0,visibleEvents=[],pendingEvents=0,selectedEpc='',selectionInitialized=false;
let tagOptionEvents=new Set(),tagOptionsDirty=false;
function rememberTags(events){
 for(const event of events){const eventKey=String(event.id??event.receivedAt);if(tagOptionEvents.has(eventKey))continue;tagOptionEvents.add(eventKey);const epcs=findEpcs(event.payload);for(const epc of epcs){const choice=tagChoices.get(epc)||{epc,count:0,event,lastAt:event.receivedAt};choice.count++;if(!choice.lastAt||Date.parse(event.receivedAt)>=Date.parse(choice.lastAt)){choice.event=event;choice.lastAt=event.receivedAt;}delete choice.pendingRead;tagChoices.set(epc,choice);}}
 while(tagOptionEvents.size>2000)tagOptionEvents.delete(tagOptionEvents.values().next().value);
 const recent=[...tagChoices.values()].sort((a,b)=>Date.parse(b.lastAt)-Date.parse(a.lastAt));for(const choice of recent.slice(50))if(choice.epc!==selectedEpc)tagChoices.delete(choice.epc);
 updateTagOptions();
}
function updateTagOptions(force=false){
 const select=$('epc');if(!select)return;if(!force&&document.activeElement===select){tagOptionsDirty=true;return;}
 const choices=[...tagChoices.values()].sort((a,b)=>Date.parse(b.lastAt)-Date.parse(a.lastAt)).slice(0,50);select.replaceChildren(new Option('เลือก EPC จากแท็กที่อ่านพบ ('+choices.length+')',''));
 for(const choice of choices){const status=userReadStatus(choice.event?.payload,choice.epc),ascii=epcAscii(choice.epc),name=ascii?ascii+' · '+choice.epc:choice.epc;const option=new Option(name+' · '+(choice.pendingRead?'เขียนแล้ว · รอ reader อ่านซ้ำ':status.label+' · อ่านพบ '+choice.count+' ครั้ง'),choice.epc);select.add(option);}
 select.value=choices.some(choice=>choice.epc===selectedEpc)?selectedEpc:'';tagOptionsDirty=false;
}
function syncTagSelectionButtons(){if($('goWrite'))$('goWrite').disabled=!selectedEpc;for(const button of document.querySelectorAll('.chooseTag[data-epc]')){const selected=button.dataset.epc===selectedEpc;button.classList.toggle('selected',selected);button.closest('.eventitem')?.classList.toggle('isSelected',selected);button.setAttribute('aria-pressed',String(selected));button.textContent=selected?'✓ เลือกอยู่ · แตะเพื่อยกเลิก':'เลือกแท็กนี้เพื่อเขียน';button.setAttribute('aria-label',selected?'ยกเลิกการเลือก EPC '+button.dataset.epc:'เลือก EPC '+button.dataset.epc+' ในฟอร์มเขียน');}}
function selectWrittenEpc(value){const epc=String(value||'').trim().toUpperCase();if(!/^(?:[0-9A-F]{2})+$/.test(epc))return;const current=tagChoices.get(epc);if(!current){tagChoices.set(epc,{epc,count:0,lastAt:new Date().toISOString(),pendingRead:true,event:{id:'write-result-'+Date.now(),receivedAt:new Date().toISOString(),payload:[{type:'INVENTORY',idHex:epc}]}});}selectedEpc=epc;selectionInitialized=true;updateTagOptions(true);const select=$('epc');select.value=epc;updateTagDetails(tagChoices.get(epc));update();syncTagSelectionButtons();}
const epcSelect=$('epc');epcSelect.addEventListener('change',()=>{selectedEpc=epcSelect.value;selectionInitialized=true;const choice=tagChoices.get(selectedEpc);updateTagDetails(choice?{...choice,count:choice.count}:null);update();syncTagSelectionButtons();});
epcSelect.addEventListener('blur',()=>{if(tagOptionsDirty)updateTagOptions(true);});
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;}
function findEpcs(value){
 const found=new Set(),queue=[value];
 while(queue.length){const v=queue.shift();if(!v||typeof v!=='object')continue;
 for(const [k,x] of Object.entries(v)){if(typeof x==='string'&&/^(epc|epcHex|idHex)$/i.test(k)&&/^(?:[0-9a-f]{2})+$/i.test(x)&&!(k==='idHex'&&v.format&&String(v.format).toLowerCase()!=='epc'))found.add(x.toUpperCase());else if(x&&typeof x==='object')queue.push(x);}}
 return [...found];
}
function epcAscii(epc){const hex=String(epc||'').replace(/[^a-f0-9]/gi,'');if(!/^(?:[a-f0-9]{2})+$/i.test(hex))return null;const bytes=hex.match(/../g).map(pair=>parseInt(pair,16));while(bytes[0]===0)bytes.shift();while(bytes.at(-1)===0)bytes.pop();if(!bytes.length||!bytes.every(byte=>byte>=32&&byte<=126))return null;return bytes.map(byte=>String.fromCharCode(byte)).join('');}
function userReadStatus(payload,epc){
 const queue=Array.isArray(payload)?[...payload]:[payload];let raw,found=false;
 while(queue.length){const value=queue.shift();if(!value||typeof value!=='object')continue;
  const data=value.data&&typeof value.data==='object'?value.data:value;
  const id=String(data.idHex||data.epc||data.epcHex||'').toUpperCase();
  if(id===epc){if(Object.hasOwn(data,'USER')){raw=data.USER;found=true;}else if(value.type==='CUSTOM'&&data.MAC==='C4:7D:CC:74:AF:20'&&Array.isArray(data.accessResults)&&data.accessResults.length===4){raw=data.accessResults[3];found=true;}}
  for(const nested of Object.values(value))if(nested&&typeof nested==='object')queue.push(nested);
 }
 if(!found)return {key:'unknown',label:'USER ยังไม่ทราบ'};
 if(typeof raw==='string'&&/^(?:[a-f0-9]{2})+$/i.test(raw.replace(/^0x/i,'')))return {key:'readable',label:'USER อ่านได้'};
 if(typeof raw==='string'&&/memory overrun/i.test(raw))return {key:'error',label:'USER ตอบ Memory overrun'};
 if(typeof raw==='string'&&/not supported|unsupported|invalid memory bank/i.test(raw))return {key:'error',label:'แท็กไม่รองรับ USER'};
 return {key:'error',label:'USER อ่านไม่สำเร็จ'};
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
  if(!events.length){feedList.append(el('p','ไม่พบแท็กในช่วง 5 วินาทีล่าสุด · ข้อมูลย้อนหลังยังคงบันทึกไว้','empty'));if(selectedEpc&&tagChoices.has(selectedEpc))updateTagDetails(tagChoices.get(selectedEpc));else updateTagDetails(null);filterTagList();return;}
 const grouped=new Map(),display=[];
 for(const event of [...events].sort((a,b)=>Number(a.id)-Number(b.id))){
  const epcs=findEpcs(event.payload);
  if(!epcs.length)continue;
  for(const epc of epcs){const item=grouped.get(epc)||{event,epc,count:0};item.event=event;item.count++;grouped.set(epc,item);}
 }
  display.push(...grouped.values());
  display.sort((a,b)=>Date.parse(b.event.receivedAt)-Date.parse(a.event.receivedAt));
  if(!display.length){feedList.append(el('p','ยังไม่มีข้อมูล EPC ในช่วง 5 วินาทีล่าสุด','empty'));if(selectedEpc&&tagChoices.has(selectedEpc))updateTagDetails(tagChoices.get(selectedEpc));else updateTagDetails(null);filterTagList();return;}
  const selected=selectedEpc?(display.find(item=>item.epc===selectedEpc)||tagChoices.get(selectedEpc)):!selectionInitialized?display[0]:null;if(selected){selectedEpc=selected.epc;selectionInitialized=true;updateTagOptions();$('epc').value=selectedEpc;updateTagDetails(selected);}else{selectedEpc='';updateTagOptions();updateTagDetails(null);}
  for(const item of display){
  const event=item.event;
  const itemRow=el('div',undefined,'eventitem'),card=el('details',undefined,'eventcard'),summary=el('summary');
  card.dataset.epc=item.epc||'';card.dataset.eventId=String(event.id);
  if(openCards.has(card.dataset.epc||card.dataset.eventId))card.open=true;
  const ascii=epcAscii(item.epc),primary=item.epc?(ascii||item.epc)+' · อ่านพบ '+item.count+' ครั้ง':'Event / สถานะเครื่อง';
  summary.append(el('strong',primary),el('span',new Date(event.receivedAt).toLocaleString('th-TH')+' · #'+event.id));
  card.append(summary);summary.addEventListener('click',()=>{selectedEpc=item.epc;selectionInitialized=true;updateTagOptions(true);$('epc').value=item.epc;updateTagDetails(item);update();syncTagSelectionButtons();});
  if(item.epc)card.append(memorySummary(event.payload,item.epc,item.count,event.receivedAt));
  const table=el('table'),tbody=el('tbody');
  for(const [key,value] of fields(event.payload)){const tr=el('tr');tr.append(el('th',key),el('td',value));tbody.append(tr);}table.append(tbody);
  const raw=el('details',undefined,'technical'),rawLabel=el('summary','ข้อมูลดิบสำหรับตรวจสอบ · ทุกฟิลด์และ JSON');raw.dataset.rawKey=item.epc?'raw-'+item.epc:'raw-event-'+event.id;raw.append(rawLabel,table,el('pre',JSON.stringify(event.payload,null,2)));card.append(raw);for(const detail of card.querySelectorAll('details[data-raw-key]'))detail.open=openRaw.has(detail.dataset.rawKey);itemRow.append(card);
  if(item.epc){const action=el('div',undefined,'tagAction'),state=userReadStatus(event.payload,item.epc),badge=el('span',state.label,'tagCapability '+state.key),button=el('button');button.type='button';button.hidden=true;button.className='chooseTag';itemRow.dataset.group=state.key==='error'&&/Memory overrun/.test(state.label)?'overrun':state.key;button.dataset.epc=item.epc;button.onclick=event=>{event.stopPropagation();if(selectedEpc===item.epc){selectedEpc='';selectionInitialized=true;updateTagOptions(true);$('epc').value='';updateTagDetails(null);update();syncTagSelectionButtons();return;}selectedEpc=item.epc;selectionInitialized=true;updateTagOptions(true);$('epc').value=item.epc;updateTagDetails(tagChoices.get(item.epc)||item);update();syncTagSelectionButtons();$('writer').scrollIntoView({behavior:'smooth',block:'start'});$('epc').focus({preventScroll:true});};action.append(badge,button);itemRow.append(action);}
  feedList.append(itemRow);
 }
 syncTagSelectionButtons();filterTagList();
}
function readSummary(events){const epcs=new Set();let reads=0;for(const event of events){const values=findEpcs(event.payload);reads+=values.length;for(const epc of values)epcs.add(epc);}return epcs.size+' แท็กไม่ซ้ำ · '+reads+' ครั้งที่อ่าน';}
async function loadEvents(before=null,manual=false){
 if(feedLoading)return;feedLoading=true;
 try{
  const response=await fetch('/api/events'+(before?'?before='+before:''),{cache:'no-store',signal:AbortSignal.timeout(12000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'โหลดข้อมูลไม่ได้');
  olderCursor=data.nextBefore;onOlderPage=!!before;rememberTags(data.events);
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
  if(data.events.length){rememberTags(data.events);for(const item of data.events)latestId=Math.max(latestId,Number(item.id));
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
 if(!item){selectedEpc='';if($('epc'))$('epc').value='';if($('userCapability'))$('userCapability').textContent='สถานะ USER จะแสดงเมื่อ reader ส่งผลอ่านของแท็ก';panel.replaceChildren(el('p','ยังไม่พบแท็กในช่วง 5 วินาทีล่าสุด · รายละเอียดจะแสดงเมื่อ reader อ่านพบแท็ก','empty'));return;}
 if($('epc')&&[...$('epc').options].some(option=>option.value===item.epc))$('epc').value=item.epc;
 const userState=userReadStatus(item.event?.payload,item.epc);if($('userCapability'))$('userCapability').textContent=userState.label+' · เป็นผลการอ่านเท่านั้น ยังยืนยันการเขียนไม่ได้';
 panel.replaceChildren(memorySummary(item.event.payload,item.epc,item.count,item.event.receivedAt));
}
function memorySummary(payload,epc,count=1,receivedAt=''){
 const root=el('div',undefined,'capacity');const openBanks=new Set([...$('tagDetails')?.querySelectorAll('details[data-bank][open]')||[]].map(node=>node.dataset.bank));const queue=Array.isArray(payload)?[...payload].reverse():[payload];let record=null;
 while(queue.length){const value=queue.shift();if(!value||typeof value!=='object')continue;
  if(value.type==='CUSTOM'&&value.data?.idHex?.toUpperCase()===epc){record={...value.data,readTimestamp:value.timestamp,readType:value.type};break;}
  if(Object.entries(value).some(([key,x])=>/^(epc|epcHex|idHex)$/i.test(key)&&typeof x==='string'&&x.toUpperCase()===epc)){record=value;break;}
  for(const nested of Object.values(value))if(nested&&typeof nested==='object')queue.push(nested);
 }
 const data=record?{...record,...(record.data&&typeof record.data==='object'&&!Array.isArray(record.data)?record.data:{})}:{};
 // This reader was configured and verified with READ operations in this order.
 // Never infer bank names for arbitrary CUSTOM accessResults or historical profiles.
 const directReads=data.readType==='CUSTOM'&&data.MAC==='C4:7D:CC:74:AF:20'&&Date.parse(data.readTimestamp)>=Date.parse('2026-10-01T05:41:00Z')&&Array.isArray(data.accessResults)&&data.accessResults.length===4;
 if(directReads)['EPC','TID','RESERVED','USER'].forEach((bank,index)=>{data[bank]=data.accessResults[index];});
 const lookup=(...names)=>{const wanted=names.map(name=>name.toLowerCase());const pair=Object.entries(data).find(([key,value])=>wanted.includes(key.toLowerCase())&&value!==undefined&&value!==null);return pair?.[1];};
 const asHex=value=>{
  if(typeof value==='string'){const hex=value.replace(/^0x/i,'').replace(/[\s:-]/g,'');return /^(?:[a-f0-9]{2})+$/i.test(hex)?hex.toUpperCase():null;}
  if(Array.isArray(value)&&value.length&&value.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))return value.map(byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
  if(value&&typeof value==='object')for(const key of ['hex','dataHex','valueHex','value','data']){const hex=asHex(value[key]);if(hex)return hex;}
  return null;
 };
 root.append(el('h3','EPC · '+epc,'tagEpc'),el('small','อ่านพบ '+count+' ครั้ง'+(receivedAt?' · '+new Date(receivedAt).toLocaleString('th-TH'):''),'tagReadTime'));
 const epcText=(asHex(epc)?.match(/../g)||[]).map(pair=>parseInt(pair,16));while(epcText[0]===0)epcText.shift();while(epcText[epcText.length-1]===0)epcText.pop();
 if(epcText.length&&epcText.every(byte=>byte>=32&&byte<=126)){const hero=el('section',undefined,'tagText');hero.append(el('small','ข้อความจาก EPC · ASCII'),el('strong',epcText.map(byte=>String.fromCharCode(byte)).join('')),el('small','ซ่อนเฉพาะ NUL ต้นและท้ายในข้อความสรุป · ค่าดิบอยู่ด้านล่าง'));root.append(hero);}
 root.append(el('h4','หน่วยความจำที่อ่านได้','groupTitle'));
 if(directReads)root.append(el('small','ผลคำสั่ง READ จาก FX9600 · EPC bank รวม CRC และ PC · การอ่านได้ยังไม่ยืนยันสิทธิ์เขียนหรือสถานะล็อก'));
 const banks=el('div',undefined,'memoryCards');
 for(const bank of ['EPC','TID','USER','RESERVED']){
  const raw=lookup(bank),hex=bank==='EPC'?(asHex(raw)||asHex(epc)):asHex(raw),cell=el('section',undefined,'memoryCard');cell.dataset.memory=bank;
  const header=el('div',undefined,'memoryHead');header.append(el('h5',bank),el('span',hex?'อ่านสำเร็จ':raw===undefined?'ไม่มีข้อมูล':'อ่านไม่สำเร็จ',hex?'bankStatus ok':'bankStatus'));cell.append(header);
 if(hex){const words=hex.length/4;cell.append(el('strong',(hex.length*4)+' bits · '+(hex.length/2)+' bytes · '+words+' '+(words===1?'word':'words')));const details=el('details',undefined,'bankraw');details.dataset.bank=bank;details.dataset.rawKey=epc+'-'+bank;if(openBanks.has(bank))details.open=true;details.append(el('summary','ดูค่า HEX ต้นฉบับ'));const value=el('code',hex);details.append(value);cell.append(details);}
  else if(typeof raw==='string'&&/memory overrun/i.test(raw)){cell.classList.add('memoryWarning');cell.append(el('p','อ่านเกินขอบเขตหน่วยความจำ (0x03)'),el('small','ตรวจ Offset และจำนวน words ที่สั่งอ่าน แล้วลองลดช่วงอ่าน · ข้อผิดพลาดนี้ยังยืนยันความจุ USER ไม่ได้'));}
  else cell.append(el('p',raw===undefined?'ไม่พบข้อมูลจาก reader':String(raw)));
  if(hex){const bytes=hex.match(/../g)||[];const ascii=bytes.map(pair=>{const byte=parseInt(pair,16);return byte>=0x20&&byte<=0x7e?String.fromCharCode(byte):'·';}).join('');const converted=el('div',undefined,'asciiValue');converted.append(el('small','ASCII (7-bit)'),el('code',ascii));cell.append(converted);}
  banks.append(cell);
 }
 root.append(banks,el('small','ขนาดข้อมูลที่ได้รับ ไม่ใช่ความจุสูงสุดของชิป · 1 word = 16 bits = 2 bytes · ASCII แทน byte ที่พิมพ์ไม่ได้ด้วย ·'));
 const meta=el('dl',undefined,'tagMetadata');
 const technical=el('details',undefined,'technical');technical.dataset.rawKey=epc+'-technical';technical.append(el('summary','ข้อมูลทางเทคนิค · PC / CRC / Event'));const extra=el('dl',undefined,'tagMetadata');
 const values=[['PC',lookup('PC')],['CRC',lookup('CRC')],['เสาอากาศ',lookup('antenna')],['RSSI สูงสุด',lookup('peakRssi')],['ช่องความถี่',lookup('channel')],['รูปแบบ',lookup('format')],['เครื่องอ่าน',lookup('hostName')],['MAC',lookup('MAC')],['Phase',lookup('phase')],['Event',lookup('eventNum')]];
 for(const [label,value] of values)if(value!==undefined){let shown=String(value);if(label==='PC'||label==='CRC'){const hex=asHex(value);if(hex)shown='0x'+hex+' · '+(hex.length*4)+' bits · '+(hex.length/4)+' words';}else if(label==='RSSI สูงสุด')shown+=' dBm';else if(label==='ช่องความถี่')shown+=' MHz';const item=el('div',undefined,'tagMetric');item.append(el('dt',label),el('dd',shown));meta.append(item);}
 for(const item of [...meta.children])if(['PC','CRC','รูปแบบ','Phase','Event'].includes(item.querySelector('dt').textContent))extra.append(item);
 if(meta.childElementCount)root.append(el('h4','สัญญาณและเครื่องอ่าน','groupTitle'),meta);
 if(extra.childElementCount){technical.append(extra);root.append(technical);}
 return root;
}
$('memoryBank').addEventListener('change',()=>{
 const bank=$('memoryBank').value;$('offset').value=bank==='EPC'?'4':'0';
 $('bankNote').textContent=bank==='TID'?'TID มักล็อกถาวรจากโรงงาน เขียนได้เฉพาะชิปที่รองรับ':bank==='RESERVED'?'Reserved เก็บ Kill/Access password ต้องตรวจค่าก่อนเขียน':bank==='EPC'?'เริ่มที่ byte 4 เพื่อไม่ทับ CRC/PC · ใส่ข้อมูลครบตามช่วงที่ต้องการเขียน':'เขียน USER Memory';update();
});
$('memoryBank').dispatchEvent(new Event('change'));

async function writerStatus(){try{const response=await fetch('/api/write/config');const data=await response.json();endpoint=data.available?'/api/write':'';$('below').textContent=data.available?'เขียนจริง · อ่านกลับยืนยันทุกครั้ง · notebook bridge เชื่อมต่อแล้ว':'กำลังรอ notebook bridge · เปิด notebook และโปรแกรม bridge';$('write').innerHTML=data.available?'<span>✎</span> เขียนข้อมูลแท็ก':'<span>✎</span> รอการเชื่อมต่อ';update();}catch{endpoint='';$('below').textContent='ตรวจสอบการเชื่อมต่อ notebook bridge ไม่ได้';$('write').innerHTML='<span>✎</span> รอการเชื่อมต่อ';update();}}writerStatus();setInterval(writerStatus,10000);




function filterTagList(){const query=($('tagSearch')?.value||'').trim().toLowerCase(),group=document.querySelector('[name=tagGroup]:checked')?.value||'all';let matches=0;const rows=[...feedList.querySelectorAll('.eventitem')],counts={all:rows.length,readable:0,overrun:0,error:0,unknown:0};for(const row of rows){const epc=row.querySelector('.chooseTag')?.dataset.epc||'';counts[row.dataset.group]++;row.hidden=(group!=='all'&&row.dataset.group!==group)||(!!query&&!((epcAscii(epc)||'')+' '+epc).toLowerCase().includes(query));if(!row.hidden)matches++;}document.querySelectorAll('[data-filter-count]').forEach(node=>{node.textContent=counts[node.dataset.filterCount]||0;});if($('filterEmpty'))$('filterEmpty').hidden=matches>0||rows.length===0;const status=$('searchStatus');if(status){status.hidden=!query&&group==='all';status.textContent=matches?'พบ '+matches+' แท็ก':'ไม่พบแท็กที่ตรงกับตัวกรอง';}const opener=$('openTagFilter');if(opener)opener.textContent=query||group!=='all'?'กรอง · '+matches:'กรอง';if($('applyTagFilter'))$('applyTagFilter').textContent='แสดง '+matches+' แท็ก';}
const filterDialog=$('tagFilterDialog');$('openTagFilter').onclick=()=>{filterTagList();if(filterDialog.showModal)filterDialog.showModal();else filterDialog.setAttribute('open','');$('tagSearch').focus();};function closeTagFilter(){if(filterDialog.close)filterDialog.close();else filterDialog.removeAttribute('open');$('openTagFilter').focus();}$('closeTagFilter').onclick=closeTagFilter;$('applyTagFilter').onclick=closeTagFilter;filterDialog.addEventListener('cancel',()=>{$('openTagFilter').focus();});filterDialog.addEventListener('click',event=>{if(event.target===filterDialog){const rect=filterDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeTagFilter();}});$('tagSearch').addEventListener('input',filterTagList);document.querySelectorAll('[name=tagGroup]').forEach(input=>input.addEventListener('change',filterTagList));$('resetTagFilter').onclick=()=>{$('tagSearch').value='';document.querySelector('[name=tagGroup][value=all]').checked=true;filterTagList();};
const editorPanel=document.querySelector('.editor');function updateEditorSticky(){if(editorPanel)editorPanel.style.setProperty('--editor-top',Math.min(16,window.innerHeight-editorPanel.getBoundingClientRect().height-16)+'px');}if(typeof ResizeObserver!=='undefined'&&editorPanel)new ResizeObserver(updateEditorSticky).observe(editorPanel);window.addEventListener('resize',updateEditorSticky);updateEditorSticky();
