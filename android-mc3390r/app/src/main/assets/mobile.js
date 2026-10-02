/* Mobile presentation and memory reads share the one selected tag. */
(function(){
 const button=document.getElementById('connectReader');let connecting=false,bankReading=false,lastBankEpc='',lastBankAttempt=0,lastBankAttemptEpc='';
 const notice=document.createElement('p');notice.className='mobileHint';notice.setAttribute('role','status');notice.id='readerMessage';button.after(notice);
 async function refresh(){await writerStatus();await pollPower();pollLive();}
 window.addEventListener('readerstate',event=>{const state=event.detail;setReaderStatus(state.connected?'online':'offline',state.connected?'Online':'Offline');button.textContent=state.connected?'Reader connected':'Connect reader';button.disabled=connecting||state.connected;button.hidden=state.connected;notice.textContent=state.connected?'':state.message||'';refresh();});
 // The SDK connection is authoritative, including after disconnect. Old tags cannot make it online.
 pollReaderStatus=async function(){const state=NativeRfid.currentState;setReaderStatus(state.connected?'online':'offline',state.connected?'Online':'Offline');};
 button.onclick=async function(){if(connecting)return;connecting=true;button.disabled=true;notice.textContent='Connecting to the integrated reader…';try{const result=await NativeRfid.command('connect',{});if(result.status!=='success')throw Error(result.message||'Connection failed');}catch(error){notice.textContent=error.message;showToast('failure',error.message);}finally{connecting=false;button.disabled=NativeRfid.currentState.connected;refresh();}};
 async function readSelected(target){const epc=typeof target==='string'?target:document.getElementById('epc').value;if(document.hidden||!epc||epc===lastBankEpc||bankReading||!NativeRfid.currentState.connected||epc===lastBankAttemptEpc&&Date.now()-lastBankAttempt<10000)return;bankReading=true;lastBankAttempt=Date.now();lastBankAttemptEpc=epc;try{const result=await NativeRfid.command('banks',{epc,accessPassword:document.getElementById('accessPassword').value});if(result.status!=='success')throw Error(result.message||'Memory read failed');lastBankEpc=Object.values(result.readableErrors||{}).some(message=>!/No readable memory found|memory overrun|locked|access denied/i.test(message))?'':epc;await pollLive();update();const drawer=document.getElementById('tagDrawer');if(drawer.open&&drawer.dataset.epc===epc){const data=await(await fetch('/api/events')).json();const event=data.events.find(event=>event.payload.some(record=>record.data.idHex===epc));if(event)document.getElementById('tagDrawerContent').replaceChildren(memorySummary(event.payload,epc,1,event.receivedAt));}}catch(error){showToast('warning',error.message);}finally{bankReading=false;}}
 window.addEventListener('memoryinvalidated',()=>{lastBankEpc='';lastBankAttempt=0;lastBankAttemptEpc='';pollLive();updateTagDetails(tagChoices.get(document.getElementById('epc').value)||null);update();});
 document.getElementById('accessPassword').addEventListener('change',()=>NativeRfid.invalidateBanks(document.getElementById('epc').value));
 window.addEventListener('tagdetails',event=>{document.getElementById('tagDrawer').dataset.epc=event.detail.epc;readSelected(event.detail.epc);});
 document.getElementById('epc').addEventListener('change',readSelected);setInterval(readSelected,1500);
 document.getElementById('below').textContent='On-device SDK · Read-back verification';
 const info=document.createElement('p');info.className='mobileHint';info.textContent='Use the trigger to scan. Select a tag once, enter data, then write and verify.';document.querySelector('.heading').append(info);
 document.getElementById('readerPower').setAttribute('aria-label','Antenna transmit power in dBm');
 button.click();
})();
