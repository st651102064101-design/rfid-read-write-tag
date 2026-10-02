export async function measureOperation(operation,clock=()=>performance.now()){
 const started=clock();
 try{const result=await operation();return {...result,durationMs:Math.max(0,Math.round(clock()-started))};}
 catch(error){const failure=error instanceof Error?error:new Error(String(error));failure.durationMs=Math.max(0,Math.round(clock()-started));throw failure;}
}
