import {test} from 'node:test';

import assert from 'node:assert/strict';

import {readFileSync} from 'node:fs';

import {createRequire} from 'node:module';

// A fresh Git worktree can use the already-installed project dependencies.

let require=createRequire(import.meta.url),JSDOM,VirtualConsole;

try{({JSDOM,VirtualConsole}=require('jsdom'));}

catch{require=createRequire(new URL('../../rfid-read-write-tag/package.json',import.meta.url));({JSDOM,VirtualConsole}=require('jsdom'));}

const assets=new URL('../android-mc3390r/app/src/main/assets/',import.meta.url);

const asset=name=>readFileSync(new URL(name,assets),'utf8');

const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};

const epc='E2806F12000000022DF13118';

const secondEpc='E28069150000401ECAB4A8D5';

async function setup({ui=false,connected=false,reading=false,powerDbm=25}={}){

 const commands=[],errors=[],timeouts=new Map(),intervals=new Map();let nextTimer=0,elapsed=0;

 const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error));

 const html=ui?asset('index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''):'<!doctype html><html><body></body></html>';

 const dom=new JSDOM(html,{url:'https://local.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});

 const w=dom.window;

 w.setTimeout=(fn,delay=0)=>{const id=++nextTimer;timeouts.set(id,{fn,delay});return id;};w.clearTimeout=id=>timeouts.delete(id);

 w.setInterval=(fn,delay=0)=>{const id=++nextTimer;intervals.set(id,{fn,delay});return id;};w.clearInterval=id=>intervals.delete(id);

 Object.defineProperty(w.performance,'now',{value:()=>elapsed});

 w.HTMLElement.prototype.scrollIntoView=function(){};

 w.AndroidRfid={command(id,operation,json){commands.push({id,operation,body:JSON.parse(json)});if(operation==='connect')Promise.resolve().then(()=>{if(connected)w.NativeRfid.state({connected:true,reading,powerDbm,minDbm:5,maxDbm:30,message:'Connected'});w.NativeRfid.reply(id,{status:connected?'success':'failed',message:connected?'Connected':'Reader unavailable'});});}};

 w.eval(asset('native.js'));

 if(connected)w.NativeRfid.state({connected:true,reading,powerDbm,minDbm:5,maxDbm:30});

 if(ui){w.eval(asset('app.js'));w.eval(asset('mobile.js'));}

 await flush();

 return {dom,w,doc:w.document,commands,errors,timeouts,async delay(ms){elapsed+=ms;const ready=[...timeouts].filter(([,timer])=>timer.delay===ms);for(const [id,timer]of ready){timeouts.delete(id);timer.fn();}await flush();},async tick(ms){for(const timer of intervals.values())if(timer.delay===ms)timer.fn();await flush();},async scan(tags=[{epc,rssi:-40}]){w.NativeRfid.tags(tags);if(ui)await w.pollLive();await flush();},last(operation){return commands.filter(c=>c.operation===operation).at(-1);},reply(operation,result){const command=commands.filter(c=>c.operation===operation).at(-1);assert.ok(command,'Expected '+operation+' command');w.NativeRfid.reply(command.id,result);return command;},close(){timeouts.clear();intervals.clear();dom.window.close();}};

}

const post=(w,path,body)=>w.fetch(path,{method:'POST',body:JSON.stringify(body)});

const result=(w,id)=>w.fetch('/api/write/result?requestId='+id).then(r=>r.json());

function choose(a,target=epc){const card=a.doc.querySelector('.eventcard[data-epc="'+target+'"] > summary');assert.ok(card,'Expected detected card');card.click();a.doc.getElementById('clearData').click();a.doc.querySelector('[name=format][value=ASCII]').checked=true;a.doc.querySelector('[name=format][value=ASCII]').dispatchEvent(new a.w.Event('change'));}

function input(a,text){const node=a.doc.getElementById('data');node.value=text;node.dispatchEvent(new a.w.Event('input'));}

async function readBanks(a,banks){await a.tick(1500);a.reply('banks',{status:'success',banks});await flush();await a.w.pollLive();await flush();}

function bank(a,value){const node=a.doc.getElementById('memoryBank');node.value=value;node.dispatchEvent(new a.w.Event('change'));}

test('offline transport rejects writes and controls without a reader connection',async()=>{

 const a=await setup();try{

  for(const [path,body]of [['/api/write',{requestId:'disconnected-write',epc}],['/api/reader/control',{requestId:'disconnected-reading',enabled:true}],['/api/reader/power',{requestId:'disconnected-power',powerDbm:15}]]){

   const response=await post(a.w,path,body);assert.equal(response.status,503);assert.match((await response.json()).error,/disconnected/);

  }

  assert.equal(a.commands.length,0);assert.equal((await(await a.w.fetch('/api/write/config')).json()).available,false);

  assert.equal((await a.w.fetch('https://external.example/api')).status,404);

 }finally{a.close();}

});

test('inventory normalizes EPC but never invents USER, TID or RESERVED contents',async()=>{

 const a=await setup({connected:true});try{

  await a.scan([{epc:epc.toLowerCase(),rssi:-47},{epc:'NOT-HEX',rssi:-20}]);

  const payload=await(await a.w.fetch('/api/events')).json();assert.equal(payload.events.length,1);

  const record=payload.events[0].payload[0].data;assert.equal(record.idHex,epc);assert.equal(record.peakRssi,-47);

  for(const name of ['USER','TID','RESERVED'])assert.equal(Object.hasOwn(record,name),false);

  const p=a.w.NativeRfid.command('banks',{epc});a.reply('banks',{status:'success',banks:{USER:'4142',TID:'Error: read only'}});await p;

  const bankPayload=await(await a.w.fetch('/api/events/live?after=1')).json();assert.equal(bankPayload.events[0].payload[0].data.USER,'4142');assert.equal(bankPayload.events[0].payload[0].data.TID,'Error: read only');

 }finally{a.close();}

});

test('queued writes remain running until native confirmation and deduplicate request IDs',async()=>{

 const a=await setup({connected:true});try{

  const body={requestId:'native-write-1234',epc,memoryBank:'USER',offsetBytes:0,lengthBytes:1,dataHex:'41'};

  assert.equal((await post(a.w,'/api/write',body)).status,202);assert.equal((await result(a.w,body.requestId)).status,'running');

  await post(a.w,'/api/write',body);assert.equal(a.commands.filter(c=>c.operation==='write').length,1);

  assert.deepEqual(a.last('write').body,body);a.reply('write',{status:'success',verified:true,durationMs:145});await flush();

  const confirmed=await result(a.w,body.requestId);assert.equal(confirmed.status,'success');assert.equal(confirmed.verified,true);assert.equal(confirmed.epc,epc);assert.equal(confirmed.durationMs,145);

 }finally{a.close();}

});

test('native write timeout returns an unconfirmed result, never a fabricated success',async()=>{

 const a=await setup({connected:true});try{

  const id='native-timeout-1234';await post(a.w,'/api/write',{requestId:id,epc});await a.delay(120000);

  const value=await result(a.w,id);assert.equal(value.status,'unknown');assert.equal(value.verified,false);assert.match(value.message,/timed out/);

 }finally{a.close();}

});

test('mobile UI has one selection point and bank writes stay blocked until memory is read',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan([{epc,rssi:-40},{epc:secondEpc,rssi:-50}]);choose(a);assert.equal(a.doc.getElementById('epc').value,epc);assert.equal(a.doc.getElementById('epc').hidden,true);assert.equal(a.doc.querySelector('label[for=epc]'),null);

  assert.equal(a.doc.querySelector('.panel.editor').hidden,false);bank(a,'USER');input(a,'A');assert.equal(a.doc.getElementById('write').disabled,true);assert.match(a.doc.getElementById('error').textContent,/Unknown size for USER/);

  await readBanks(a,{USER:'00'.repeat(8)});input(a,'ABC');assert.equal(a.doc.getElementById('write').disabled,false);assert.match(a.doc.getElementById('count').textContent,/3 \/ 8 bytes/);

  assert.equal(a.doc.querySelector('#epc').value,epc);assert.equal(a.errors.length,0, a.errors.map(e=>e.message).join("; "));

 }finally{a.close();}

});

