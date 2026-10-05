const $=id=>document.getElementById(id);let endpoint='',busy=false;const tagChoices=new Map();const format=()=>document.querySelector('[name=format]:checked').value;

function decodeBytes(raw,encoding){if(encoding==='ASCII'){if(/[^\x00-\x7f]/.test(raw))throw Error('ASCII supports characters 0–127 only. Use HEX for other bytes');return Array.from(raw,c=>c.charCodeAt(0));}const hex=raw.replace(/\s/g,'');if(!/^[0-9a-f]*$/i.test(hex)||hex.length%2)throw Error('HEX must contain complete byte pairs using 0–9 and A–F, e.g. 48 45 4C 4C 4F');return (hex.match(/../g)||[]).map(x=>parseInt(x,16));}

function bytes(){return decodeBytes($('data').value,format());}

let previousFormat=format();

function changeFormat(){const next=format();if(next===previousFormat)return;try{let value=decodeBytes($('data').value,previousFormat);const fullEpc=$('memoryBank').value==='EPC'&&Number($('offset').value)===4,epc=$('epc').value.trim();if(fullEpc&&previousFormat==='ASCII'&&next==='HEX'){document.querySelector('[name=format][value="'+previousFormat+'"]').checked=true;try{value=preparedBytes();}finally{document.querySelector('[name=format][value="'+next+'"]').checked=true;}}else if(fullEpc&&next==='ASCII'&&/^(?:[0-9A-F]{2})+$/i.test(epc)&&value.length===epc.length/2){let first=0;while(first<value.length&&value[first]===0)first++;if(first===value.length)throw Error('HEX contains no printable EPC text. Keep HEX mode.');value=value.slice(first);}if(next==='ASCII'&&value.some(byte=>byte<32||byte>126))throw Error('HEX contains non-printable bytes. Keep HEX mode.');$('data').value=next==='HEX'?value.map(byte=>byte.toString(16).padStart(2,'0').toUpperCase()).join(''):String.fromCharCode(...value);previousFormat=next;$('error').textContent='';update();}catch(error){document.querySelector('[name=format][value="'+previousFormat+'"]').checked=true;update();$('error').textContent=error.message;}}

function tagDataHex(value){if(typeof value==='string'){const hex=value.replace(/^0x/i,'').replace(/[\s:-]/g,'');return /^(?:[0-9a-f]{2})+$/i.test(hex)?hex:null;}if(Array.isArray(value)&&value.length&&value.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))return value.map(byte=>byte.toString(16).padStart(2,'0')).join('');if(value&&typeof value==='object')for(const key of ['hex','dataHex','valueHex','value','data']){const hex=tagDataHex(value[key]);if(hex)return hex;}return null;}

function preparedBytes(){const value=bytes(),bank=$('memoryBank').value,epc=$('epc').value.trim();if(bank==='EPC'&&format()==='ASCII'&&value.length){if(!/^(?:[0-9A-F]{2})+$/i.test(epc))throw Error('Select a detected tag to determine its EPC length');if(Number($('offset').value)!==4)throw Error('Full ASCII EPC replacement must start at byte 4 to preserve CRC and PC');const epcLength=epc.length/2;if(value.length>epcLength)throw Error('Text exceeds the current EPC length ('+epcLength+' bytes)');return [...Array(epcLength-value.length).fill(0),...value];}return value;}

function observedBankCapacity(bank,epc){if(bank==='EPC')return /^[0-9a-f]+$/i.test(epc)&&epc.length%2===0?epc.length/2+4:null;const item=tagChoices.get(epc);if(!item?.event)return null;const queue=[item.event.payload],seen=new Set();let candidate=null;while(queue.length){const value=queue.shift();if(!value||typeof value!=='object'||seen.has(value))continue;seen.add(value);if(Array.isArray(value)){queue.push(...value);continue;}const nestedData=value.data&&typeof value.data==='object'?value.data:{};const recordEpc=value.idHex??value.epcHex??value.epc??value.EPC??nestedData.idHex??nestedData.epcHex??nestedData.epc;if(typeof recordEpc==='string'&&recordEpc.replace(/[^0-9a-f]/gi,'').toUpperCase()===epc.toUpperCase()){candidate={...value,...nestedData};if(value.type==='CUSTOM'&&nestedData.MAC==='C4:7D:CC:74:AF:20'&&Array.isArray(nestedData.accessResults)&&nestedData.accessResults.length===4){for(const [index,name] of ['EPC','TID','RESERVED','USER'].entries())candidate[name]=nestedData.accessResults[index];}break;}for(const nested of Object.values(value))if(nested&&typeof nested==='object')queue.push(nested);}const hex=tagDataHex(candidate?.[bank]??candidate?.[bank.toLowerCase()]);if(!hex)return null;if(bank==='EPC')return Math.max(0,hex.length/2-4);return hex.length/2;}

function update(){let ready=false;try{const raw=bytes(),bank=$('memoryBank').value,epc=$('epc').value.trim(),offset=Number($('offset').value),isEpcAscii=bank==='EPC'&&format()==='ASCII'&&raw.length>0;let output=raw,note='';if(isEpcAscii){output=preparedBytes();const prefix=output.length-raw.length,hex=output.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();note='Replace the entire EPC · '+(prefix?'Leading 00 padding: '+prefix+' bytes to preserve the current length · ':'')+'HEX to write: '+hex;}else{note=raw.length%2?'Odd byte count: the adjacent byte will be preserved without adding 00':raw.length?'Even byte count':'Enter data before writing';}$('length').value=String(output.length);const capacity=observedBankCapacity(bank,epc),maxBytes=capacity===null?null:Math.max(0,capacity-offset),dataInput=$('data');if(maxBytes===null){dataInput.removeAttribute('maxlength');note+=(note?' · ':'')+'Unknown capacity for '+bank+' on this tag. Select a tag with a successful read of this bank first.';}else{dataInput.maxLength=format()==='ASCII'?maxBytes:Math.max(0,maxBytes*3-1);note+=(note?' · ':'')+'Maximum input: '+maxBytes+' bytes at offset '+offset+' · Observed: '+capacity+' bytes';if(output.length>maxBytes)throw Error('Data exceeds the readable capacity of '+bank+' · maximum '+maxBytes+' bytes at offset '+offset);}$('count').textContent=output.length+' / '+(maxBytes===null?'?':maxBytes)+' bytes';if(output.length<1)throw Error('Enter at least 1 byte');if(capacity===null)throw Error('Unknown size for '+bank+' on this tag. Select a tag with a successful bank read before writing.');$('paddingNote').textContent=note;$('paddingNote').classList.toggle('warning',capacity===null||output.length>maxBytes);payload();$('error').textContent='';ready=output.length>=1&&output.length<=maxBytes;}catch(e){const visibleBytes=(()=>{try{return bytes().length;}catch{return null;}})();$('length').value=(()=>{try{return String(preparedBytes().length);}catch{return visibleBytes===null?'—':String(visibleBytes);}})();$('count').textContent=visibleBytes===null?'Invalid data':visibleBytes+' / '+(observedBankCapacity($('memoryBank').value,$('epc').value.trim())??'?')+' bytes';$('paddingNote').textContent='';$('paddingNote').classList.remove('warning');$('error').textContent=e.message;}$('data').placeholder=format()==='HEX'?'Enter HEX byte pairs, e.g. 48 45 4C 4C 4F':'Enter the text to write';$('data').setAttribute('autocapitalize',format()==='HEX'?'characters':'off');$('hint').textContent=format()==='ASCII'?'ASCII supports English letters, numbers, and symbols':'Enter HEX byte pairs; spaces are allowed';$('write').disabled=busy||!endpoint||!ready;}

