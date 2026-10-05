/* Mobile presentation and memory reads share the one selected tag. */
(function(){
 const button=document.getElementById('connectReader');let connecting=false,bankReading=false,lastBankEpc='',lastBankAttempt=0,lastBankAttemptEpc='',requestedDetail='';
 const notice=document.createElement('p');notice.className='mobileHint';notice.setAttribute('role','status');notice.id='readerMessage';button.after(notice);
 async function refresh(){await writerStatus();await pollPower();pollLive();}
 window.addEventListener('readerstate',event=>{const state=event.detail;setReaderStatus(state.connected?'online':'offline',state.connected?'Online':'Offline');button.textContent=state.connected?'Reader connected':'Connect reader';button.disabled=connecting||state.connected;button.hidden=state.connected;notice.textContent=state.connected?'':state.message||'';refresh();if(!state.connected){document.querySelector('.panel.editor').hidden=true;document.querySelector('.selectionPanel').hidden=true;}if(!state.reading)readSelected(requestedDetail||undefined);});
 // The SDK connection is authoritative, including after disconnect. Old tags cannot make it online.
 pollReaderStatus=async function(){const state=NativeRfid.currentState;setReaderStatus(state.connected?'online':'offline',state.connected?'Online':'Offline');};
 button.onclick=async function(){if(connecting)return;connecting=true;button.disabled=true;notice.textContent='Connecting to the integrated reader…';try{const result=await NativeRfid.command('connect',{});if(result.status!=='success')throw Error(result.message||'Connection failed');}catch(error){notice.textContent=error.message;showToast('failure',error.message);}finally{connecting=false;button.disabled=NativeRfid.currentState.connected;refresh();}};
 async function readSelected(target){const epc=typeof target==='string'?target:document.getElementById('epc').value;if(window.powerUiLocked||window.writeUiLocked||!(document.getElementById('writeTagDialog')?.open||document.getElementById('tagDrawer').open||document.getElementById('tagInfoDialog').open)||document.hidden||NativeRfid.currentState.triggerHeld||NativeRfid.currentState.reading||!epc||epc===lastBankEpc||bankReading||!NativeRfid.currentState.connected||epc===lastBankAttemptEpc&&Date.now()-lastBankAttempt<10000)return;bankReading=true;lastBankAttempt=Date.now();lastBankAttemptEpc=epc;try{const result=await NativeRfid.command('banks',{epc,accessPassword:document.getElementById('accessPassword').value});if(result.status!=='success')throw Error(result.message||'Memory read failed');lastBankEpc=Object.values(result.readableErrors||{}).some(message=>!/No readable memory found|memory overrun|locked|access denied/i.test(message))?'':epc;await pollLive();if(document.getElementById('epc').value===epc)loadExistingData();update();const drawer=document.getElementById('tagDrawer');if(drawer.open&&drawer.dataset.epc===epc){const data=await(await fetch('/api/events')).json();const event=data.events.find(event=>event.payload.some(record=>record.data.idHex===epc));if(event)document.getElementById('tagDrawerContent').replaceChildren(memorySummary(event.payload,epc,1,event.receivedAt));}}catch(error){showToast('warning',error.message);}finally{bankReading=false;}}
 window.addEventListener('memoryinvalidated',()=>{lastBankEpc='';lastBankAttempt=0;lastBankAttemptEpc='';pollLive();refreshSelectedTagDetails();update();});
 document.getElementById('accessPassword').addEventListener('change',()=>NativeRfid.invalidateBanks(document.getElementById('epc').value));
 window.addEventListener('tagdetails',event=>{requestedDetail=event.detail.epc;document.getElementById('tagDrawer').dataset.epc=event.detail.epc;readSelected(requestedDetail);});
 document.getElementById('tagDrawer').addEventListener('close',()=>{requestedDetail='';});
 document.getElementById('epc').addEventListener('change',()=>{requestedDetail='';readSelected();});setInterval(readSelected,1500);
 document.getElementById('below').textContent='On-device SDK · Read-back verification';
 const info=document.createElement('p');info.className='mobileHint';info.textContent='Use the trigger to scan. Select a tag once, enter data, then write and verify.';document.querySelector('.heading').append(info);
 document.getElementById('readerPower').setAttribute('aria-label','Antenna transmit power in dBm');

 let modeQueue=Promise.resolve(),desiredMode='rfid',appliedMode=null,lastInput=null;
 function editable(node){return node instanceof HTMLElement&&!node.disabled&&!node.readOnly&&(node.tagName==='TEXTAREA'||node.tagName==='INPUT'&&['text','search','password','email','tel','url','number'].includes(node.type));}
 function changeScannerMode(mode,input=null){
  desiredMode=mode;if(input){lastInput=input;input.dataset.scannerMode=appliedMode===mode?mode:'switching';}
  modeQueue=modeQueue.catch(()=>{}).then(async()=>{
   if(mode!==desiredMode||!NativeRfid.currentState.connected)return;
   if(appliedMode!==mode){const result=await NativeRfid.command('scannerMode',{mode});if(result.status!=='success'){if(lastInput)lastInput.dataset.scannerMode='unavailable';showToast('failure',result.message||'Scanner mode change failed');return;}appliedMode=mode;}
   if(mode===desiredMode&&lastInput)lastInput.dataset.scannerMode=mode;
  });
 }
 document.addEventListener('focusin',event=>{if(editable(event.target))changeScannerMode('barcode',event.target);});
 document.addEventListener('focusout',event=>{if(editable(event.target)&&!editable(event.relatedTarget))changeScannerMode('rfid');});
 window.addEventListener('readerstate',event=>{if(!event.detail.connected){appliedMode=null;if(lastInput)lastInput.dataset.scannerMode='unavailable';}else if(editable(document.activeElement)&&desiredMode!=='barcode')changeScannerMode('barcode',document.activeElement);else if(editable(document.activeElement)&&appliedMode===null&&document.activeElement.dataset.scannerMode!=='switching')changeScannerMode('barcode',document.activeElement);});
 NativeRfid.barcode=function(value){
  const input=document.activeElement;if(window.powerUiLocked||window.writeUiLocked||!editable(input)||appliedMode!=='barcode'||desiredMode!=='barcode'||input.dataset.scannerMode!=='barcode')return;
  const hex=input.id==='data'&&document.querySelector('[name=format]:checked').value==='HEX'||input.id==='multiWriteData'&&document.querySelector('#multiWriteDialog [data-encoding=HEX]')?.getAttribute('aria-pressed')==='true';
  const encoded=hex?Array.from(value,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('').toUpperCase():value;
  const start=input.selectionStart??input.value.length,end=input.selectionEnd??input.value.length;
  if(['number','email'].includes(input.type))input.value=input.value.slice(0,start)+encoded+input.value.slice(end);else input.setRangeText(encoded,start,end,'end');
  input.dispatchEvent(new Event('input',{bubbles:true}));
 };
 button.click();
})();