test('mobile write sends exact original target and shows verified SDK time only after confirmation',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);bank(a,'USER');await readBanks(a,{USER:'00'.repeat(8)});input(a,'ABC');

  const pending=a.doc.getElementById('writer').onsubmit(new a.w.Event('submit',{cancelable:true}));await flush();

  const command=a.last('write');assert.equal(command.body.epc,epc);assert.equal(command.body.dataHex,'414243'+'00'.repeat(5));assert.equal(command.body.lengthBytes,8);assert.equal(command.body.offsetBytes,0);

  assert.match(a.doc.getElementById('result').textContent,/Waiting for write confirmation/);assert.equal(a.doc.getElementById('result').classList.contains('success'),false);

  a.reply('write',{status:'success',verified:true,durationMs:182.6});await a.delay(600);await pending;

  assert.match(a.doc.getElementById('result').textContent,/Write successful/);assert.match(a.doc.getElementById('result').textContent,/Reader operation: 183 ms/);assert.match(a.doc.getElementById('result').textContent,/Total elapsed: 600 ms/);assert.equal(a.doc.getElementById('epc').value,epc);

 }finally{a.close();}

});

test('an SDK success without read-back verification does not show a successful write',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);input(a,'ABC');const pending=a.doc.getElementById('writer').onsubmit(new a.w.Event('submit',{cancelable:true}));await flush();

  a.reply('write',{status:'success',verified:false,message:'Read-back failed'});await a.delay(600);await pending;

  assert.equal(a.doc.getElementById('result').classList.contains('success'),false);assert.match(a.doc.getElementById('result').textContent,/Write could not be confirmed/);assert.equal(a.doc.getElementById('toast').classList.contains('success'),false);

 }finally{a.close();}

});

test('SDK read-only bank errors are shown as failures and do not replace the target',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await readBanks(a,{TID:'00'.repeat(12)});bank(a,'TID');input(a,'AB');a.doc.getElementById('confirmSensitive').checked=true;a.doc.getElementById('confirmSensitive').dispatchEvent(new a.w.Event('change'));

  const pending=a.doc.getElementById('writer').onsubmit(new a.w.Event('submit',{cancelable:true}));await flush();

  a.reply('write',{status:'failed',verified:false,message:'TID memory is read-only on this tag',durationMs:19});await a.delay(600);await pending;

  assert.match(a.doc.getElementById('result').textContent,/Write failed/);assert.match(a.doc.getElementById('result').textContent,/read-only/);assert.equal(a.doc.getElementById('epc').value,epc);assert.equal(a.doc.getElementById('result').classList.contains('success'),false);

 }finally{a.close();}

});

