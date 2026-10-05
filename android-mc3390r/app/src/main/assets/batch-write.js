/* Sequential multi-tag writes: the same value, or a different value per tag (1, 2, 3…). USER or EPC. */
(function(){
 const launch=el('button','Write tags');launch.id='writeTags';launch.type='button';launch.hidden=true;launch.setAttribute('aria-haspopup','dialog');$('factoryReset').after(launch);
 const dialog=el('dialog',undefined,'multiResetDialog');dialog.id='multiWriteDialog';dialog.setAttribute('aria-labelledby','multiWriteTitle');
 dialog.innerHTML='<div class="multiResetHeader"><h2 id="multiWriteTitle">Write multiple tags</h2><button type="button" id="closeMultiWrite" aria-label="Close multiple tag write"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="multiResetBody"><div id="multiWriteSetup"><h3>1. Select tags</h3><input id="multiWriteSearch" type="search" placeholder="Search name, EPC or TID" aria-label="Search tags to write"><button type="button" id="multiWriteAll">Select visible</button><div id="multiWriteTags" class="multiResetTags"></div><h3>2. Write data</h3><label for="multiWriteDestination">Destination</label><select id="multiWriteDestination"><option value="USER">Tag data (USER)</option><option value="EPC">Tag name / ID (EPC)</option></select><div class="batchFormats" id="multiWriteModes"><button type="button" data-mode="same" aria-pressed="true">Same data</button><button type="button" data-mode="sequence" aria-pressed="false">1, 2, 3…</button></div><div id="multiWriteShared"><div class="batchFormats"><button type="button" data-encoding="ASCII" aria-pressed="true">Text</button><button type="button" data-encoding="HEX" aria-pressed="false">HEX</button></div><label for="multiWriteData">Data</label><button type="button" id="multiWriteClear">Clear</button><textarea id="multiWriteData" rows="4" placeholder="Enter shared data" spellcheck="false"></textarea><small id="multiWriteCount">0 bytes</small></div><div id="multiWriteSequence" hidden><div class="multiWriteSequenceBar"><label for="multiWriteStart">First number<input id="multiWriteStart" type="number" min="0" step="1" value="1" inputmode="numeric"></label><button type="button" id="multiWriteFill">Fill numbers</button></div></div><p id="multiWriteHint">Same data for each selected tag. Old data in that bank is replaced.</p><details><summary>Advanced options</summary><label for="multiWritePassword">Access password (optional)</label><input id="multiWritePassword" type="password" maxlength="8" autocomplete="off"></details><p id="multiWriteError" role="status"></p></div><p id="multiWriteProgress" role="status" aria-live="polite" hidden></p><div id="multiWriteResults" class="multiResetResults"></div></div><div class="multiResetFooter"><button type="button" id="startMultiWrite">Write to selected tags</button></div>';
 document.body.append(dialog);let encoding='ASCII',mode='same',running=false,cleared=false;
 dialog.dataset.mode='same';
 function rows(){return [...$('multiWriteTags').children];}
 function checkedRows(){return rows().filter(row=>row.querySelector('input[type=checkbox]').checked);}
 function targets(){return checkedRows().map(row=>row.querySelector('input[type=checkbox]').value);}
 function destination(){return $('multiWriteDestination').value==='EPC'?'EPC':'USER';}
 function sharedBytes(){return decodeBytes($('multiWriteData').value,encoding);}
 function sequenceText(row){return row.querySelector('.multiWriteValue').value;}
 function assignSequence(){
  const start=Number($('multiWriteStart').value);if(!Number.isSafeInteger(start)||start<0)return;
  let n=0;for(const row of rows()){const box=row.querySelector('input[type=checkbox]'),field=row.querySelector('.multiWriteValue');if(box.checked){field.value=String(start+n);n++;}else field.value='';}
 }
 function valueBytes(row,epc){
  const bank=destination();
  const raw=mode==='sequence'?decodeBytes(sequenceText(row),'ASCII'):sharedBytes();
  if(bank!=='EPC'){if(!raw.length&&!(cleared&&mode==='same'))throw Error('Enter at least 1 byte or choose Clear.');return raw;}
  const length=epc.length/2;
  if(!raw.length){if(cleared&&mode==='same')return Array(length).fill(0);throw Error('Enter at least 1 byte.');}
  if(raw.length>length)throw Error('Longer than this EPC ('+length+' bytes). Not written.');
  return [...Array(length-raw.length).fill(0),...raw];
 }
 function validate(){
  let error='',size=0;const bank=destination(),chosen=checkedRows();
  try{
   if($('multiWritePassword').value&&!/^[0-9a-f]{8}$/i.test($('multiWritePassword').value))throw Error('Access password must be 8 HEX digits.');
   if(mode==='sequence'){
    const start=Number($('multiWriteStart').value);if(!Number.isSafeInteger(start)||start<0)throw Error('First number must be a whole number, 0 or more.');
    for(const row of chosen){const bytes=valueBytes(row,row.querySelector('input[type=checkbox]').value);if(bytes.length>1024)throw Error('Maximum 1024 bytes.');}
    size=chosen.length;
   }else{
    size=sharedBytes().length;if(!size&&!cleared)throw Error('Enter at least 1 byte or choose Clear.');if(size>1024)throw Error('Maximum 1024 bytes. Each tag capacity will be checked before writing.');
    if(bank==='EPC')for(const epc of targets())if(size>epc.length/2)throw Error('Longer than EPC '+epc+' ('+(epc.length/2)+' bytes).');
   }
  }catch(e){error=e.message;}
  $('multiWriteCount').textContent=mode==='sequence'?chosen.length+' different values':size+' bytes';
  $('multiWriteHint').textContent=mode==='sequence'
   ?(bank==='EPC'?'Each checked tag gets the next number, top to bottom, as its EPC. Short text is padded with leading 00. CRC and PC stay.':'Each checked tag gets the next number, top to bottom. Old USER data is replaced.')
   :(bank==='EPC'?'Same EPC text for every selected tag. Short text is padded with leading 00. CRC and PC stay.':'Same data for each selected tag. Old USER data will be cleared.');
  $('multiWriteError').textContent=error;setButtonLabel($('startMultiWrite'),'Write to '+chosen.length+' tags');
  $('startMultiWrite').disabled=running||!!error||!chosen.length||!NativeRfid.currentState.connected;
  const q=$('multiWriteSearch').value.toLowerCase();for(const row of rows())row.hidden=!!q&&!row.textContent.toLowerCase().includes(q);
 }
 function setMode(next){
  mode=next;dialog.dataset.mode=next;$('multiWriteShared').hidden=next!=='same';$('multiWriteSequence').hidden=next!=='sequence';
  for(const button of dialog.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===next));
  if(next==='sequence')assignSequence();validate();
 }
 function close(){if(running)return;if(dialog.close)dialog.close();else dialog.removeAttribute('open');launch.focus();}
 $('closeMultiWrite').onclick=close;dialog.addEventListener('cancel',e=>{if(running)e.preventDefault();});
 launch.onclick=()=>{
  if(busy||window.powerUiLocked)return;cleared=false;$('multiWriteSetup').hidden=false;dialog.querySelector('.multiResetFooter').hidden=false;$('multiWriteProgress').hidden=true;$('multiWriteResults').replaceChildren();$('multiWriteTags').replaceChildren();$('multiWriteSearch').value='';
  const listed=[...tagCards.values()].sort((a,b)=>b.count-a.count);const source=listed.length?listed:[...tagChoices.values()].sort((a,b)=>b.count-a.count);
  for(const item of source){
   const row=el('div',undefined,'multiWriteRow'),label=el('label'),check=el('input'),caption=el('span'),value=el('input');
   check.type='checkbox';check.value=item.epc;check.checked=false;check.dataset.tid=item.tid||'';
   const name=epcAscii(item.epc);caption.append(el('strong',name||item.epc));
   const bits=[];if(name)bits.push(item.epc);if(item.tid)bits.push('TID '+item.tid);if(bits.length)caption.append(el('small',bits.join(' · ')));
   label.append(check,caption);value.type='text';value.className='multiWriteValue';value.placeholder='Value';value.setAttribute('aria-label','Value for '+(name||item.epc));value.autocomplete='off';value.spellcheck=false;
   row.append(label,value);check.onchange=()=>{if(mode==='sequence')assignSequence();validate();};value.addEventListener('input',validate);$('multiWriteTags').append(row);
  }
  validate();if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
 };
 $('multiWriteAll').onclick=()=>{const visible=rows().filter(row=>!row.hidden),all=visible.length&&visible.every(row=>row.querySelector('input[type=checkbox]').checked);for(const row of visible)row.querySelector('input[type=checkbox]').checked=!all;if(mode==='sequence')assignSequence();validate();};
 for(const id of ['multiWriteSearch','multiWritePassword'])$(id).addEventListener('input',validate);
 $('multiWriteDestination').addEventListener('change',validate);
 $('multiWriteStart').addEventListener('input',()=>{assignSequence();validate();});
 $('multiWriteFill').onclick=()=>{assignSequence();validate();};
 for(const button of dialog.querySelectorAll('[data-mode]'))button.onclick=()=>setMode(button.dataset.mode);
 $('multiWriteData').addEventListener('input',()=>{cleared=false;if(encoding==='HEX')$('multiWriteData').value=$('multiWriteData').value.replace(/[^0-9a-f\s]/gi,'').toUpperCase();validate();});
 $('multiWriteClear').onclick=()=>{cleared=true;$('multiWriteData').value='';validate();};
 for(const button of dialog.querySelectorAll('[data-encoding]'))button.onclick=()=>{try{const values=sharedBytes(),next=button.dataset.encoding;if(next==='ASCII'&&values.some(x=>x<32||x>126))throw Error('Non-printable data must stay in HEX.');$('multiWriteData').value=next==='HEX'?values.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase():String.fromCharCode(...values);encoding=next;for(const option of dialog.querySelectorAll('[data-encoding]'))option.setAttribute('aria-pressed',String(option===button));validate();}catch(e){$('multiWriteError').textContent=e.message;}};
 function hexOf(bytes){return bytes.map(x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();}
 $('startMultiWrite').onclick=async()=>{
  if(running||busy||window.powerUiLocked)return;validate();if($('startMultiWrite').disabled)return;if(NativeRfid.currentState.reading||NativeRfid.currentState.triggerHeld){$('multiWriteError').textContent='Release the trigger before writing.';return;}
  const selected=checkedRows(),bank=destination(),password=$('multiWritePassword').value,planned=mode==='sequence';
  running=true;busy=true;setWriteUiLocked(true);$('multiWriteSetup').hidden=true;$('multiWriteProgress').hidden=false;const outcomes=[];
  try{for(let i=0;i<selected.length;i++){
   const row=selected[i],epc=row.querySelector('input[type=checkbox]').value,tid=row.querySelector('input[type=checkbox]').dataset.tid||'',label=planned?sequenceText(row):$('multiWriteData').value,name=(epcAscii(epc)||epc)+(planned?' = '+label:'');
   const line=el('details'),summary=el('summary',name+' — Reading'),detail=el('p');line.append(summary,detail);$('multiWriteResults').append(line);let uncertain=false;
   try{
    $('multiWriteProgress').textContent='Writing '+(i+1)+' of '+selected.length+(planned?' · '+label:'')+'. Keep tags close. Do not pull the trigger.';
    if(!NativeRfid.currentState.connected||NativeRfid.currentState.triggerHeld||NativeRfid.currentState.reading)throw Error('Reader not ready. Release the trigger.');
    const raw=valueBytes(row,epc);let body;
    if(bank==='EPC'){
     body={operation:'write',epc,memoryBank:'EPC',offsetBytes:4,lengthBytes:raw.length,dataHex:hexOf(raw),accessPassword:password,confirmSensitive:false,beforeHex:epc.toUpperCase()};
     if(tid)body.tidHex=tid;
    }else{
     const read=await NativeRfid.command('banks',{epc,accessPassword:password,banks:['USER']}),userHex=read.banks?.USER;
     if(read.status!=='success'||typeof userHex!=='string'||!/^(?:[0-9a-f]{4})+$/i.test(userHex)||userHex.length/2>1024)throw Error(read.readableErrors?.USER||read.message||'No readable USER memory. Not written.');
     const capacity=userHex.length/2;if(raw.length>capacity)throw Error('Data exceeds this tag capacity: '+capacity+' bytes. Not written.');
     const dataHex=hexOf(raw)+'00'.repeat(capacity-raw.length);
     body={operation:'write',epc,memoryBank:'USER',offsetBytes:0,lengthBytes:capacity,dataHex,accessPassword:password,confirmSensitive:false,beforeHex:userHex.toUpperCase()};
    }
    summary.textContent=name+' — Writing and verifying';
    let result=await NativeRfid.command('write',body);
    for(let attempt=0;attempt<3&&readerStillBusy(result);attempt++){summary.textContent=name+' — Waiting for the reader';await waitForReader(()=>{});result=await NativeRfid.command('write',body);}
    if(result.status!=='success'||result.verified!==true){uncertain=result.status!=='failed';throw Error(result.message||'Write not confirmed. Read before retrying.');}
    if(bank==='EPC'&&result.newEpc)selectWrittenEpc(result.newEpc);
    summary.textContent=name+' — Verified';line.className='resetVerified';detail.textContent=(bank==='EPC'?'EPC · '+(result.newEpc||body.dataHex):body.lengthBytes+' USER bytes')+' read-back verified.'+(Number.isFinite(result.durationMs)?' '+Math.round(result.durationMs)+' ms':'');outcomes.push(true);
   }catch(error){uncertain=uncertain||/timeout|timed out/i.test(error.message);summary.textContent=name+' — Not verified';line.className='resetFailed';detail.textContent=error.message;outcomes.push(false);}
   if(uncertain){for(const pending of selected.slice(i+1)){const target=pending.querySelector('input[type=checkbox]').value,skip=el('details');skip.append(el('summary',(epcAscii(target)||target)+' — Not attempted'),el('p','Previous write was unconfirmed. Read the tag before retrying.'));$('multiWriteResults').append(skip);outcomes.push(false);}break;}
  }}finally{running=false;busy=false;setWriteUiLocked(false);$('multiWriteProgress').hidden=true;dialog.querySelector('.multiResetFooter').hidden=false;$('startMultiWrite').disabled=false;setButtonLabel($('startMultiWrite'),'Done');$('startMultiWrite').onclick=close;update();const verified=outcomes.filter(Boolean).length;$('multiWriteTitle').textContent='Write results';$('multiWriteResults').prepend(el('h3',verified+' / '+selected.length+' tags verified'));showWriteBadge(verified+' / '+selected.length+' tags written and read-back verified.',verified===selected.length?'Write successful':'Write incomplete',verified!==selected.length);}
 };
 const originalBack=NativeRfid.back;NativeRfid.back=function(){if(!running&&dialog.open&&writeBadge.open){if(writeBadge.close)writeBadge.close();else writeBadge.removeAttribute('open');return true;}return originalBack();};
 const baseFilter=filterTagList;filterTagList=function(){baseFilter();launch.hidden=!feedList.querySelector('.eventitem');};filterTagList();
 const writeAction=$('startMultiWrite').onclick;const baseOpen=launch.onclick;launch.onclick=()=>{$('startMultiWrite').onclick=writeAction;$('multiWriteTitle').textContent='Write multiple tags';baseOpen();};
})();
