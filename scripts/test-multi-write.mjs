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

 if(ui){w.eval(asset('app.js')+'\n'+asset('batch-write.js')+'\n'+asset('modern.js'));w.eval(asset('mobile.js'));}

 await flush();

 return {dom,w,doc:w.document,commands,errors,timeouts,async delay(ms){elapsed+=ms;const ready=[...timeouts].filter(([,timer])=>timer.delay===ms);for(const [id,timer]of ready){timeouts.delete(id);timer.fn();}await flush();},async tick(ms){for(const timer of intervals.values())if(timer.delay===ms)timer.fn();await flush();},async scan(tags=[{epc,rssi:-40}]){w.NativeRfid.tags(tags);if(ui)await w.pollLive();await flush();},last(operation){return commands.filter(c=>c.operation===operation).at(-1);},reply(operation,result){const command=commands.filter(c=>c.operation===operation).at(-1);assert.ok(command,'Expected '+operation+' command');w.NativeRfid.reply(command.id,result);return command;},close(){timeouts.clear();intervals.clear();dom.window.close();}};

}


function open(a){a.doc.getElementById('writeTags').click();for(const check of a.doc.querySelectorAll('#multiWriteTags input'))check.checked=true;const data=a.doc.getElementById('multiWriteData');data.value='NEW';data.dispatchEvent(new a.w.Event('input'));}
test('batch write confirms two fresh capacities and clears every old tail byte',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);open(a);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();assert.equal(a.w.writeUiLocked,true);a.w.NativeRfid.back();assert.equal(a.doc.getElementById('multiWriteDialog').open,true);for(const [target,length] of [[epc,4],[secondEpc,8]]){assert.equal(a.last('banks').body.epc,target);a.reply('banks',{status:'success',banks:{USER:'41'.repeat(length)}});await flush();assert.equal(a.last('write').body.dataHex,'4E4557'+'00'.repeat(length-3));assert.equal(a.last('write').body.lengthBytes,length);a.reply('write',{status:'success',verified:true,durationMs:100});await flush();}await pending;assert.match(a.doc.getElementById('multiWriteResults').textContent,/2 \/ 2 tags verified/);assert.equal(a.w.writeUiLocked,false);a.w.NativeRfid.back();assert.equal(a.doc.getElementById('writeSuccessBadge').open,false);assert.equal(a.doc.getElementById('multiWriteDialog').open,true);}finally{a.close();}});
test('unreachable or too-small tags are not written',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);open(a);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();a.reply('banks',{status:'failed',message:'Not reachable'});await flush();a.reply('banks',{status:'success',banks:{USER:'4142'}});await pending;assert.equal(a.commands.filter(x=>x.operation==='write').length,0);assert.match(a.doc.getElementById('multiWriteResults').textContent,/0 \/ 2 tags verified/);}finally{a.close();}});
test('unconfirmed write stops batch without sending remaining targets',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);open(a);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();a.reply('write',{status:'unknown',verified:false,message:'Check tag'});await pending;assert.equal(a.commands.filter(x=>x.operation==='banks').length,1);assert.match(a.doc.getElementById('multiWriteResults').textContent,/Not attempted/);}finally{a.close();}});
test('sequence mode writes a different USER value to each tag, top to bottom',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);a.doc.getElementById('writeTags').click();for(const check of a.doc.querySelectorAll('#multiWriteTags input[type=checkbox]'))check.checked=true;a.doc.querySelector('[data-mode=sequence]').click();const values=[...a.doc.querySelectorAll('.multiWriteValue')].map(node=>node.value);assert.deepEqual(values,['1','2']);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();for(const [target,text] of [[epc,'31'],[secondEpc,'32']]){assert.equal(a.last('banks').body.epc,target);assert.deepEqual(a.last('banks').body.banks,['USER']);a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();assert.equal(a.last('write').body.memoryBank,'USER');assert.equal(a.last('write').body.dataHex,text+'000000');assert.equal(a.last('write').body.lengthBytes,4);a.reply('write',{status:'success',verified:true});await flush();}await pending;assert.match(a.doc.getElementById('multiWriteResults').textContent,/2 \/ 2 tags verified/);assert.match(a.doc.getElementById('multiWriteResults').textContent,/= 1/);assert.match(a.doc.getElementById('multiWriteResults').textContent,/= 2/);}finally{a.close();}});
test('sequence EPC writes are different, padded, and keep each previous EPC as the access id',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);a.doc.getElementById('writeTags').click();a.doc.getElementById('multiWriteDestination').value='EPC';a.doc.getElementById('multiWriteDestination').dispatchEvent(new a.w.Event('change'));for(const check of a.doc.querySelectorAll('#multiWriteTags input[type=checkbox]'))check.checked=true;a.doc.querySelector('[data-mode=sequence]').click();assert.deepEqual([...a.doc.querySelectorAll('.multiWriteValue')].map(node=>node.value),['1','2']);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();assert.equal(a.commands.filter(command=>command.operation==='banks').length,0);const first=a.last('write').body;assert.equal(first.memoryBank,'EPC');assert.equal(first.epc,epc);assert.equal(first.offsetBytes,4);assert.equal(first.lengthBytes,epc.length/2);assert.equal(first.beforeHex,epc);assert.equal(first.dataHex,'00'.repeat(epc.length/2-1)+'31');a.reply('write',{status:'success',verified:true,newEpc:first.dataHex});await flush();const second=a.last('write').body;assert.equal(second.epc,secondEpc);assert.equal(second.dataHex,'00'.repeat(secondEpc.length/2-1)+'32');assert.notEqual(first.dataHex,second.dataHex);a.reply('write',{status:'success',verified:true,newEpc:second.dataHex});await pending;assert.match(a.doc.getElementById('multiWriteResults').textContent,/2 \/ 2 tags verified/);}finally{a.close();}});
test('a busy reader is retried before the next tag is written',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);a.doc.getElementById('writeTags').click();for(const check of a.doc.querySelectorAll('#multiWriteTags input[type=checkbox]'))check.checked=true;a.doc.querySelector('[data-mode=sequence]').click();const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();a.reply('write',{status:'failed',verified:false,message:'Operation In Progress-Command Not Allowed'});await flush();await a.delay(400);assert.equal(a.last('write').body.epc,epc);a.reply('write',{status:'success',verified:true});await flush();assert.equal(a.last('banks').body.epc,secondEpc);a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();a.reply('write',{status:'success',verified:true});await pending;assert.equal(a.commands.filter(command=>command.operation==='write'&&command.body.epc===epc).length,2);assert.match(a.doc.getElementById('multiWriteResults').textContent,/2 \/ 2 tags verified/);}finally{a.close();}});
test('every button has an svg icon and visible text',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);a.doc.getElementById('writeTags').click();a.doc.getElementById('factoryReset').click();await a.flush?.();const buttons=[...a.doc.querySelectorAll('button')].filter(button=>!button.hidden&&!button.closest('[hidden]'));assert.ok(buttons.length>8);for(const button of buttons){assert.ok(button.querySelector('svg'),'Missing icon on '+(button.id||button.textContent));assert.ok(button.textContent.replace(/\s+/g,' ').trim().length>0,'Missing text on '+(button.id||button.outerHTML.slice(0,80)));}const close=a.doc.querySelector('#writeTagDialog [aria-label="Close write tag"]');assert.match(close.textContent,/Close/);assert.equal(close.querySelectorAll('svg').length,1);for(const id of ['closeTagFilter','closeTagInfo','closeTagDrawer']){const button=a.doc.getElementById(id);assert.equal(button.querySelectorAll('svg').length,1);assert.match(button.textContent,/Close/);assert.doesNotMatch(button.textContent,/×/);}assert.match(a.doc.getElementById('readerControlsToggle').textContent,/Controls/);}finally{a.close();}});
test('HEX filters invalid characters and rejects incomplete bytes; trigger prevents writing',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan();open(a);a.doc.querySelector('[data-encoding=HEX]').click();const data=a.doc.getElementById('multiWriteData');data.value='GG1';data.dispatchEvent(new a.w.Event('input'));assert.equal(data.value,'1');assert.equal(a.doc.getElementById('startMultiWrite').disabled,true);data.value='4142';data.dispatchEvent(new a.w.Event('input'));a.w.NativeRfid.state({triggerHeld:true});await a.doc.getElementById('startMultiWrite').onclick();assert.equal(a.commands.filter(x=>x.operation==='banks').length,0);assert.match(a.doc.getElementById('multiWriteError').textContent,/Release the trigger/);}finally{a.close();}});