test('power drag submits once on release and only becomes confirmed after native read-back',async()=>{

 const a=await setup({ui:true,connected:true});try{

  const slider=a.doc.getElementById('readerPower');assert.equal(slider.disabled,false);assert.equal(slider.min,'5');assert.equal(slider.max,'30');

  for(const value of [15,17,20]){slider.value=value;slider.dispatchEvent(new a.w.Event('input'));}assert.equal(a.commands.filter(c=>c.operation==='power').length,0);assert.match(a.doc.getElementById('powerFeedback').textContent,/Release to apply/);

  slider.dispatchEvent(new a.w.Event('change'));await flush();assert.equal(a.commands.filter(c=>c.operation==='power').length,1);assert.equal(a.last('power').body.powerDbm,20);assert.equal(slider.disabled,true);assert.match(a.doc.getElementById('powerFeedback').textContent,/Applying/);

  const progress=a.doc.getElementById('powerSettingDialog');assert.equal(progress.open,true);assert.equal(a.w.NativeRfid.back(),true);assert.equal(progress.open,true);const cancel=new a.w.Event('cancel',{cancelable:true});progress.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);await a.delay(500);assert.equal(progress.open,true);a.w.NativeRfid.state({powerDbm:20});a.reply('power',{status:'success',verified:true,powerDbm:20});await a.delay(500);

  assert.equal(slider.disabled,false);assert.equal(slider.value,'20');assert.equal(progress.open,false);assert.equal(a.w.powerUiLocked,false);assert.match(a.doc.getElementById('powerFeedback').textContent,/Confirmed by reader/);assert.equal(a.doc.getElementById('toast').classList.contains('success'),true);

 }finally{a.close();}

});

test('MC3390R uses native trigger state without a reading switch',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  assert.equal(a.doc.getElementById('readingToggle'),null);

  assert.equal(a.doc.querySelector('.readingControl'),null);

  assert.equal(a.commands.filter(c=>c.operation==='reading').length,0);

  a.w.NativeRfid.state({reading:false});await flush();

  assert.equal(a.w.NativeRfid.currentState.reading,false);

  a.w.NativeRfid.state({connected:false,message:'Reader disconnected'});await flush();

  assert.equal(a.doc.getElementById('readerPower').disabled,true);

  assert.equal(a.doc.getElementById('write').disabled,true);

  assert.equal(a.doc.getElementById('readerStatus'),null);

 }finally{a.close();}

});

test('an unconfirmed power change restores the actual device value instead of retaining the drag preview',async()=>{

 const a=await setup({ui:true,connected:true,powerDbm:25});try{

  const slider=a.doc.getElementById('readerPower');slider.value='10';slider.dispatchEvent(new a.w.Event('input'));slider.dispatchEvent(new a.w.Event('change'));await flush();

  a.reply('power',{status:'unknown',verified:false,message:'SDK power read-back failed'});await a.delay(500);

  assert.equal(a.doc.getElementById('powerSettingDialog').open,false);assert.equal(a.w.powerUiLocked,false);assert.equal(slider.value,'25');assert.equal(slider.disabled,false);assert.match(a.doc.getElementById('powerValue').textContent,/25 dBm/);assert.equal(a.doc.getElementById('toast').classList.contains('failure'),true);assert.match(a.doc.getElementById('toast').textContent,/SDK power read-back failed/);

 }finally{a.close();}

});

test('HEX mode filters non-base-16 text, blocks incomplete byte pairs and counts whitespace correctly',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);bank(a,'USER');await readBanks(a,{USER:'00'.repeat(8)});

  const hex=a.doc.querySelector('[name=format][value=HEX]');hex.checked=true;hex.dispatchEvent(new a.w.Event('change'));

  input(a,'GG12');assert.equal(a.doc.getElementById('data').value,'12');assert.equal(a.doc.getElementById('write').disabled,false);

  input(a,'1');assert.equal(a.doc.getElementById('write').disabled,true);assert.match(a.doc.getElementById('error').textContent,/HEX/);

  input(a,'41 42 43');assert.equal(a.doc.getElementById('write').disabled,false);assert.match(a.doc.getElementById('count').textContent,/3 \/ 8 bytes/);

 }finally{a.close();}

});

test('power slider follows the SDK capability list including fractional dBm steps',async()=>{

 const a=await setup({ui:true,connected:true,powerDbm:25});try{

  a.w.NativeRfid.state({powerDbm:5.25,minDbm:5,maxDbm:5.5,powerLevels:[5,5.25,5.5]});await flush();

  const state=await(await a.w.fetch('/api/reader/power')).json();assert.equal(state.step,0.25);

  const slider=a.doc.getElementById('readerPower');assert.equal(slider.min,'5');assert.equal(slider.max,'5.5');assert.equal(slider.step,'0.25');assert.equal(slider.value,'5.25');

  slider.value='5.5';slider.dispatchEvent(new a.w.Event('input'));slider.dispatchEvent(new a.w.Event('change'));await flush();assert.equal(a.last('power').body.powerDbm,5.5);

  a.w.NativeRfid.state({powerDbm:5.5});a.reply('power',{status:'success',verified:true,powerDbm:5.5});await a.delay(500);assert.equal(slider.value,'5.5');assert.match(a.doc.getElementById('powerValue').textContent,/5\.5 dBm/);

 }finally{a.close();}

});

