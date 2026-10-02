export function decodeReaderPayload(body){
 const raw=Buffer.isBuffer(body)?body.toString('utf8'):String(body);
 try{return {payload:JSON.parse(raw),repaired:0};}catch(original){
  let repaired=0;
  // FX9600 can omit the closing accessResults bracket before the next data field.
  // Match only a string array followed by a JSON object key, then fully validate JSON.
  const fixed=raw.replace(/("accessResults"\s*:\s*\[\s*"(?:\\.|[^"\\])*"(?:\s*,\s*"(?:\\.|[^"\\])*")*)(?=\s*,\s*"(?:\\.|[^"\\])*"\s*:)/g,match=>{repaired++;return match+']';});
  if(!repaired)throw original;
  let normalized=fixed;try{return {payload:JSON.parse(normalized),repaired};}catch{normalized=removeDeferredBrackets(fixed,repaired);return {payload:JSON.parse(normalized),repaired};}
 }
}

function removeDeferredBrackets(raw,budget){let out='',quoted=false,escaped=false,removed=0;const stack=[];for(let i=0;i<raw.length;i++){const ch=raw[i];if(quoted){out+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}if(ch==='"'){quoted=true;out+=ch;continue;}if(ch===']'){if(stack.length===1&&stack[0]==='['){let end=i;while(raw[end]===']'||/\s/.test(raw[end]||'!'))end++;if(/^,\s*\{/.test(raw.slice(end))){removed++;if(removed>budget)throw new SyntaxError('Unexpected deferred array bracket');continue;}}if(stack.at(-1)!=='['){removed++;if(removed>budget)throw new SyntaxError('Unexpected deferred array bracket');continue;}stack.pop();}else if(ch==='}') {if(stack.at(-1)!=='{')throw new SyntaxError('Unbalanced reader object');stack.pop();}else if(ch==='['||ch==='{')stack.push(ch);out+=ch;}if(removed!==budget)throw new SyntaxError('Reader bracket recovery count mismatch');return out;}
