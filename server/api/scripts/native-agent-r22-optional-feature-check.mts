import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db/client.js';
const root='H:/CodexStorage/shoushou-r22',f=JSON.parse(await readFile(root+'/private/ui-fixture.json','utf8')),{pool}=createDatabase('postgres://p25@127.0.0.1:55485/r22_isolated');
const req=async(path:string,body?:any)=>{const r=await fetch('http://127.0.0.1:3202'+path,{method:body?'POST':'GET',headers:{cookie:f.cookieName+'='+f.token,origin:'http://127.0.0.1:3202',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json() as any};};
const api=async(path:string,body?:any)=>{const r=await req(path,body);assert.ok(r.status<300,JSON.stringify(r));return r.body.data;};
const before=(await pool.query('select * from user_feature_grants where user_id=$1 and feature=$2',[f.ownerId,'knowledge'])).rows[0];
await writeFile(root+'/private/knowledge-feature-grant-before.json',JSON.stringify(before??null));
let active:string|undefined;const checks:string[]=[];
try{
 await pool.query("insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values($1,'knowledge',false,$1,'R22 isolated revocation test') on conflict(user_id,feature) do update set enabled=false",[f.ownerId]);
 assert.equal((await req('/api/native-agent/projects/'+f.projectId+'/decisions')).status,403);checks.push('knowledge decision API denied after explicit feature revocation');
 const s=await api('/api/native-agent/sessions',{projectId:f.projectId,title:'知识功能撤销后的无来源对话',mode:'execute',operationId:randomUUID()});
 const r=await api('/api/native-agent/sessions/'+s.id+'/runs',{operationId:randomUUID(),prompt:'你好，继续讨论。',mode:'execute',modelId:f.model,budgetCents:200,conversationVersion:1});active=r.id;
 let done:any;for(let i=0;i<400;i++){const v=await api('/api/native-agent/sessions/'+s.id+'/presentation');done=v.runs.find((x:any)=>x.id===r.id);if(['completed','failed','paused','awaiting_manual_review'].includes(done.status))break;await new Promise(r=>setTimeout(r,150));}assert.equal(done.status,'completed');active=undefined;
 const input=(await pool.query("select input from native_agent_steps where run_id=$1 and input->>'conversationStage'='intent'",[r.id])).rows[0].input;
 assert.ok(!JSON.stringify(input.contextRequest).includes('shoushou-creative-decisions'));checks.push('fresh unsourced conversation completes through actual Worker while optional memory is disabled');
 const denied=await req('/api/native-agent/sessions/'+f.sessionId+'/presentation');assert.ok([403,404].includes(denied.status),JSON.stringify({status:denied.status}));checks.push('previous knowledge-sourced session remains permission blocked');
}finally{
 if(active)await req('/api/native-agent/runs/'+active+'/cancel',{});
 if(before)await pool.query('update user_feature_grants set enabled=$3,updated_by=$4,reason=$5,updated_at=$6 where user_id=$1 and feature=$2',[before.user_id,before.feature,before.enabled,before.updated_by,before.reason,before.updated_at]);
 else await pool.query("delete from user_feature_grants where user_id=$1 and feature='knowledge' and reason='R22 isolated revocation test'",[f.ownerId]);
 await pool.end();
}
await writeFile(root+'/artifacts/optional-feature-check.json',JSON.stringify({checks,isolated:true,productionTouched:false},null,2));console.log(JSON.stringify(checks));