test('Android Back closes an open tag drawer or filter before leaving the app',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);assert.equal(a.doc.getElementById('writeTagDialog').open,true);assert.equal(a.w.NativeRfid.back(),true);assert.equal(a.doc.getElementById('writeTagDialog').open,false);

  a.doc.getElementById('openTagFilter').click();assert.equal(a.doc.getElementById('tagFilterDialog').open,true);assert.equal(a.w.NativeRfid.back(),true);assert.equal(a.doc.getElementById('tagFilterDialog').open,false);assert.equal(a.w.NativeRfid.back(),false);

 }finally{a.close();}

});

test('SDK bank-read errors remain visible and do not imply a writable capacity',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await a.tick(1500);a.reply('banks',{status:'success',banks:{EPC:'00003000'+epc},readableErrors:{USER:'Error: insufficient RF power',TID:'Error: password rejected'}});await flush();await a.w.pollLive();await flush();

  bank(a,'USER');input(a,'ABC');assert.equal(a.doc.getElementById('write').disabled,true);a.doc.getElementById('openTagInfo').click();assert.match(a.doc.querySelector('#tagDetails [data-memory="USER"]').textContent,/insufficient RF power/);assert.match(a.doc.getElementById('error').textContent,/Unknown size for USER/);

 }finally{a.close();}

});

test('a failed memory read retries after backoff instead of permanently caching the failed selection',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await a.tick(1500);const first=a.last('banks');a.reply('banks',{status:'failed',message:'Tag moved out of range'});await flush();

  await a.tick(1500);assert.equal(a.commands.filter(c=>c.operation==='banks').length,1);

  const now=a.w.Date.now();a.w.Date.now=()=>now+11000;await a.tick(1500);assert.equal(a.commands.filter(c=>c.operation==='banks').length,2);assert.notEqual(a.last('banks').id,first.id);

  a.reply('banks',{status:'success',banks:{USER:'0000'}});await flush();

 }finally{a.close();}

});

test('every completed write clears old memory observations for its target, including uncertain writes',async()=>{

 for(const status of ['success','failed','unknown']){

  const a=await setup({connected:true});try{

   for(const target of [epc,secondEpc]){const read=a.w.NativeRfid.command('banks',{epc:target});a.reply('banks',{status:'success',banks:{USER:'41424344',TID:'01020304',RESERVED:'00000000'}});await read;}

   const body={requestId:'invalidate-write-'+status,epc,memoryBank:'USER',offsetBytes:0,lengthBytes:2,dataHex:'4546'};await post(a.w,'/api/write',body);a.reply('write',{status,verified:status==='success'});await flush();

   const events=(await(await a.w.fetch('/api/events')).json()).events;

   for(const event of events)for(const record of event.payload)if(record.data.idHex===epc)for(const bankName of ['EPC','USER','TID','RESERVED'])assert.equal(Object.hasOwn(record.data,bankName),false,status+' must not retain '+bankName);

   assert.equal(events.find(e=>e.payload[0].data.idHex===secondEpc).payload[0].data.USER,'41424344');

   await a.scan();const latest=(await(await a.w.fetch('/api/events')).json()).events[0].payload[0].data;assert.equal(Object.hasOwn(latest,'USER'),false,'New inventory cannot merge pre-write memory');

  }finally{a.close();}

 }

});

test('verified USER writes trigger a fresh memory read before the UI reuses bank data',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);bank(a,'USER');await readBanks(a,{USER:'00'.repeat(8)});input(a,'ABC');

  const pending=a.doc.getElementById('writer').onsubmit(new a.w.Event('submit',{cancelable:true}));await flush();a.reply('write',{status:'success',verified:true,durationMs:17});await a.delay(600);await pending;

  assert.equal(a.doc.getElementById('write').disabled,true);assert.match(a.doc.getElementById('error').textContent,/Unknown size for USER/);

  await a.tick(1500);assert.equal(a.commands.filter(c=>c.operation==='banks').length,2);assert.equal(a.last('banks').body.epc,epc);

  a.reply('banks',{status:'success',banks:{USER:'414243'+'00'.repeat(5)}});await flush();await a.w.pollLive();await flush();

  a.doc.getElementById('openTagInfo').click();assert.match(a.doc.querySelector('#tagDetails [data-memory="USER"]').textContent,/ABC/);assert.equal(a.doc.getElementById('write').disabled,false);

 }finally{a.close();}

});

test('disconnect drops cached memory for all tags and reconnect rereads the current target',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await readBanks(a,{USER:'41424344'});assert.equal(a.doc.getElementById('connectReader').hidden,true);

  a.w.NativeRfid.state({connected:false,reading:false,message:'Connection lost'});await flush();assert.equal(a.doc.getElementById('connectReader').hidden,false);assert.equal(a.doc.getElementById('write').disabled,true);

  const events=(await(await a.w.fetch('/api/events')).json()).events;for(const event of events)for(const record of event.payload)assert.equal(Object.hasOwn(record.data,'USER'),false);

  a.w.NativeRfid.state({connected:true,reading:false,message:'Connected'});await flush();await a.tick(1500);assert.equal(a.commands.filter(c=>c.operation==='banks').length,2);assert.equal(a.last('banks').body.epc,epc);assert.equal(a.doc.getElementById('connectReader').hidden,true);

  a.reply('banks',{status:'success',banks:{USER:'45464748'}});await flush();await a.w.pollLive();await flush();a.doc.getElementById('openTagInfo').click();assert.match(a.doc.querySelector('#tagDetails [data-memory="USER"]').textContent,/EFGH/);

 }finally{a.close();}

});

