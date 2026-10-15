import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimeCache} from '../plugin/runtime/cache-maintenance.mjs';
const fixture=()=>{const calls=[];const cache=runtimeCache({jobs:{requestMaintenance:work=>calls.push(work)}});return{cache,calls};};
test('authored bursts coalesce collection and explicit budget changes collect immediately',async()=>{
 const{cache,calls}=fixture();
 try{
  for(let i=0;i<4;i++){cache.schedule();await delay(100);assert.equal(calls.length,0);}
  await delay(200);assert.equal(calls.length,1);
  cache.schedule();cache.schedule({immediate:true});assert.equal(calls.length,2);
  await delay(300);assert.equal(calls.length,2);
  cache.schedule();cache.cancel();await delay(300);assert.equal(calls.length,2);
 }finally{cache.cancel();}
});
test('continuous edits cannot postpone collection indefinitely', {timeout:7000},async()=>{
 const{cache,calls}=fixture();
 try{const start=performance.now();while(performance.now()-start<5200){cache.schedule();await delay(100);}assert(calls.length>=1);assert(calls.length<3);}finally{cache.cancel();}
});