function payload(){const epc=$('epc').value.trim().toUpperCase();if(!/^(?:[0-9A-F]{2})+$/.test(epc))throw Error('Enter an EPC with complete HEX byte pairs');const bank=$('memoryBank').value;if(!['USER','EPC','TID','RESERVED'].includes(bank))throw Error('Select a memory bank');const password=$('accessPassword').value.trim();if(password&&!/^[0-9A-Fa-f]{8}$/.test(password))throw Error('Access password must contain exactly 8 HEX digits');if(['TID','RESERVED'].includes(bank)&&!$('confirmSensitive').checked)throw Error('Confirm changes to this sensitive memory bank');const offset=Number($('offset').value);if($('offset').value===''||!Number.isSafeInteger(offset)||offset<0||offset%2)throw Error('Offset must be an even integer greater than or equal to 0');const b=preparedBytes(),capacity=observedBankCapacity(bank,epc);if(capacity===null)throw Error('Unknown size for '+bank+' on this tag. Select a tag with a successful bank read before writing.');if(b.length<1)throw Error('Enter at least 1 byte');if(offset+b.length>capacity)throw Error('Data exceeds the readable capacity of '+bank+' · maximum '+Math.max(0,capacity-offset)+' bytes at offset '+offset);return {requestId:crypto.randomUUID(),operation:'write',memoryBank:$('memoryBank').value,epc,offsetBytes:offset,lengthBytes:b.length,accessPassword:$('accessPassword').value.trim(),confirmSensitive:$('confirmSensitive').checked,encoding:format(),dataHex:b.map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase()};}

function result(kind,title,message){const r=$('result');r.closest('.panel.result').hidden=false;r.className=kind;r.replaceChildren();const icon=document.createElement('div');icon.className='resulticon';icon.textContent=kind==='success'?'✓':kind==='failure'?'!':'…';const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=message;const detail=el('details',undefined,'resultMore');detail.append(el('summary','Write result details'),p);r.append(icon,h,detail);}

let toastTimer;function showToast(kind,message){const toast=$('toast');if(!toast)return;clearTimeout(toastTimer);toast.className='toast'+(kind?' '+kind:'');toast.textContent=message;toast.hidden=false;toast.setAttribute('role',kind==='failure'?'alert':'status');toast.setAttribute('aria-live',kind==='failure'?'assertive':'polite');toastTimer=setTimeout(()=>{toast.hidden=true;},5500);}

const saveEndpoint=$('save');if(saveEndpoint)saveEndpoint.onclick=()=>{try{const u=new URL($('endpoint').value.trim());if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error();endpoint=u.href;$('configstatus').textContent='URL saved. Connection has not been tested.';document.querySelector('.connection').textContent='Webhook configured';$('below').textContent='Check the EPC and data before writing';update();}catch{$('configstatus').textContent='Enter a valid HTTPS URL without embedded credentials';}};

function actionableWriteMessage(message){const detail=String(message||'Reader or bridge did not return confirmation');if(/0x0b|insufficient power/i.test(detail))return 'Tag error 0x0B: insufficient RF power for writing. Move the tag closer to the antenna and adjust its orientation. Check antenna cables and MC3390R TX Power within local and antenna limits. Read the tag before retrying.';if(/hardware result not confirmed|timed out waiting for hardware result/i.test(detail))return 'MC3390R confirmation timed out. Read the tag and compare its data before retrying to avoid duplicate writes.';return detail;}

function writeFailureMessage(data,body){const detail=actionableWriteMessage(data?.message);return `${body.memoryBank} · ${body.lengthBytes} bytes · ${detail}`;}

$('writer').onsubmit=async e=>{e.preventDefault();if(busy||$('write').disabled)return;let operationStarted=null,readerDurationMs=null;try{if(!endpoint)throw Error('Tag writing is disabled');const body=payload();operationStarted=performance.now();busy=true;update();$('write').textContent='Sending command…';result('','Waiting for write confirmation','Do not submit again while waiting');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(320000),credentials:'omit',redirect:'error'});if(!response.ok)throw Error((await response.json()).error||('HTTP '+response.status));let data=await response.json();const waitStarted=Date.now();while(data.status==="queued"||data.status==="running"){if(Date.now()-waitStarted>300000){data.status="unknown";break;}await new Promise(resolve=>setTimeout(resolve,600));const reply=await fetch("/api/write/result?requestId="+encodeURIComponent(body.requestId),{signal:AbortSignal.timeout(8000)});if(!reply.ok)throw Error("Unable to retrieve the write result");data=await reply.json();}if(data.requestId!==body.requestId||data.epc?.toUpperCase()!==body.epc)throw Error('Response does not match the request or target EPC');readerDurationMs=Number.isFinite(data.durationMs)&&data.durationMs>=0?Math.round(data.durationMs):null;if(data.status==='success'&&data.verified===true){const message=`${body.memoryBank} · ${body.lengthBytes} bytes · Read-back verified · ${data.newEpc||body.epc}${data.resumeWarning?" · "+data.resumeWarning:""}`;result('success','Write successful',message);showToast('success','Write successful · '+message);if(body.memoryBank==='EPC'&&data.newEpc)selectWrittenEpc(data.newEpc);}else if(data.status==='failed'){const message=actionableWriteMessage(data.message||'The reader reported a write failure');result('failure','Write failed',message);showToast('failure','Write failed · '+message);}else{const message=writeFailureMessage(data,body);result('','Write could not be confirmed',message);showToast('warning','Write could not be confirmed · '+message);}}catch(e){$('error').textContent=e.message;if(busy){result('failure','Result could not be confirmed','Check the reader and tag before retrying: '+e.message);showToast('failure','Result could not be confirmed · '+e.message);}}finally{if(operationStarted!==null){const timing=el('div',undefined,'writeTiming');if(readerDurationMs!==null)timing.append(el('strong','Reader operation: '+readerDurationMs+' ms'));timing.append(el('span','Total elapsed: '+Math.max(0,Math.round(performance.now()-operationStarted))+' ms'));$('result').append(timing);const details=$('result').querySelector('.resultMore');details?.append(el('small','Reader operation includes preparation, writing, read-back verification and restoring the read mode. Total elapsed also includes queueing and result polling.'));}busy=false;$('write').innerHTML=endpoint?'<span>✎</span> Write tag':'<span>✎</span> Waiting for connection';update();}};