test('changing the access password invalidates old memory and uses the new password for rereading',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await readBanks(a,{USER:'00000000'});const password=a.doc.getElementById('accessPassword');password.value='1234ABCD';password.dispatchEvent(new a.w.Event('change'));await flush();await a.tick(1500);

  assert.equal(a.commands.filter(c=>c.operation==='banks').length,2);assert.equal(a.last('banks').body.accessPassword,'1234ABCD');assert.equal(a.last('banks').body.epc,epc);

  a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();

 }finally{a.close();}

});

test('pausing connected inventory keeps the selected write form beyond tag-list expiry',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);input(a,'ABC');a.w.NativeRfid.state({reading:false});await flush();

  const now=a.w.Date.now();a.w.Date.now=()=>now+6000;await a.tick(500);

  assert.equal(a.doc.querySelectorAll('.eventcard').length,1);assert.equal(a.doc.querySelector('.selectionPanel').hidden,true);assert.equal(a.doc.querySelector('.panel.editor').hidden,false);assert.equal(a.doc.getElementById('epc').value,epc);assert.equal(a.doc.getElementById('write').disabled,false);

  a.w.NativeRfid.state({connected:false,reading:false,message:'Disconnected'});await flush();assert.equal(a.doc.querySelector('.panel.editor').hidden,true);assert.equal(a.doc.getElementById('write').disabled,true);

 }finally{a.close();}

});

test('Text EPC names round-trip through HEX without changing the complete padded write payload',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);input(a,'TEST006');

  const pick=body=>({epc:body.epc,bank:body.memoryBank,offset:body.offsetBytes,length:body.lengthBytes,hex:body.dataHex});

  const original=pick(a.w.payload());assert.deepEqual(original,{epc,bank:'EPC',offset:4,length:12,hex:'000000000054455354303036'});

  const hex=a.doc.querySelector('[name=format][value=HEX]'),text=a.doc.querySelector('[name=format][value=ASCII]');hex.checked=true;hex.dispatchEvent(new a.w.Event('change'));

  assert.equal(a.doc.getElementById('data').value,original.hex);assert.equal(a.doc.getElementById('length').value,'12');assert.equal(a.doc.getElementById('write').disabled,false);assert.deepEqual(pick(a.w.payload()),original);

  text.checked=true;text.dispatchEvent(new a.w.Event('change'));assert.equal(a.doc.getElementById('data').value,'TEST006');assert.equal(a.doc.getElementById('write').disabled,false);assert.deepEqual(pick(a.w.payload()),original);

 }finally{a.close();}

});

test('EPC format conversion keeps HEX for embedded nonprintable data and does not strip USER zero bytes',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);const hex=a.doc.querySelector('[name=format][value=HEX]'),text=a.doc.querySelector('[name=format][value=ASCII]');hex.checked=true;hex.dispatchEvent(new a.w.Event('change'));

  input(a,'000000000054455354003036');text.checked=true;text.dispatchEvent(new a.w.Event('change'));assert.equal(hex.checked,true);assert.equal(a.doc.getElementById('data').value,'000000000054455354003036');assert.match(a.doc.getElementById('error').textContent,/non-printable/);

  input(a,'00'.repeat(12));text.checked=true;text.dispatchEvent(new a.w.Event('change'));assert.equal(hex.checked,true);assert.equal(a.doc.getElementById('data').value,'00'.repeat(12));assert.match(a.doc.getElementById('error').textContent,/no printable EPC text/);

  await readBanks(a,{USER:'00'.repeat(8)});bank(a,'USER');hex.checked=true;hex.dispatchEvent(new a.w.Event('change'));input(a,'004142');text.checked=true;text.dispatchEvent(new a.w.Event('change'));assert.equal(hex.checked,true);assert.equal(a.doc.getElementById('data').value,'004142');assert.match(a.doc.getElementById('error').textContent,/non-printable/);

 }finally{a.close();}

});

test('partial bank reads expose TID and other actual data and retry missing banks',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await a.tick(1500);

  a.reply('banks',{status:'success',banks:{EPC:'3000'+epc,TID:'E2801191A5030069565F9436',RESERVED:'0000000000000000'},readableErrors:{USER:'Reader error: Operation In Progress'}});

  await flush();await a.w.pollLive();

  a.doc.getElementById('openTagInfo').click();const text=a.doc.getElementById('tagDetails').textContent;

  assert.match(text,/E2801191A5030069565F9436/);assert.match(text,/0000000000000000/);assert.match(text,/Operation In Progress/);

  const previous=a.commands.filter(c=>c.operation==='banks').length;

  await a.tick(1500);assert.equal(a.commands.filter(c=>c.operation==='banks').length,previous);

  const now=a.w.Date.now();a.w.Date.now=()=>now+11000;await a.tick(1500);assert.equal(a.commands.filter(c=>c.operation==='banks').length,previous+1);

 }finally{a.close();}

});

test('inventory preserves SDK signal metadata and Details reads banks without changing selection',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan([{epc,rssi:-42,antenna:2,pc:12288,crc:123,seenCount:7},{epc:secondEpc,rssi:-50}]);

  const data=await(await a.w.fetch('/api/events')).json();assert.equal(data.events[0].payload[0].data.antenna,2);assert.equal(data.events[0].payload[0].data.PC,12288);assert.equal(data.events[0].payload[0].data.CRC,123);

  const selected=a.doc.getElementById('epc').value;

  choose(a,secondEpc);await flush();

  assert.equal(a.last('banks').body.epc,secondEpc);assert.equal(a.doc.getElementById('epc').value,secondEpc);

  a.reply('banks',{status:'success',banks:{TID:'E28012345678',RESERVED:'0000000000000000'}});await flush();

  assert.match(a.doc.getElementById('tagDetails').textContent,/E28012345678/);

 }finally{a.close();}

});

