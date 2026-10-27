import assert from 'node:assert/strict';
import test from 'node:test';
import { ManagedAutoCutModel } from '../src/autocut/model.js';
function provider(states: any[]) {
 let reads = 0, submissions = 0;
 const client = { query: async (sql: string) => ({rows: sql.includes('select t.*') ? [{actor_id:'actor',status:'running',cancel_requested:false}] : sql.includes('select * from autocut_model_calls') ? [{generation_job_id:'existing'}] : []}), release(){} };
 const pool = { connect: async()=>client, query: async()=>({rows:[]}) };
 const jobs = { get: async()=>states[Math.min(reads++,states.length-1)], create:async()=>{submissions++;throw Error('must reuse');} };
 return {model:new ManagedAutoCutModel(pool as any,jobs as any,{modelId:'test',quoteCents:25,maxOutputTokens:4096,analysisVersion:'test'}),reads:()=>reads,submissions:()=>submissions};
}
test('AutoCut waits through settled billing until artifacts are released, without resubmission',async()=>{
 const p=provider([{status:'billing_pending',billingStatus:'settled',creditDeliveryStatus:'billing_pending',artifacts:[]},{status:'completed',billingStatus:'settled',creditDeliveryStatus:'released',artifacts:[{text:'{"clips":[]}'}]}]);
 assert.deepEqual(await p.model.complete('task','plan-v3','',[],AbortSignal.timeout(5000)),{clips:[]});assert.equal(p.reads(),2);assert.equal(p.submissions(),0);
});
test('AutoCut keeps payment and uncertain billing blocked',async()=>{
 for(const state of [{status:'payment_required',billingStatus:'settled',creditDeliveryStatus:'payment_required'},{status:'billing_pending',billingStatus:'needs_review',creditDeliveryStatus:'billing_pending'}]){
  const p=provider([state]);await assert.rejects(p.model.complete('task','plan-v3','',[],AbortSignal.timeout(5000)),/核查原请求/);assert.equal(p.submissions(),0);
 }
});