const dataField=$('data');let composingData=false;dataField.addEventListener('compositionstart',()=>{composingData=true;});dataField.addEventListener('compositionend',()=>{composingData=false;restrictHexInput();});function restrictHexInput(){if(composingData)return;if(format()==='HEX'){const raw=dataField.value,start=dataField.selectionStart,end=dataField.selectionEnd,clean=value=>value.replace(/[^0-9a-f\s]/gi,'').toUpperCase();dataField.value=clean(raw);dataField.setSelectionRange(clean(raw.slice(0,start)).length,clean(raw.slice(0,end)).length);}update();}dataField.addEventListener('beforeinput',event=>{if(format()==='HEX'&&!event.isComposing&&event.data&&/[^0-9a-f\s]/i.test(event.data))event.preventDefault();});dataField.addEventListener('input',restrictHexInput);$('offset').addEventListener('input',update);$('accessPassword').addEventListener('input',update);$('confirmSensitive').addEventListener('change',update);document.querySelectorAll('[name=format]').forEach(el=>el.addEventListener('change',changeFormat));update();

if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'preview_user_tag_write',description:'Validate current visible USER tag form and return the proposed payload without sending or writing a tag.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{try{return {valid:true,payload:payload()};}catch(e){return {valid:false,error:e.message};}}})).catch(()=>{});}catch{}}

const feedList=document.getElementById('eventList');

const LIVE_TAG_TTL_MS=5000;

let olderCursor=null,onOlderPage=false,feedLoading=false,liveBusy=false,feedSignature='',latestId=0,visibleEvents=[],pendingEvents=0,selectedEpc='',selectionInitialized=false;

let tagOptionEvents=new Set(),tagOptionsDirty=false;

function rememberTags(events){

 for(const event of events){const eventKey=String(event.id??event.receivedAt);if(tagOptionEvents.has(eventKey))continue;tagOptionEvents.add(eventKey);const epcs=findEpcs(event.payload);for(const epc of epcs){const choice=tagChoices.get(epc)||{epc,count:0,event,lastAt:event.receivedAt};choice.count=eventReadCount(event,epc,choice.count);if(!choice.lastAt||Date.parse(event.receivedAt)>=Date.parse(choice.lastAt)){choice.event=event;choice.lastAt=event.receivedAt;}delete choice.pendingRead;tagChoices.set(epc,choice);}}

 while(tagOptionEvents.size>2000)tagOptionEvents.delete(tagOptionEvents.values().next().value);

 updateTagOptions();

}

function updateTagOptions(force=false){

 const select=$('epc');if(!select)return;if(!force&&document.activeElement===select){tagOptionsDirty=true;return;}

 const choices=[...tagChoices.values()].sort((a,b)=>b.count-a.count||Date.parse(b.lastAt)-Date.parse(a.lastAt));select.replaceChildren(new Option('Select a detected EPC ('+choices.length+')',''));

 for(const choice of choices){const status=userReadStatus(choice.event?.payload,choice.epc),ascii=epcAscii(choice.epc),name=ascii?ascii+' · '+choice.epc:choice.epc;const option=new Option(name+' · '+(choice.pendingRead?'Written. Waiting for the next reader scan':status.label+' · Reads: '+choice.count+' times'),choice.epc);select.add(option);}

 select.value=choices.some(choice=>choice.epc===selectedEpc)?selectedEpc:'';tagOptionsDirty=false;

}