test('memory reads do not refresh the last inventory timestamp or count as scans',async()=>{

 const a=await setup({connected:true});try{

  await a.scan();const before=(await(await a.w.fetch('/api/events')).json()).events[0];

  const pending=a.w.NativeRfid.command('banks',{epc});a.reply('banks',{status:'success',banks:{TID:'E2801234'}});await pending;

  const after=(await(await a.w.fetch('/api/events')).json()).events[0];

  assert.equal(after.receivedAt,before.receivedAt);assert.equal(after.payload[0].type,'MEMORY_READ');assert.equal(after.payload[0].data.TID,'E2801234');

 }finally{a.close();}

});

for(const memoryBank of ['EPC','USER','TID','RESERVED']){

 test(memoryBank+' write preserves bank, target, password and unconfirmed hardware errors',async()=>{

  const a=await setup({connected:true});try{

   const body={requestId:'bank-write-'+memoryBank,operation:'write',epc,memoryBank,offsetBytes:memoryBank==='EPC'?4:0,lengthBytes:3,dataHex:'414243',accessPassword:'FFFFFFFF',confirmSensitive:true};

   await post(a.w,'/api/write',body);assert.deepEqual(JSON.parse(JSON.stringify(a.last('write').body)),body);

   a.reply('write',{status:'unknown',verified:false,message:'Write failed: access locked'});await flush();

   const r=await result(a.w,body.requestId);assert.equal(r.status,'unknown');assert.equal(r.verified,false);assert.equal(r.epc,epc);assert.match(r.message,/locked/);

   await post(a.w,'/api/write',body);assert.equal(a.commands.filter(c=>c.operation==='write').length,1);

  }finally{a.close();}

 });

}

test('sensitive writes require explicit confirmation and remain blocked on invalid passwords',async()=>{

 const a=await setup({ui:true,connected:true});try{

  await a.scan();choose(a);await readBanks(a,{TID:'E280123456789012',RESERVED:'0000000000000000'});

  for(const name of ['TID','RESERVED']){

   bank(a,name);input(a,'AB');assert.equal(a.doc.getElementById('write').disabled,true);

   const confirm=a.doc.getElementById('confirmSensitive');confirm.checked=true;confirm.dispatchEvent(new a.w.Event('change'));

   assert.equal(a.doc.getElementById('write').disabled,false);

   const password=a.doc.getElementById('accessPassword');password.value='XYZ';password.dispatchEvent(new a.w.Event('input'));assert.equal(a.doc.getElementById('write').disabled,true);

   password.value='';password.dispatchEvent(new a.w.Event('input'));confirm.checked=false;confirm.dispatchEvent(new a.w.Event('change'));

  }

 }finally{a.close();}

});

test('continuous trigger reading never starts memory access; release services the pending details',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  await a.scan();choose(a);choose(a);

  for(let i=0;i<30;i++)await a.tick(1500);

  assert.equal(a.commands.filter(c=>c.operation==='banks').length,0);

  a.w.NativeRfid.state({connected:true,reading:false});await flush();

  assert.equal(a.commands.filter(c=>c.operation==='banks').length,1);assert.equal(a.last('banks').body.epc,epc);

  a.reply('banks',{status:'success',banks:{TID:'E2801234',USER:'4142'}});await flush();

  assert.match(a.doc.getElementById('tagDetails').textContent,/E2801234/);

 }finally{a.close();}

});

test('100000 rapid reports retain totals beyond the event history limit without fabricating memory reads',async()=>{

 const a=await setup({connected:true,reading:true});try{

  for(let i=0;i<100000;i++)a.w.NativeRfid.tags([{epc,seenCount:3,reportCount:1}]);

  assert.equal(a.w.NativeRfid.scanStats.totalReads,300000);assert.equal(a.w.NativeRfid.scanStats.totalReports,100000);

  const events=(await(await a.w.fetch('/api/events')).json()).events;

  assert.ok(events.length<=100);assert.equal(events[0].payload[0].data.totalReads,300000);

  const pending=a.w.NativeRfid.command('banks',{epc});a.reply('banks',{status:'success',banks:{USER:'4142'}});await pending;

  assert.equal(a.w.NativeRfid.scanStats.totalReads,300000);assert.equal(a.w.NativeRfid.scanStats.totalReports,100000);

 }finally{a.close();}

});



test('rapid UI updates reuse tag cards and lazily build details with exact read counts',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  await a.scan([{epc,seenCount:2}]);const card=a.doc.querySelector('.eventcard');

  assert.equal(card.querySelectorAll('.memoryCard').length,0);

  for(let i=0;i<1000;i++)a.w.NativeRfid.tags([{epc,seenCount:4,reportCount:2}]);

  await a.w.pollLive();assert.equal(a.doc.querySelector('.eventcard'),card);assert.match(card.textContent,/4002 times/);

  assert.match(a.doc.getElementById('feedStatus').textContent,/4002 total reads/);

  assert.equal(a.commands.filter(c=>c.operation==='banks').length,0);

  choose(a);assert.equal(a.doc.querySelectorAll('#tagDetails .memoryCard').length,4);

 }finally{a.close();}

});


