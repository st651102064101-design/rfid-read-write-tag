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

export const MAX_WORDS_PER_ACCESS=32;

export function chunkWordAccess({dataHex,wordPointer,maxWords=MAX_WORDS_PER_ACCESS}){
 const data=String(dataHex||'').toUpperCase();
 if(!/^(?:[0-9A-F]{4})+$/.test(data)||!Number.isSafeInteger(wordPointer)||wordPointer<0||!Number.isSafeInteger(maxWords)||maxWords<1)throw Error('Invalid word access plan');
 const chunks=[];
 for(let offset=0;offset<data.length/4;offset+=maxWords){const words=Math.min(maxWords,data.length/4-offset);chunks.push({wordPointer:wordPointer+offset,wordCount:words,dataHex:data.slice(offset*4,(offset+words)*4)});}
 return chunks;
}

export function accessSequenceMatches(actual,expected){
 if(!Array.isArray(actual)||!Array.isArray(expected)||actual.length!==expected.length)return false;
 return expected.every((operation,index)=>actual[index]?.type===operation.type&&Object.entries(operation.config||{}).every(([key,value])=>{
  const received=actual[index]?.config?.[key];
  return ['data','password'].includes(key)&&typeof received==='string'&&typeof value==='string'?received.toUpperCase()===value.toUpperCase():received===value;
 }));
}

export function adjacentWordFromRead(request,readHex,knownBankHex){
 const read=String(readHex||'').toUpperCase(),bank=String(knownBankHex||'').toUpperCase();
 if(/^[0-9A-F]{4}$/.test(read))return read;
 const bankWordOffset=request.offsetBytes+request.lengthBytes-1;
 if(/^(?:[0-9A-F]{4})+$/.test(read)&&read===bank&&read.length/2>=bankWordOffset+2)return read.slice(bankWordOffset*2,(bankWordOffset+2)*2);
 return null;
}

export function buildWordWritePlan(request,beforeHex){
 const dataHex=String(request.dataHex||'').toUpperCase(),before=String(beforeHex||'').toUpperCase();
 if(!/^(?:[0-9A-F]{2})+$/.test(dataHex)||dataHex.length!==request.lengthBytes*2)throw Error('Invalid byte payload');
 const wordCount=Math.ceil(request.lengthBytes/2),readHexLength=wordCount*4;
 if(request.lengthBytes%2===0)return {wordCount,readHexLength,writeHex:dataHex};
 if(!/^[0-9A-F]{4}$/.test(before))throw Error('Could not read the adjacent tag word before writing');
 return {wordCount,readHexLength,writeHex:dataHex+before.slice(2,4)};
}
export function writeResultVerified(request,plan,before,written,after){
 const prior=typeof before==='string'?before.toUpperCase():'',readback=typeof after==='string'?after.toUpperCase():'';
 const preserved=request.lengthBytes%2===0||readback.slice(request.lengthBytes*2,request.lengthBytes*2+2)===prior.slice(2,4);
 return /^success$/i.test(written||'')&&readback===plan.writeHex&&readback.slice(0,request.lengthBytes*2)===request.dataHex.toUpperCase()&&preserved;
}
export function writeWaitTimeoutMs(lengthBytes){return Math.min(120000,Math.max(20000,15000+lengthBytes*1600));}