function syncTagSelectionButtons(){if($('goWrite'))$('goWrite').disabled=!selectedEpc;for(const button of document.querySelectorAll('.chooseTag[data-epc]')){const selected=button.dataset.epc===selectedEpc;button.classList.toggle('selected',selected);button.closest('.eventitem')?.classList.toggle('isSelected',selected);const summary=button.closest('.eventitem')?.querySelector('.eventcard>summary');summary?.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-pressed',String(selected));button.textContent=selected?'✓ Selected. Click to deselect':'Select this tag';button.setAttribute('aria-label',selected?'Deselect EPC '+button.dataset.epc:'Select EPC '+button.dataset.epc+' in the write form');}}

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

 if(!found)return {key:'unknown',label:'USER Unknown'};

 if(typeof raw==='string'&&/^(?:[a-f0-9]{2})+$/i.test(raw.replace(/^0x/i,'')))return {key:'readable',label:'USER readable'};

 if(typeof raw==='string'&&/memory overrun/i.test(raw))return {key:'error',label:'USER returned Memory overrun'};

 if(typeof raw==='string'&&/not supported|unsupported|invalid memory bank/i.test(raw))return {key:'error',label:'Tag does not support USER'};

 return {key:'error',label:'USER Read failed'};

}

function fields(value,prefix='',out=[]){

 if(value!==null&&typeof value==='object'&&Object.keys(value).length){for(const [k,v] of Object.entries(value))fields(v,prefix?prefix+'.'+k:k,out);}

 else out.push([prefix||'value',value!==null&&typeof value==='object'?JSON.stringify(value):String(value)]);

 return out;

}

function isRecent(event){return !!event;}

function eventReadCount(event,epc,fallback=0){const records=event.payload.filter(record=>record.data?.idHex===epc);const total=records.reduce((max,r)=>Math.max(max,Number(r.data.totalReads)||0),0);return total||fallback+(records.some(r=>r.type!=='MEMORY_READ')?1:0);}

function renderEvents(events){

 const grouped=new Map([...tagChoices.values()].map(tag=>[tag.epc,{epc:tag.epc,count:tag.count,event:tag.event}]));

 for(const event of [...events].sort((a,b)=>Number(a.id)-Number(b.id)))for(const epc of findEpcs(event.payload)){const item=grouped.get(epc)||{epc,count:0};item.event=event;item.count=eventReadCount(event,epc,item.count);grouped.set(epc,item);}

 const display=[...grouped.values()].sort((a,b)=>b.count-a.count||Date.parse(b.event.receivedAt)-Date.parse(a.event.receivedAt)||a.epc.localeCompare(b.epc));

 if(!display.length){feedList.replaceChildren(el('p','No tags scanned yet.','empty'));updateTagDetails(selectedEpc&&tagChoices.has(selectedEpc)?tagChoices.get(selectedEpc):null);filterTagList();return;}

 const selected=selectedEpc?(grouped.get(selectedEpc)||tagChoices.get(selectedEpc)):!selectionInitialized?display[0]:null;

 if(selected){selectedEpc=selected.epc;selectionInitialized=true;updateTagOptions();$('epc').value=selectedEpc;updateTagDetails(selected);}else{selectedEpc='';updateTagOptions();updateTagDetails(null);}

 const existing=new Map([...feedList.querySelectorAll('.eventitem')].map(row=>[row._item.epc,row]));

 for(const node of [...feedList.children])if(!node.classList.contains('eventitem'))node.remove();

 for(const next of display){

  let row=existing.get(next.epc),item;

  if(row){item=row._item;Object.assign(item,next);existing.delete(next.epc);}

  else{

   item=next;row=el('div',undefined,'eventitem');row._item=item;

   const card=el('details',undefined,'eventcard'),summary=el('summary');card.dataset.epc=item.epc;card.id='tag-details-'+item.epc;summary.append(el('strong'),el('span'));card.append(summary);row.append(card);

   summary.addEventListener('click',event=>{event.preventDefault();selectedEpc=item.epc;selectionInitialized=true;updateTagOptions(true);$('epc').value=selectedEpc;openWriteDialog(item.epc);$('epc').dispatchEvent(new Event('change'));});

   const action=el('div',undefined,'tagAction'),button=el('button');button.type='button';button.hidden=true;button.className='chooseTag';button.dataset.epc=item.epc;button.onclick=()=>summary.click();

   action.append(button);action.hidden=true;row.append(action);feedList.append(row);

  }

  feedList.append(row);

  const summary=row.querySelector('summary'),label=(epcAscii(item.epc)||item.epc)+' · Reads: '+item.count+' times';

  if(summary.firstChild.textContent!==label)summary.firstChild.textContent=label;

  summary.lastChild.textContent=new Date(item.event.receivedAt).toLocaleString('en-GB');

  const state=userReadStatus(item.event.payload,item.epc);row.dataset.group=state.key==='error'&&/Memory overrun/.test(state.label)?'overrun':state.key;

 }

 for(const row of existing.values())row.remove();

 syncTagSelectionButtons();filterTagList();

}

function readSummary(events){const epcs=new Set();for(const event of events)for(const epc of findEpcs(event.payload))epcs.add(epc);return epcs.size+' unique tags · '+NativeRfid.scanStats.totalReads+' total reads';}

async function loadEvents(before=null,manual=false){

 if(feedLoading)return;feedLoading=true;

 try{

  const response=await fetch('/api/events'+(before?'?before='+before:''),{cache:'no-store',signal:AbortSignal.timeout(12000)});

  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Unable to load data');

  olderCursor=data.nextBefore;onOlderPage=!!before;rememberTags(data.events);

  visibleEvents=onOlderPage?data.events:data.events.filter(isRecent);for(const item of data.events)latestId=Math.max(latestId,Number(item.id));pendingEvents=0;

  const signature=visibleEvents.map(e=>e.id).join(',');

  renderEvents(visibleEvents);feedSignature=signature;

  $('olderEvents').hidden=!olderCursor;

  $('feedStatus').textContent=(onOlderPage?'Previous records':'LIVE · Cleared after 5 seconds without a tag read')+' · '+readSummary(visibleEvents);

 }catch(e){$('feedStatus').textContent='Unable to load data: '+e.message+' · Retrying automatically';}

 finally{feedLoading=false;}

}

$('latestEvents').onclick=()=>loadEvents(null,true);

$('olderEvents').onclick=()=>olderCursor&&loadEvents(olderCursor,true);

async function pollLive(){

 if(document.hidden||liveBusy)return;liveBusy=true;

 try{

  const response=await fetch('/api/events/live?after='+latestId,{cache:'no-store',signal:AbortSignal.timeout(8000)});

  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Unable to receive live data');

  if(data.events.length){rememberTags(data.events);for(const item of data.events)latestId=Math.max(latestId,Number(item.id));

   if(onOlderPage){pendingEvents+=data.events.length;$('latestEvents').textContent='Latest data (+'+pendingEvents+')';}

   else {const combined=[...data.events,...visibleEvents];const unique=[...new Map(combined.map(item=>[Number(item.id),item])).values()].sort((a,b)=>Number(b.id)-Number(a.id));visibleEvents=unique.filter(isRecent).slice(0,50);olderCursor=unique.length>50?unique[49].id:olderCursor;renderEvents(visibleEvents);feedSignature=visibleEvents.map(e=>e.id).join(',');$('olderEvents').hidden=!olderCursor;$('feedStatus').textContent='LIVE · '+readSummary(visibleEvents);}

  }

  if(!data.events.length&&!onOlderPage){if(!visibleEvents.length)renderEvents([]);$('feedStatus').textContent='LIVE · '+readSummary(visibleEvents);}

 }catch(e){$('feedStatus').textContent='Live connection failed: '+e.message+' · Retrying';}

 finally{liveBusy=false;}

}

function expireOldReads(){

 if(onOlderPage)return;

 const current=visibleEvents.filter(isRecent);

 if(current.length===visibleEvents.length)return;

 visibleEvents=current;renderEvents(visibleEvents);feedSignature=visibleEvents.map(e=>e.id).join(',');

 $('feedStatus').textContent=visibleEvents.length?'LIVE · '+readSummary(visibleEvents):'No tags detected in the last 5 seconds';

}

let statusBusy=false;

function setReaderStatus(state,label){const node=$('readerStatus');if(!node)return;node.classList.remove('online','offline','unknown');node.classList.add(state);node.replaceChildren(el('i'),document.createTextNode(label));}

function hasRecentReaderData(){return [...tagChoices.values()].some(tag=>{const age=Date.now()-Date.parse(tag.lastAt);return Number.isFinite(age)&&age>=0&&age<=15000;});}

async function pollReaderStatus(){

 if(document.hidden||statusBusy)return;statusBusy=true;

 try{

  const response=await fetch('/api/reader/status',{cache:'no-store',signal:AbortSignal.timeout(8000)}),data=await response.json();

  if(!response.ok||!data.ok)throw Error(data.error||'Unable to read heartbeat status');

  const latest=data.readers?.[0];

  if(!latest){const online=hasRecentReaderData();setReaderStatus(online?'online':'offline',online?'Online':'Offline');return;}

  const at=Date.parse(latest.receivedAt),age=Math.max(0,Date.now()-at),previous=Date.parse(latest.previousAt||'');

  const timeout=Number.isFinite(previous)?Math.max(5000,Math.min(60000,(at-previous)*3)):180000;

  const online=hasRecentReaderData()||(Number.isFinite(at)&&age<=timeout);

  setReaderStatus(online?'online':'offline',online?'Online':'Offline');

 }catch(e){const online=hasRecentReaderData();setReaderStatus(online?'online':'unknown',online?'Online':'Offline');}

 finally{statusBusy=false;}

}

$('latestEvents').textContent='Latest data';

document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollLive();pollReaderStatus();}});