test('all editable fields use Barcode and scans go only to the current cursor',async()=>{const a=await setup({ui:true,connected:true});try{const search=a.doc.getElementById('tagSearch'),password=a.doc.getElementById('multiWritePassword'),data=a.doc.getElementById('multiWriteData');search.focus();await flush();assert.equal(a.last('scannerMode').body.mode,'barcode');a.reply('scannerMode',{status:'success'});await flush();a.w.NativeRfid.barcode('BOX');assert.equal(search.value,'BOX');password.focus();await flush();assert.equal(a.commands.filter(x=>x.operation==='scannerMode').length,1);a.w.NativeRfid.barcode('12345678');assert.equal(password.value,'12345678');assert.equal(search.value,'BOX');data.focus();await flush();a.w.NativeRfid.barcode('NEW');assert.equal(data.value,'NEW');data.blur();await flush();assert.equal(a.last('scannerMode').body.mode,'rfid');a.reply('scannerMode',{status:'success'});await flush();a.w.NativeRfid.barcode('IGNORE');assert.equal(data.value,'NEW');}finally{a.close();}});
test('focus switching ignores read-only fields and does not accept scans before native confirmation',async()=>{const a=await setup({ui:true,connected:true});try{const field=a.doc.getElementById('tagSearch');field.focus();await flush();a.w.NativeRfid.barcode('BLOCKED');assert.equal(field.value,'');a.reply('scannerMode',{status:'failed',message:'Not available'});await flush();a.w.NativeRfid.barcode('BLOCKED');assert.equal(field.value,'');field.blur();await flush();if(a.last('scannerMode').body.mode==='rfid'){a.reply('scannerMode',{status:'success'});await flush();}const count=a.commands.filter(x=>x.operation==='scannerMode').length;a.doc.getElementById('length').focus();await flush();assert.equal(a.commands.filter(x=>x.operation==='scannerMode').length,count);}finally{a.close();}});
