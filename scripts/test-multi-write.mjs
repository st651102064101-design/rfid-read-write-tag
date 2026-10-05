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

 if(ui){w.eval(asset('app.js')+'\n'+asset('batch-write.js'));w.eval(asset('mobile.js'));}

 await flush();

 return {dom,w,doc:w.document,commands,errors,timeouts,async delay(ms){elapsed+=ms;const ready=[...timeouts].filter(([,timer])=>timer.delay===ms);for(const [id,timer]of ready){timeouts.delete(id);timer.fn();}await flush();},async tick(ms){for(const timer of intervals.values())if(timer.delay===ms)timer.fn();await flush();},async scan(tags=[{epc,rssi:-40}]){w.NativeRfid.tags(tags);if(ui)await w.pollLive();await flush();},last(operation){return commands.filter(c=>c.operation===operation).at(-1);},reply(operation,result){const command=commands.filter(c=>c.operation===operation).at(-1);assert.ok(command,'Expected '+operation+' command');w.NativeRfid.reply(command.id,result);return command;},close(){timeouts.clear();intervals.clear();dom.window.close();}};

}


function open(a){a.doc.getElementById('writeTags').click();for(const check of a.doc.querySelectorAll('#multiWriteTags input'))check.checked=true;const data=a.doc.getElementById('multiWriteData');data.value='NEW';data.dispatchEvent(new a.w.Event('input'));}
test('batch write confirms two fresh capacities and clears every old tail byte',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);open(a);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();assert.equal(a.w.writeUiLocked,true);a.w.NativeRfid.back();assert.equal(a.doc.getElementById('multiWriteDialog').open,true);for(const [target,length] of [[epc,4],[secondEpc,8]]){assert.equal(a.last('banks').body.epc,target);a.reply('banks',{status:'success',banks:{USER:'41'.repeat(length)}});await flush();assert.equal(a.last('write').body.dataHex,'4E4557'+'00'.repeat(length-3));assert.equal(a.last('write').body.lengthBytes,length);a.reply('write',{status:'success',verified:true,durationMs:100});await flush();}await pending;assert.match(a.doc.getElementById('multiWriteResults').textContent,/2 \/ 2 tags verified/);assert.equal(a.w.writeUiLocked,false);a.w.NativeRfid.back();assert.equal(a.doc.getElementById('writeSuccessBadge').open,false);assert.equal(a.doc.getElementById('multiWriteDialog').open,true);}finally{a.close();}});
test('unreachable or too-small tags are not written',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);open(a);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();a.reply('banks',{status:'failed',message:'Not reachable'});await flush();a.reply('banks',{status:'success',banks:{USER:'4142'}});await pending;assert.equal(a.commands.filter(x=>x.operation==='write').length,0);assert.match(a.doc.getElementById('multiWriteResults').textContent,/0 \/ 2 tags verified/);}finally{a.close();}});
test('unconfirmed write stops batch without sending remaining targets',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan([{epc},{epc:secondEpc}]);open(a);const pending=a.doc.getElementById('startMultiWrite').onclick();await flush();a.reply('banks',{status:'success',banks:{USER:'41424344'}});await flush();a.reply('write',{status:'unknown',verified:false,message:'Check tag'});await pending;assert.equal(a.commands.filter(x=>x.operation==='banks').length,1);assert.match(a.doc.getElementById('multiWriteResults').textContent,/Not attempted/);}finally{a.close();}});
test('HEX filters invalid characters and rejects incomplete bytes; trigger prevents writing',async()=>{const a=await setup({ui:true,connected:true});try{await a.scan();open(a);a.doc.querySelector('[data-encoding=HEX]').click();const data=a.doc.getElementById('multiWriteData');data.value='GG1';data.dispatchEvent(new a.w.Event('input'));assert.equal(data.value,'1');assert.equal(a.doc.getElementById('startMultiWrite').disabled,true);data.value='4142';data.dispatchEvent(new a.w.Event('input'));a.w.NativeRfid.state({triggerHeld:true});await a.doc.getElementById('startMultiWrite').onclick();assert.equal(a.commands.filter(x=>x.operation==='banks').length,0);assert.match(a.doc.getElementById('multiWriteError').textContent,/Release the trigger/);}finally{a.close();}});