loadEvents();

let inventoryPaintPending=false;window.addEventListener('inventorydata',()=>{if(inventoryPaintPending||document.hidden)return;inventoryPaintPending=true;setTimeout(()=>{inventoryPaintPending=false;pollLive();},100);});

setInterval(()=>{pollLive();expireOldReads();},500);

pollReaderStatus();setInterval(pollReaderStatus,1000);

function updateTagDetails(item){

 const detected=NativeRfid.currentState.connected&&!!item?.epc&&!!item.event&&(isRecent(item.event)||(NativeRfid.currentState.connected&&!NativeRfid.currentState.reading&&item.epc===selectedEpc));document.querySelector('.panel.editor').hidden=!detected;document.querySelector('.selectionPanel').hidden=true;

 const compact=$('selectedTagSummary');if(compact){compact.replaceChildren();compact.append(el('strong',item?(epcAscii(item.epc)||item.epc):'No tag selected'));if(item)compact.append(el('small','Writes will use this tag'));}

 const panel=$('tagDetails');if(!panel)return;

 if(!item){selectedEpc='';if($('epc'))$('epc').value='';if($('userCapability'))$('userCapability').textContent='USER status appears when the reader returns tag data';panel.replaceChildren(el('p','No tag detected in the last 5 seconds. Details appear after a reader scan.','empty'));return;}

 if($('epc')&&[...$('epc').options].some(option=>option.value===item.epc))$('epc').value=item.epc;

 const userState=userReadStatus(item.event?.payload,item.epc);if($('userCapability'))$('userCapability').textContent=userState.label+' · Read status only; write capability is not confirmed';

 if($('tagInfoDialog').open||$('writeTagDialog')?.open)panel.replaceChildren(memorySummary(item.event.payload,item.epc,item.count,item.event.receivedAt));

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

 root.append(el('h3','EPC · '+epc,'tagEpc'),el('small','Reads: '+count+' times'+(receivedAt?' · '+new Date(receivedAt).toLocaleString('en-GB'):''),'tagReadTime'));

 const epcText=(asHex(epc)?.match(/../g)||[]).map(pair=>parseInt(pair,16));while(epcText[0]===0)epcText.shift();while(epcText[epcText.length-1]===0)epcText.pop();

 if(epcText.length&&epcText.every(byte=>byte>=32&&byte<=126)){const hero=el('section',undefined,'tagText');hero.append(el('small','EPC text · ASCII'),el('strong',epcText.map(byte=>String.fromCharCode(byte)).join('')),el('small','Leading and trailing NUL bytes are hidden in this preview. Raw data is below.'));root.append(hero);}

 root.append(el('h4','Readable memory','groupTitle'));

 if(directReads)root.append(el('small','MC3390R READ results. EPC bank includes CRC and PC. A successful read does not confirm write access or lock status.'));

 const banks=el('div',undefined,'memoryCards');

 for(const bank of ['EPC','TID','USER','RESERVED']){

  const raw=lookup(bank),hex=bank==='EPC'?(asHex(raw)||asHex(epc)):asHex(raw),cell=el('section',undefined,'memoryCard');cell.dataset.memory=bank;

  const header=el('div',undefined,'memoryHead');header.append(el('h5',bank),el('span',hex?'Read successful':raw===undefined?'No data':'Read failed',hex?'bankStatus ok':'bankStatus'));cell.append(header);

 if(hex){const words=hex.length/4;cell.append(el('strong',(hex.length*4)+' bits · '+(hex.length/2)+' bytes · '+words+' '+(words===1?'word':'words')));const details=el('details',undefined,'bankraw');details.dataset.bank=bank;details.dataset.rawKey=epc+'-'+bank;if(openBanks.has(bank))details.open=true;details.append(el('summary','View original HEX'));const value=el('code',hex);details.append(value);cell.append(details);}

  else if(typeof raw==='string'&&/memory overrun/i.test(raw)){cell.classList.add('memoryWarning');cell.append(el('p','Memory read out of range (0x03)'),el('small','Check the offset and word count, then reduce the read range. This error does not establish USER capacity.'));}

  else cell.append(el('p',raw===undefined?'No data from the reader':String(raw)));

  if(hex){const bytes=hex.match(/../g)||[];const ascii=bytes.map(pair=>{const byte=parseInt(pair,16);return byte>=0x20&&byte<=0x7e?String.fromCharCode(byte):'·';}).join('');const converted=el('div',undefined,'asciiValue');converted.append(el('small','ASCII (7-bit)'),el('code',ascii));cell.append(converted);}

  banks.append(cell);

 }

 root.append(banks,el('small','Received data size, not the chip’s maximum capacity. 1 word = 16 bits = 2 bytes. Non-printable ASCII bytes appear as ·'));

 const meta=el('dl',undefined,'tagMetadata');

 const technical=el('details',undefined,'technical');technical.dataset.rawKey=epc+'-technical';technical.append(el('summary','Technical data · PC / CRC / Event'));const extra=el('dl',undefined,'tagMetadata');

 const values=[['PC',lookup('PC')],['CRC',lookup('CRC')],['Antenna',lookup('antenna')],['Peak RSSI',lookup('peakRssi')],['Channel',lookup('channel')],['Format',lookup('format')],['Reader',lookup('hostName')],['MAC',lookup('MAC')],['Phase',lookup('phase')],['Event',lookup('eventNum')]];

 for(const [label,value] of values)if(value!==undefined){let shown=String(value);if(label==='PC'||label==='CRC'){const hex=asHex(value);if(hex)shown='0x'+hex+' · '+(hex.length*4)+' bits · '+(hex.length/4)+' words';}else if(label==='Peak RSSI')shown+=' dBm';else if(label==='Channel')shown+=' MHz';const item=el('div',undefined,'tagMetric');item.append(el('dt',label),el('dd',shown));meta.append(item);}

 for(const item of [...meta.children])if(['PC','CRC','Format','Phase','Event'].includes(item.querySelector('dt').textContent))extra.append(item);

 if(meta.childElementCount)root.append(el('h4','Signal and reader','groupTitle'),meta);

 if(extra.childElementCount){technical.append(extra);root.append(technical);}

 return root;

}

