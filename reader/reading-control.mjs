export async function setReading(enabled,request,auth,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=10}={}){
 if(typeof enabled!=='boolean')throw Error('Reading state must be boolean');
 const state=await request('/cloud/status','GET',null,auth);
 if(!['active','inactive'].includes(state.radioActivity))throw Error('Reader radio state unavailable');
 if(enabled){const mode=await request('/cloud/mode','GET',null,auth);if(mode.accesses?.some(access=>['WRITE','LOCK','KILL'].includes(access.type)))throw Error('Reader has a tag operation configured; reading cannot be started');}
 if((state.radioActivity==='active')!==enabled)await request(enabled?'/cloud/start':'/cloud/stop','PUT',null,auth);
 for(let i=0;i<attempts;i++){const current=await request('/cloud/status','GET',null,auth);if(current.radioActivity===(enabled?'active':'inactive'))return {reading:enabled,verified:true};await wait(500);}
 throw Error('Reader did not confirm the requested reading state');
}
