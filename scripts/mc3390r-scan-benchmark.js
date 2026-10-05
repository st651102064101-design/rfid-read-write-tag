(async()=>{
 const command=NativeRfid.command,original=await command('scanDiagnostics',{}),runs=[];
 if(original.status!=='success')throw Error(original.message);
 const savedSelection=document.getElementById('epc').value;
 selectionInitialized=true;selectedEpc='';document.getElementById('epc').value='';
 NativeRfid.command=(operation,body,...args)=>operation==='banks'?Promise.resolve({status:'failed',message:'Memory details resume after the scan benchmark'}):command(operation,body,...args);
 const configurations=[{rfMode:21,session:0,inventoryState:2,population:32},{rfMode:21,session:0,inventoryState:2,population:32},{rfMode:21,session:0,inventoryState:2,population:32}];
 function check(r){if(r.status!=='success')throw Error(r.message);return r;}
 try{check(await command('reading',{enabled:false}));for(const config of configurations){
  const applied=check(await command('scanConfig',config)),before=check(await command('scanDiagnostics',{})),ui=NativeRfid.scanStats.totalReports;
  check(await command('reading',{enabled:true}));const start=performance.now();await new Promise(r=>setTimeout(r,10000));check(await command('reading',{enabled:false}));const elapsedMs=performance.now()-start;
  await new Promise(r=>setTimeout(r,150));const after=check(await command('scanDiagnostics',{}));
  if(after.bufferFull!==before.bufferFull||after.deliveryOverflow!==before.deliveryOverflow||after.reports-before.reports!==NativeRfid.scanStats.totalReports-ui)throw Error('Inventory delivery lost reports or overflowed');
  runs.push({config,elapsedMs,reports:after.reports-before.reports,reportsPerSecond:(after.reports-before.reports)*1000/elapsedMs,uiReports:NativeRfid.scanStats.totalReports-ui,bufferFull:after.bufferFull-before.bufferFull,overflow:after.deliveryOverflow-before.deliveryOverflow,starts:after.inventoryStarts-before.inventoryStarts,bankRequests:after.bankRequests-before.bankRequests,powerDbm:after.readerPowerDbm});
 }return {original:{session:original.session,rfMode:original.rfMode,inventoryState:original.inventoryState,powerDbm:original.readerPowerDbm,uniqueTagReporting:original.uniqueTagReporting},runs};}
 finally{await command('reading',{enabled:false});await command('scanConfig',{session:original.session,population:original.population,inventoryState:original.inventoryState,rfMode:original.rfMode});NativeRfid.command=command;selectedEpc=savedSelection;document.getElementById('epc').value=savedSelection;}
})()