$('memoryBank').addEventListener('change',()=>{

 const bank=$('memoryBank').value;$('offset').value=bank==='EPC'?'4':'0';

 $('bankNote').textContent=bank==='TID'?'TID is usually factory-locked; only supported chips allow writing':bank==='RESERVED'?'Reserved stores Kill/Access passwords. Check values before writing.':bank==='EPC'?'Start at byte 4 to preserve CRC/PC. Enter data for the complete target range.':'Write USER memory';update();

});

$('memoryBank').dispatchEvent(new Event('change'));

async function writerStatus(){try{const response=await fetch('/api/write/config');const data=await response.json();endpoint=data.available?'/api/write':'';$('below').textContent=data.available?'On-device SDK · Read-back verification':'Connect the integrated reader';$('write').innerHTML=data.available?'<span>✎</span> Write tag':'<span>✎</span> Waiting for connection';update();}catch{endpoint='';$('below').textContent='Reader connection unavailable';$('write').innerHTML='<span>✎</span> Waiting for connection';update();}}writerStatus();setInterval(writerStatus,10000);

let visibleTagLimit=10;const readMoreTags=el('button','Read more');readMoreTags.id='readMoreTags';readMoreTags.hidden=true;feedList.after(readMoreTags);readMoreTags.onclick=()=>{visibleTagLimit+=10;filterTagList();};
function filterTagList(){const hasTags=feedList.querySelector('.eventitem')!==null;$('openTagFilter').hidden=!hasTags;$('factoryReset').hidden=!hasTags;const query=($('tagSearch')?.value||'').trim().toLowerCase(),group=document.querySelector('[name=tagGroup]:checked')?.value||'all';let matches=0;const rows=[...feedList.querySelectorAll('.eventitem')],counts={all:rows.length,readable:0,overrun:0,error:0,unknown:0};for(const row of rows){const epc=row.querySelector('.chooseTag')?.dataset.epc||'';counts[row.dataset.group]++;row.hidden=(group!=='all'&&row.dataset.group!==group)||(!!query&&!((epcAscii(epc)||'')+' '+epc).toLowerCase().includes(query));if(!row.hidden){matches++;row.hidden=matches>visibleTagLimit;}}readMoreTags.hidden=matches<=visibleTagLimit;document.querySelectorAll('[data-filter-count]').forEach(node=>{node.textContent=counts[node.dataset.filterCount]||0;});if($('filterEmpty'))$('filterEmpty').hidden=matches>0||rows.length===0;const status=$('searchStatus');if(status){status.hidden=!query&&group==='all';status.textContent=matches?'Found '+matches+' tags':'No tags match the filters';}const opener=$('openTagFilter');if(opener)opener.textContent=query||group!=='all'?'Filter · '+matches:'Filter';if($('applyTagFilter'))$('applyTagFilter').textContent='Show '+matches+' tags';}

const filterDialog=$('tagFilterDialog');$('openTagFilter').onclick=()=>{filterTagList();if(filterDialog.showModal)filterDialog.showModal();else filterDialog.setAttribute('open','');$('tagSearch').focus();};function closeTagFilter(){if(filterDialog.close)filterDialog.close();else filterDialog.removeAttribute('open');$('openTagFilter').focus();}$('closeTagFilter').onclick=closeTagFilter;$('applyTagFilter').onclick=closeTagFilter;filterDialog.addEventListener('cancel',()=>{$('openTagFilter').focus();});filterDialog.addEventListener('click',event=>{if(event.target===filterDialog){const rect=filterDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeTagFilter();}});$('tagSearch').addEventListener('input',filterTagList);document.querySelectorAll('[name=tagGroup]').forEach(input=>input.addEventListener('change',filterTagList));$('resetTagFilter').onclick=()=>{$('tagSearch').value='';document.querySelector('[name=tagGroup][value=all]').checked=true;filterTagList();};

const editorPanel=document.querySelector('.editor');function updateEditorSticky(){if(editorPanel)editorPanel.style.setProperty('--editor-top',Math.min(16,window.innerHeight-editorPanel.getBoundingClientRect().height-16)+'px');}if(typeof ResizeObserver!=='undefined'&&editorPanel)new ResizeObserver(updateEditorSticky).observe(editorPanel);window.addEventListener('resize',updateEditorSticky);updateEditorSticky();

const infoDialog=$('tagInfoDialog');$('openTagInfo').onclick=()=>{const item=tagChoices.get(selectedEpc);if(item)$('tagDetails').replaceChildren(memorySummary(item.event.payload,item.epc,item.count,item.event.receivedAt));if(infoDialog.showModal)infoDialog.showModal();else infoDialog.setAttribute('open','');};$('closeTagInfo').onclick=()=>{if(infoDialog.close)infoDialog.close();else infoDialog.removeAttribute('open');$('openTagInfo').focus();};infoDialog.addEventListener('click',e=>{if(e.target===infoDialog){const r=infoDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('closeTagInfo').click();}});$('memoryBank').addEventListener('change',()=>{const sensitive=['TID','RESERVED'].includes($('memoryBank').value);document.querySelector('.sensitiveConfirm').hidden=!sensitive;if(sensitive)$('advancedOptions').open=true;});document.querySelector('.sensitiveConfirm').hidden=true;