test('tag list ranks the most repeatedly read tag above a more recent tag',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  await a.scan([{epc,seenCount:20}]);await a.scan([{epc:secondEpc,seenCount:2}]);

  assert.equal(a.doc.querySelector('.eventcard').dataset.epc,epc);

  await a.scan([{epc:secondEpc,seenCount:30}]);

  assert.equal(a.doc.querySelector('.eventcard').dataset.epc,secondEpc);

 }finally{a.close();}

});

test('Data focus switches trigger to barcode, inserts scan data and blur restores RFID',async()=>{

 const a=await setup({ui:true,connected:true});try{

  const data=a.doc.getElementById('data');data.focus();await flush();

  assert.deepEqual(a.last('scannerMode').body,{mode:'barcode'});

  a.reply('scannerMode',{status:'success',scannerMode:'barcode'});await flush();

  a.w.NativeRfid.barcode('BOX006');assert.equal(data.value,'BOX006');

  data.blur();await flush();assert.equal(a.last('scannerMode').body.mode,'rfid');

  a.reply('scannerMode',{status:'success',scannerMode:'rfid'});await flush();

  a.w.NativeRfid.barcode('IGNORED');assert.equal(data.value,'BOX006');

 }finally{a.close();}

});

test('detected tags survive age and event-buffer rollover beyond 50 tags',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  const tags=Array.from({length:80},(_,i)=>({epc:i.toString(16).padStart(24,'0').toUpperCase(),seenCount:1}));

  await a.scan(tags);const now=a.w.Date.now();a.w.Date.now=()=>now+60000;await a.tick(500);

  assert.equal(a.doc.querySelectorAll('.eventcard').length,80);

  for(let i=0;i<210;i++)a.w.NativeRfid.tags([{epc,seenCount:1}]);await a.w.pollLive();

  assert.equal(a.doc.querySelectorAll('.eventcard').length,81);

 }finally{a.close();}

});

test('failed barcode mode switches do not accept scans or report success',async()=>{

 const a=await setup({ui:true,connected:true});try{

  const data=a.doc.getElementById('data');data.focus();await flush();

  a.reply('scannerMode',{status:'failed',message:'Reader unavailable'});await flush();

  a.w.NativeRfid.barcode('BLOCKED');assert.equal(data.value,'');

  assert.match(a.doc.getElementById('toast').textContent,/Reader unavailable/);

 }finally{a.close();}

});

test('Filter stays hidden until tags are detected, independent of filter matches',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  for(const id of ['openTagFilter'])assert.equal(a.doc.getElementById(id).hidden,true);

  await a.scan();

  for(const id of ['openTagFilter'])assert.equal(a.doc.getElementById(id).hidden,false);

  const search=a.doc.getElementById('tagSearch');search.value='NO_MATCH';search.dispatchEvent(new a.w.Event('input'));

  for(const id of ['openTagFilter'])assert.equal(a.doc.getElementById(id).hidden,false);

 }finally{a.close();}

});

test('held trigger prevents memory timers even if SDK inventory state briefly stops',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  await a.scan();choose(a);a.w.NativeRfid.state({reading:false,triggerHeld:true});await a.tick(1500);

  assert.equal(a.commands.filter(c=>c.operation==='banks').length,0);

  a.w.NativeRfid.state({triggerHeld:false,reading:false});await flush();assert.equal(a.commands.filter(c=>c.operation==='banks').length,1);

 }finally{a.close();}

});

test('clicking a tag opens its write form in a modal and invalidates cached memory',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  await a.scan();choose(a);const modal=a.doc.getElementById('writeTagDialog');

  assert.equal(modal.open,true);assert.ok(modal.contains(a.doc.getElementById('writer')));

  assert.equal(a.doc.getElementById('epc').value,epc);

  modal.querySelector('[aria-label="Close write tag"]').click();assert.equal(modal.open,false);

 }finally{a.close();}

});

test('repeated scan releases never queue automatic memory reads unless a tag dialog is open',async()=>{

 const a=await setup({ui:true,connected:true,reading:true});try{

  await a.scan();

  for(let i=0;i<5;i++){a.w.NativeRfid.state({reading:false,triggerHeld:false});await a.tick(1500);a.w.NativeRfid.state({reading:true,triggerHeld:true});await flush();}

  assert.equal(a.commands.filter(c=>c.operation==='banks').length,0);

 }finally{a.close();}

});

test('Read more shows 10, 20, then all 25 tags with details inside the write modal',async()=>{
 const a=await setup({ui:true,connected:true,reading:true});try{
 await a.scan(Array.from({length:25},(_,i)=>({epc:i.toString(16).padStart(24,'0').toUpperCase(),seenCount:1})));
 const shown=()=>a.doc.querySelectorAll('.eventitem:not([hidden])').length;
 assert.equal(shown(),10);a.doc.getElementById('readMoreTags').click();assert.equal(shown(),20);a.doc.getElementById('readMoreTags').click();assert.equal(shown(),25);
 assert.equal(a.doc.getElementById('readMoreTags').hidden,true);assert.equal(a.doc.querySelectorAll('.tagDetailButton').length,0);
 a.doc.querySelector('.eventcard summary').click();const modal=a.doc.getElementById('writeTagDialog');assert.equal(modal.open,true);assert.ok(modal.contains(a.doc.getElementById('tagDetails')));assert.ok(modal.querySelector('svg'));
 }finally{a.close();}
});

