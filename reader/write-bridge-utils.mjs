// FX9600 event payloads can be wrapped in arrays or nested objects by the
// management-event webhook. Keep matching independent of that envelope.
export function readerRecords(value, output = []) {
 if (!value || typeof value !== 'object') return output;
 if (Array.isArray(value)) {
  for (const item of value) readerRecords(item, output);
  return output;
 }
 const data = value.data && typeof value.data === 'object' ? value.data : value;
 if (typeof value.type === 'string' && typeof (data.idHex || value.idHex) === 'string') output.push(value);
 for (const child of Object.values(value)) if (child && typeof child === 'object') readerRecords(child, output);
 return output;
}

export function recordEpc(record) {
 return String(record?.data?.idHex || record?.idHex || '').toUpperCase();
}

export function recordAccessResults(record) {
 const data = record?.data && typeof record.data === 'object' ? record.data : record;
 return data?.accessResults;
}

export function buildWordWritePlan(request,beforeHex){
 const dataHex=String(request.dataHex||'').toUpperCase(),before=String(beforeHex||'').toUpperCase();
 if(!/^(?:[0-9A-F]{2})+$/.test(dataHex)||dataHex.length!==request.lengthBytes*2)throw Error('Invalid byte payload');
 const wordCount=Math.ceil(request.lengthBytes/2),readHexLength=wordCount*4;
 if(request.lengthBytes%2===0)return {wordCount,readHexLength,writeHex:dataHex};
 if(!/^(?:[0-9A-F]{4})+$/.test(before)||before.length<readHexLength)throw Error('Could not read the complete tag word before writing');
 return {wordCount,readHexLength,writeHex:request.lengthBytes%2?dataHex+before.slice(dataHex.length,dataHex.length+2):dataHex};
}
export function writeResultVerified(request,plan,before,written,after){
 const prior=typeof before==='string'?before.toUpperCase():'',readback=typeof after==='string'?after.toUpperCase():'';
 const preserved=request.lengthBytes%2===0||readback.slice(request.lengthBytes*2,request.lengthBytes*2+2)===prior.slice(request.lengthBytes*2,request.lengthBytes*2+2);
 return /^success$/i.test(written||'')&&readback===plan.writeHex&&readback.slice(0,request.lengthBytes*2)===request.dataHex.toUpperCase()&&preserved;
}
export function writeWaitTimeoutMs(lengthBytes){return Math.min(120000,Math.max(20000,15000+lengthBytes*1600));}