let drawerTrigger=null;function openTagDrawer(card,trigger){const drawer=$('tagDrawer'),content=$('tagDrawerContent');if(drawerTrigger)drawerTrigger.setAttribute('aria-expanded','false');drawerTrigger=trigger;content.replaceChildren(...[...card.children].filter(child=>child.tagName!=='SUMMARY').map(child=>child.cloneNode(true)));$('tagDrawerTitle').textContent='Tag details';trigger.setAttribute('aria-expanded','true');if(!drawer.open){if(drawer.showModal)drawer.showModal();else drawer.setAttribute('open','');}}function finishTagDrawer(){if(!drawerTrigger)return;drawerTrigger?.setAttribute('aria-expanded','false');if(drawerTrigger?.isConnected)drawerTrigger.focus();else $('eventList').focus();drawerTrigger=null;}function closeTagDrawer(){const drawer=$('tagDrawer');if(drawer.close)drawer.close();else drawer.removeAttribute('open');finishTagDrawer();}$('closeTagDrawer').onclick=closeTagDrawer;$('tagDrawer').addEventListener('close',finishTagDrawer);$('tagDrawer').addEventListener('cancel',()=>{setTimeout(finishTagDrawer,0);});$('tagDrawer').addEventListener('click',event=>{if(event.target!==$('tagDrawer'))return;const r=$('tagDrawer').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeTagDrawer();});

let powerControlPending=false,powerStatusBusy=false,powerControlState=null,powerEditing=false;

function renderPower(){const slider=$('readerPower');slider.disabled=!powerControlState||powerControlPending||busy;if(!powerEditing&&!powerControlPending){if(powerControlState){slider.min=powerControlState.minDbm;slider.max=powerControlState.maxDbm;slider.step=powerControlState.step||1;slider.value=powerControlState.powerDbm??powerControlState.minDbm;$('powerValue').textContent=powerControlState.powerDbm===null?'Mixed antenna power':powerControlState.powerDbm+' dBm';}else $('powerValue').textContent='Unavailable';}}

async function pollPower(){if(document.hidden||powerStatusBusy||powerControlPending||powerEditing)return;powerStatusBusy=true;try{const response=await fetch('/api/reader/power',{cache:'no-store',signal:AbortSignal.timeout(8000)}),state=await response.json();if(!response.ok||!state.ok)throw Error('Power control unavailable');powerControlState=state.available&&Number.isFinite(state.minDbm)&&Number.isFinite(state.maxDbm)?state:null;}catch{powerControlState=null;}finally{powerStatusBusy=false;renderPower();}}

$('readerPower').addEventListener('input',()=>{powerEditing=true;$('powerValue').textContent=$('readerPower').value+' dBm';$('powerFeedback').textContent='Release to apply';});

$('readerPower').addEventListener('change',async()=>{powerEditing=false;if(powerControlPending||busy||!powerControlState){renderPower();return;}const powerDbm=Number($('readerPower').value);if(powerDbm===powerControlState.powerDbm){$('powerFeedback').textContent='';renderPower();return;}powerControlPending=true;renderPower();$('powerFeedback').textContent='Applying…';try{const response=await fetch('/api/reader/power',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),powerDbm}),signal:AbortSignal.timeout(8000)}),queued=await response.json();if(!response.ok)throw Error(queued.error||'Power command rejected');let confirmed=false;for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,500));const reply=await fetch('/api/write/result?requestId='+encodeURIComponent(queued.requestId),{cache:'no-store',signal:AbortSignal.timeout(8000)}),result=await reply.json();if(!reply.ok)throw Error(result.error||'Unable to verify power');if(result.status==='success'&&result.verified===true&&result.powerDbm===powerDbm){powerControlState={...powerControlState,powerDbm};confirmed=true;break;}if(['failed','unknown'].includes(result.status))throw Error(result.message||'Power change not confirmed');}if(!confirmed)throw Error('Reader response timed out. Checking actual power.');$('powerFeedback').textContent='Confirmed by reader';showToast('success','Antenna power set to '+powerDbm+' dBm');}catch(error){$('powerFeedback').textContent='Change not confirmed';showToast('failure',error.message);}finally{powerControlPending=false;renderPower();await pollPower();}});

$('readerPower').addEventListener('blur',()=>{if(powerEditing){powerEditing=false;$('powerFeedback').textContent='';renderPower();}});

pollPower();setInterval(pollPower,2000);

let factoryBusy=false,factoryStop=false;

function factoryTargets(){const now=Date.now(),live=new Set([...feedList.querySelectorAll('.eventcard')].map(card=>card.dataset.epc));for(const tag of tagChoices.values())if(now-Date.parse(tag.lastAt)<=15000)live.add(tag.epc);if(selectedEpc)live.add(selectedEpc);return [...live].filter(epc=>/^(?:[0-9A-F]{2})+$/.test(epc||''));}

function selectedFactoryTargets(){return [...$('factoryResetTargets').querySelectorAll('input:checked')].map(input=>input.value);}

function refreshFactoryDialog(){const targets=selectedFactoryTargets(),reading=!!NativeRfid.currentState.reading,password=$('accessPassword').value.trim(),passwordOk=!password||/^[0-9A-Fa-f]{8}$/.test(password);$('confirmFactoryReset').disabled=factoryBusy||reading||!targets.length||!passwordOk;$('factoryReset').disabled=factoryBusy||!NativeRfid.currentState.connected;if(factoryBusy||$('factoryResetStatus').textContent.startsWith('Finished'))return;$('factoryResetStatus').textContent=!passwordOk?'Enter an 8-digit HEX access password, or leave it empty.':reading?'Release the trigger before resetting tags.':targets.length?targets.length+' tag'+(targets.length===1?'':'s')+' selected. USER memory will be set to 00.':'Select at least one tag to reset.';}