test('modal tabs slide between details and writing while keeping the close header outside the scroller',async()=>{
 const a=await setup({ui:true,connected:true,reading:true});try{
 await a.scan();choose(a);const modal=a.doc.getElementById('writeTagDialog'),details=a.doc.getElementById('modalDetailsTab'),write=a.doc.getElementById('modalWriteTab');
 assert.equal(modal.dataset.view,'write');details.click();assert.equal(modal.dataset.view,'details');assert.equal(details.getAttribute('aria-selected'),'true');
 write.click();assert.equal(modal.dataset.view,'write');assert.equal(write.getAttribute('aria-selected'),'true');
 assert.ok(modal.querySelector('.modalHeader [aria-label="Close write tag"] svg'));assert.equal(modal.querySelector('.modalBody').contains(modal.querySelector('.modalHeader')),false);
 details.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(modal.dataset.view,'details');
 const start=new a.w.Event('touchstart');start.touches=[{clientX:20}];const end=new a.w.Event('touchend');end.changedTouches=[{clientX:100}];modal.querySelector('.modalTabs').dispatchEvent(start);modal.querySelector('.modalTabs').dispatchEvent(end);assert.equal(modal.dataset.view,'write');
 }finally{a.close();}
});

test('write locks close, tabs and Back until verification, then shows a central success badge',async()=>{
 const a=await setup({ui:true,connected:true});try{
 await a.scan();choose(a);input(a,'ABC');
 const pending=a.doc.getElementById('writer').onsubmit(new a.w.Event('submit',{cancelable:true}));await flush();
 const modal=a.doc.getElementById('writeTagDialog');assert.equal(a.w.writeUiLocked,true);assert.equal(modal.querySelector('.writeProgress').hidden,false);assert.match(modal.querySelector('.writeProgress').textContent,/Keep the tag close/);
 for(const node of modal.querySelectorAll('button,input,textarea,select'))assert.equal(node.disabled,true);
 modal.querySelector('[aria-label="Close write tag"]').click();a.w.NativeRfid.back();assert.equal(modal.open,true);
 a.doc.getElementById('modalDetailsTab').click();assert.equal(modal.dataset.view,'write');assert.equal(a.doc.getElementById('writeSuccessBadge').open,false);
 a.reply('write',{status:'success',verified:true});await a.delay(600);await pending;
 assert.equal(a.w.writeUiLocked,false);assert.equal(modal.querySelector('.writeProgress').hidden,true);assert.equal(a.doc.getElementById('writeSuccessBadge').open,true);
 assert.equal(a.doc.getElementById('modalDetailsTab').disabled,false);a.w.NativeRfid.back();assert.equal(a.doc.getElementById('writeSuccessBadge').open,false);assert.equal(modal.open,true);
 }finally{a.close();}
});
test('failed or unverified writes unlock controls without showing a success badge',async()=>{
 for(const status of ['failed','unknown']){
 const a=await setup({ui:true,connected:true});try{
 await a.scan();choose(a);input(a,'ABC');const pending=a.doc.getElementById('writer').onsubmit(new a.w.Event('submit',{cancelable:true}));await flush();
 a.reply('write',{status,verified:false,message:'Read-back failed'});await a.delay(600);await pending;
 assert.equal(a.w.writeUiLocked,false);assert.equal(a.doc.getElementById('writeSuccessBadge').open,false);assert.equal(a.doc.getElementById('modalDetailsTab').disabled,false);
 }finally{a.close();}
 }
});

test('range presets show capability-based dBm and use the confirmed power command',async()=>{const a=await setup({ui:true,connected:true});try{const buttons=[...a.doc.querySelectorAll('.powerPresets button')];assert.deepEqual(buttons.map(x=>x.dataset.dbm),['5','18','30']);assert.match(buttons[1].textContent,/Medium18 dBm/);buttons[0].click();await flush();assert.equal(a.last('power').body.powerDbm,5);assert.equal(a.doc.getElementById('powerSettingDialog').open,true);a.w.NativeRfid.state({powerDbm:5});a.reply('power',{status:'success',verified:true,powerDbm:5});await a.delay(500);assert.equal(a.doc.getElementById('powerSettingDialog').open,false);}finally{a.close();}});
test('existing USER text loads once, Clear keeps edits and a shorter write clears all old tail bytes',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan();choose(a);bank(a,'USER');await readBanks(a,{USER:'4F4C44444154410000'});assert.equal(a.doc.getElementById('data').value,'OLDDATA');a.doc.getElementById('clearData').click();assert.equal(a.doc.getElementById('data').value,'');a.w.loadExistingData();assert.equal(a.doc.getElementById('data').value,'');assert.equal(a.w.payload().dataHex,'00'.repeat(9));input(a,'NEW');const body=a.w.payload();assert.equal(body.dataHex,'4E4557'+'00'.repeat(6));assert.equal(body.lengthBytes,9);assert.equal(body.offsetBytes,0);}finally{a.close();}});
test('selected-tag reset reads capacity and verifies complete USER zeroing',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan();choose(a);const pending=a.doc.getElementById('resetSelectedTag').onclick();await flush();a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();assert.equal(a.last('write').body.dataHex,'00000000');a.reply('write',{status:'success',verified:true});await pending;assert.match(a.doc.getElementById('writeSuccessBadge').textContent,/Reset successful/);}finally{a.close();}});
