import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSelectionPlan } from '../src/autocut/planner.js';
import { compileAnalysisResult } from '../src/autocut/analysis.js';
import { fixture } from './fixtures/autocut.js';
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


test('Neither completed nor released alone allows artifact parsing; both gates are required',async()=>{
 let prematureReads=0;
 const blockedArtifact={get text(){prematureReads++;throw Error('must not parse undelivered artifacts');}};
 const p=provider([
  {status:'running',creditDeliveryStatus:'released',artifacts:[blockedArtifact]},
  {status:'completed',creditDeliveryStatus:'billing_pending',artifacts:[blockedArtifact]},
  {status:'completed',creditDeliveryStatus:'released',artifacts:[{text:'说明 {"clips":[]} 完毕'}]},
 ]);
 assert.deepEqual(await p.model.complete('task','plan-v3','',[],AbortSignal.timeout(5000)),{clips:[]});
 assert.equal(prematureReads,0);assert.equal(p.reads(),3);assert.equal(p.submissions(),0);
});

test('Malformed released output preserves the bound job and settlement, including repeated reads',async()=>{
 const state={status:'completed',billingStatus:'settled',creditDeliveryStatus:'released',creditPoints:'25',artifacts:[{text:'bad {broken} {"clips":[]}'}]};
 const original=structuredClone(state),p=provider([state]);
 for(let i=0;i<2;i++)await assert.rejects(p.model.complete('task','plan-v3','',[],AbortSignal.timeout(5000)),(e:any)=>e.code==='AUTOCUT_MODEL_INVALID_JSON');
 assert.equal(p.submissions(),0);assert.deepEqual(state,original);
});

test('Syntax fallback does not repair business schemas or fabricate a plan',async()=>{
 const p=provider([{status:'completed',creditDeliveryStatus:'released',artifacts:[{text:'说明 {"clips":[],"shell":"unsafe"}'}]}]);
 const result=await p.model.complete('task','plan-v3','',[],AbortSignal.timeout(5000));
 const {p:id,asset,analyses}=fixture();
 assert.throws(()=>compileSelectionPlan(result,id,[asset],analyses,'16:9',null,false));
 assert.throws(()=>compileAnalysisResult(result,analyses[asset.id]));
 assert.equal(p.submissions(),0);
});


test('Analysis rejects the observed zero-duration video result without inventing a range',()=>{
 const {info}=fixture();
 const media={...info,durationMs:11718};
 const raw={candidates:[{start:5859,end:5859,summary:'关键帧',evidence:'图像',confidence:0.98}]};
 const original=structuredClone(raw);
 assert.throws(()=>compileAnalysisResult(raw,media),(e:any)=>e.code==='AUTOCUT_ANALYSIS_INVALID'&&e.message.includes('时长为0'));
 assert.deepEqual(raw,original);
 const valid={candidates:[{...raw.candidates[0],start:0,end:11718}]};
 assert.deepEqual(compileAnalysisResult(valid,media).candidates,valid.candidates);
 for(const kind of ['video','audio'] as const){
  assert.throws(()=>compileAnalysisResult(raw,{...media,kind}));
  assert.throws(()=>compileAnalysisResult({candidates:[{...raw.candidates[0],start:0,end:11719}]},{...media,kind}),/越界/);
 }
 assert.equal(compileAnalysisResult({candidates:[]},media).candidates.length,0);
 assert.equal(compileAnalysisResult({candidates:[{...raw.candidates[0],start:0,end:0}]},{...media,kind:'image',durationMs:0}).candidates[0].end,0);
});

test('AutoCut accepts budgets above previous ceilings while admission and queue protection remain enforced',async()=>{
 const {AutoCutService}=await import('../src/autocut/service.js');
 const {taskSchema}=await import('../src/autocut/contract.js');
 const {randomUUID}=await import('node:crypto');
 const old=process.env.AUTOCUT_ACCEPT_NEW_TASKS;
 delete process.env.AUTOCUT_ACCEPT_NEW_TASKS;
 let accepting=true,owned=0,total=0;
 const db={query:async(sql:string)=>({rows:sql.includes('platform_settings')?[{value:{accepting}}]:sql.includes('count(*)')?[{owned,total}]:[]})};
 const service=new AutoCutService(db as any,{add:async()=>{},remove:async()=>false},true);
 try{
  for(const budgetCents of [101,1001,10000]){
   assert.equal(taskSchema.parse({operationId:randomUUID(),expectedRevision:null,prompt:'',kind:'edit',mode:'highlights',targetDurationMs:15000,aspectRatio:'9:16',budgetCents,confirmed:true}).budgetCents,budgetCents);
   await (service as any).admit(db,'actor');
  }
  owned=2;await assert.rejects((service as any).admit(db,'actor'),(e:any)=>e.code==='AUTOCUT_QUEUE_LIMIT');
  owned=0;total=20;await assert.rejects((service as any).admit(db,'actor'),(e:any)=>e.code==='AUTOCUT_QUEUE_LIMIT');
  total=0;accepting=false;await assert.rejects((service as any).admit(db,'actor'),(e:any)=>e.code==='AUTOCUT_PAUSED');
 }finally{if(old===undefined)delete process.env.AUTOCUT_ACCEPT_NEW_TASKS;else process.env.AUTOCUT_ACCEPT_NEW_TASKS=old;}
});