async function runFactoryReset(){if(factoryBusy)return;const targets=selectedFactoryTargets(),password=$('accessPassword').value.trim();refreshFactoryDialog();if($('confirmFactoryReset').disabled)return;factoryBusy=true;factoryStop=false;busy=true;update();refreshFactoryDialog();const log=$('factoryResetLog');log.replaceChildren();let reset=0,skipped=0,failed=0;try{for(let index=0;index<targets.length;index++){if(factoryStop)break;const epc=targets[index];$('factoryResetStatus').textContent='Reading '+(index+1)+' of '+targets.length+' · '+epc;let read;try{read=await NativeRfid.command('banks',{epc,accessPassword:password});}catch(error){failed++;log.append(el('li',epc+' · '+error.message));continue;}const user=read.status==='success'?read.banks?.USER:'';if(typeof user!=='string'||!/^(?:[0-9A-F]{2})+$/i.test(user)){skipped++;log.append(el('li',epc+' · skipped, no readable USER memory'));continue;}const length=user.length/2;if(length<1||length>1024){failed++;log.append(el('li',epc+' · USER size '+length+' bytes is outside 1–1024'));continue;}$('factoryResetStatus').textContent='Resetting '+(index+1)+' of '+targets.length+' · '+length+' bytes';let write;try{write=await NativeRfid.command('write',{operation:'write',memoryBank:'USER',epc,offsetBytes:0,lengthBytes:length,accessPassword:password,confirmSensitive:false,dataHex:'00'.repeat(length)});}catch(error){failed++;log.append(el('li',epc+' · '+error.message));continue;}if(write.status==='success'&&write.verified===true){reset++;log.append(el('li',epc+' · '+length+' bytes verified as 00'));}else{failed++;log.append(el('li',epc+' · '+(write.message||'Write was not verified')));}}$('factoryResetStatus').textContent='Finished · '+reset+' reset · '+skipped+' skipped · '+failed+' failed'+(factoryStop?' · stopped':'');showToast(reset===targets.length&&!factoryStop?'success':'warning',(reset===targets.length&&!factoryStop?'Reset successful':'Reset incomplete')+' - '+reset+' reset - '+skipped+' skipped - '+failed+' failed');$('toast').setAttribute('role','alert');}finally{factoryBusy=false;factoryStop=false;busy=false;update();refreshFactoryDialog();closeFactoryDialog();}}

const factoryDialog=$('factoryResetDialog');$('factoryReset').disabled=!NativeRfid.currentState.connected;$('factoryReset').onclick=()=>{factoryStop=false;$('factoryResetLog').replaceChildren();$('factoryResetStatus').textContent='';const list=$('factoryResetTargets');list.replaceChildren();for(const epc of factoryTargets()){const label=el('label',''),input=document.createElement('input');input.type='checkbox';input.value=epc;input.addEventListener('change',refreshFactoryDialog);label.append(input,document.createTextNode(epc));list.append(label);}refreshFactoryDialog();if(factoryDialog.showModal)factoryDialog.showModal();else factoryDialog.setAttribute('open','');};function closeFactoryDialog(){if(factoryBusy){factoryStop=true;return;}if(factoryDialog.close)factoryDialog.close();else factoryDialog.removeAttribute('open');$('factoryReset').focus();}

$('closeFactoryReset').onclick=closeFactoryDialog;$('cancelFactoryReset').onclick=closeFactoryDialog;$('confirmFactoryReset').onclick=runFactoryReset;factoryDialog.addEventListener('cancel',event=>{if(factoryBusy){event.preventDefault();factoryStop=true;}else $('factoryReset').focus();});window.addEventListener('readerstate',refreshFactoryDialog);

const writeDialog=document.createElement('dialog');writeDialog.id='writeTagDialog';writeDialog.setAttribute('aria-label','Write selected tag');

const writeHeading=el('div',undefined,'filterHeading'),writeTitle=el('h2','Write tag'),writeClose=el('button');writeClose.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';writeClose.type='button';writeClose.setAttribute('aria-label','Close write tag');writeHeading.append(writeTitle,writeClose);const modalTabs=el('div',undefined,'modalTabs');modalTabs.setAttribute('role','tablist');modalTabs.setAttribute('aria-label','Tag view');
const tabThumb=el('span',undefined,'tabThumb'),detailsTab=el('button','Details'),writeTab=el('button','Write tag');
for(const tab of [detailsTab,writeTab]){tab.type='button';tab.setAttribute('role','tab');}
detailsTab.id='modalDetailsTab';writeTab.id='modalWriteTab';modalTabs.append(tabThumb,detailsTab,writeTab);
const modalBody=el('div',undefined,'modalBody');modalBody.append(document.querySelector('.panel.tagdetails'),document.querySelector('.panel.editor'),document.querySelector('.panel.result'));
const modalHeader=el('div',undefined,'modalHeader');modalHeader.append(writeHeading,modalTabs);writeDialog.append(modalHeader,modalBody);document.body.append(writeDialog);
function setModalView(view){if(view==='details')$('data').blur();writeDialog.dataset.view=view;detailsTab.setAttribute('aria-selected',String(view==='details'));writeTab.setAttribute('aria-selected',String(view==='write'));detailsTab.tabIndex=view==='details'?0:-1;writeTab.tabIndex=view==='write'?0:-1;}
detailsTab.onclick=()=>setModalView('details');writeTab.onclick=()=>setModalView('write');
let tabTouchX=null;modalTabs.addEventListener('touchstart',event=>{tabTouchX=event.touches[0]?.clientX;},{passive:true});modalTabs.addEventListener('touchend',event=>{const x=event.changedTouches[0]?.clientX;if(tabTouchX!==null&&Math.abs(x-tabTouchX)>20)setModalView(x>tabTouchX?'write':'details');tabTouchX=null;},{passive:true});
modalTabs.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const tab=event.key==='ArrowLeft'?detailsTab:writeTab;tab.click();tab.focus();});setModalView('write');

function openWriteDialog(epc){writeTitle.textContent=(epcAscii(epc)||epc);if(!writeDialog.open){if(writeDialog.showModal)writeDialog.showModal();else writeDialog.setAttribute('open','');}refreshSelectedTagDetails();NativeRfid.invalidateBanks(epc);}

function closeWriteDialog(){if(busy){showToast('warning','Wait for the write result before closing');return;}document.getElementById('data').blur();if(writeDialog.close)writeDialog.close();else writeDialog.removeAttribute('open');}

writeClose.onclick=closeWriteDialog;writeDialog.addEventListener('cancel',event=>{if(busy){event.preventDefault();return;}document.getElementById('data').blur();});

function refreshSelectedTagDetails(){updateTagDetails(tagChoices.get($('epc').value)||null);}
