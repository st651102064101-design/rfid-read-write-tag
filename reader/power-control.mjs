import {setReading} from './reading-control.mjs';
export function powerLimits(region){if(typeof region?.minTxPowerSupported!=="number"||typeof region?.maxTxPowerSupported!=="number")throw Error("Reader power limits unavailable");const minDbm=Number(region.minTxPowerSupported)/10,maxDbm=Number(region.maxTxPowerSupported)/10;if(!Number.isFinite(minDbm)||!Number.isFinite(maxDbm)||minDbm<0||maxDbm>33||minDbm>maxDbm)throw Error('Reader power limits unavailable');return {minDbm:Math.ceil(minDbm),maxDbm:Math.floor(maxDbm)};}
export async function readPowerState(request,auth){const [region,mode]=await Promise.all([request('/cloud/region','GET',null,auth),request('/cloud/mode','GET',null,auth)]);const values=Array.isArray(mode.transmitPower)?mode.transmitPower:[mode.transmitPower];const powerDbm=values.every(v=>v===values[0])&&Number.isFinite(values[0])?values[0]:null;return {...powerLimits(region),powerDbm};}
export async function setTransmitPower(powerDbm,request,auth){
 const limits=powerLimits(await request('/cloud/region','GET',null,auth));if(!Number.isInteger(powerDbm)||powerDbm<limits.minDbm||powerDbm>limits.maxDbm)throw Error('Power exceeds reader limits');
 const original=await request('/cloud/mode','GET',null,auth);if(original.accesses?.some(a=>['WRITE','LOCK','KILL'].includes(a.type)))throw Error('Reader has a tag operation configured');
 const state=await request('/cloud/status','GET',null,auth);if(!['active','inactive'].includes(state.radioActivity))throw Error('Reader radio state unavailable');
 const desired=structuredClone(original);desired.transmitPower=Array.isArray(original.transmitPower)?original.transmitPower.map(()=>powerDbm):powerDbm;
 const wasActive=state.radioActivity==='active';let attempted=false;
 try{if(wasActive)await setReading(false,request,auth);attempted=true;await request('/cloud/mode','PUT',desired,auth);const actual=await request('/cloud/mode','GET',null,auth);const values=Array.isArray(actual.transmitPower)?actual.transmitPower:[actual.transmitPower];if(!values.length||values.some(v=>v!==powerDbm))throw Error('Reader did not confirm transmit power');return {powerDbm,verified:true};}
 catch(error){if(attempted)try{await request('/cloud/mode','PUT',original,auth);}catch{throw Error('Power result uncertain; original reader mode could not be restored');}throw error;}
 finally{await setReading(wasActive,request,auth);}
}
