import fs from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
const target = targets.find(t => t.url === 'file:///android_asset/index.html');
if (!target) throw Error('App WebView not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const waiters = new Map();
ws.onmessage = event => { const data = JSON.parse(event.data); if (data.id && waiters.has(data.id)) { waiters.get(data.id)(data); waiters.delete(data.id); } };
async function call(method, params) { const requestId = ++id; const promise = new Promise(resolve => waiters.set(requestId, resolve)); ws.send(JSON.stringify({id:requestId,method,params})); return promise; }
const expression = fs.readFileSync(new URL('./mc3390r-scan-benchmark.js', import.meta.url), 'utf8');
const timeout = setTimeout(() => { console.error('CDP timed out'); process.exit(1); }, 180000);
const result = await call('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true});
if (result.result.exceptionDetails) { console.error(JSON.stringify(result.result.exceptionDetails, null, 2)); process.exitCode = 1; } else console.log(JSON.stringify(result.result.result.value, null, 2));
clearTimeout(timeout);
ws.close();
