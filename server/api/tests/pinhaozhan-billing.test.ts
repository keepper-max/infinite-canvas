import test from "node:test";
import assert from "node:assert/strict";
import { BillingService } from "../src/billing-service.js";
const config={baseUrl:"https://example.invalid",apiKey:"synthetic-pinhaozhan-key",catalogUrl:""};
function setup() {
 const calls:Array<{sql:string,values?:unknown[]}>=[];
 const job={id:"job-1",project_id:"project-1",created_by:"user-1",provider:"pinhaozhan",model_id:"pinhaozhan.text.deepseek-v4.1-flash",capability:"text",status:"billing_pending",provider_submission_state:"resolved",billing_trace_id:"exact",billing_meter_usage:{prompt_tokens:311,completion_tokens:33,total_tokens:344},compiled_request:{upstreamModel:"deepseek-v4.1-flash"}};
 const pool={query:async(sql:string,values?:unknown[])=>{calls.push({sql,values});return {rows:sql.includes("select * from generation_jobs")?[job]:[],rowCount:1};}};
 let settled=0;
 const service=new BillingService(pool as any,config,{settleUsage:async()=>{settled++;}} as any,config);
 return {calls,job,service,settled:()=>settled};
}
test("pinhaozhan settles only the request-bound supplier ledger and preserves USD",async()=>{
 const original=globalThis.fetch;const s=setup();
 try{globalThis.fetch=async(input,init)=>{assert.equal(String(input),"https://example.invalid/api/log/token");assert.equal(init?.redirect,"error");assert.equal((init?.headers as any).Authorization,"Bearer synthetic-pinhaozhan-key");return Response.json({success:true,data:[{request_id:"exact",type:2,model_name:"deepseek-v4.1-flash",quota:3,prompt_tokens:311,completion_tokens:33}]});};
 await s.service.finalizeProviderUsage("job-1");const insert=s.calls.find(x=>x.sql.includes("insert into generation_usage"))!;
 assert.ok(insert);assert.ok(insert.values?.includes("0.000006"));assert.ok(insert.values?.includes("USD"));assert.equal(s.settled(),1);
 assert.equal(JSON.stringify(s.calls).includes(config.apiKey),false);
 }finally{globalThis.fetch=original;}
});
test("absent ledger leaves billing in manual review and cannot deliver or release credits",async()=>{
 const original=globalThis.fetch;const s=setup();
 try{globalThis.fetch=async()=>Response.json({success:true,data:[]});assert.equal((await s.service.finalizeProviderUsage("job-1")).status,"manual_review");assert.equal(s.settled(),0);assert.equal(s.calls.some(x=>x.sql.includes("insert into generation_usage")),false);assert.ok(s.calls.some(x=>x.sql.includes("billing_status='manual_review'")));}finally{globalThis.fetch=original;}
});
