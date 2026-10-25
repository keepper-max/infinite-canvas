import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client.js";
import { PostgresPlatformRepository } from "../src/repository.js";
import { KnowledgeService } from "../src/knowledge-service.js";
import { NativeAgentService } from "../src/native-agent/service.js";
import { conversationTools, assertConversationToolScope, parseConversationDecision, toolFailureRecoveryMessage } from "../src/native-agent/conversation-policy.js";
import { parseTool } from "../src/native-agent/tools.js";
import { safeTaskError } from "../src/native-agent/presentation.js";
import type { AgentModelDriver, ModelReply } from "../src/native-agent/model.js";
const decision = {intent:"action" as const,actionTarget:"canvas" as const,evidence:"按此方案执行",resolvedRequest:"将刚才讨论的剧本写入画布文本节点",summary:{discussion:"讨论剧本",proposals:[],confirmed:[],rejected:[],openQuestions:[]}};
const nodeId="vibe-00000000-0000-4000-8000-000000000001-script";
test("canvas action excludes knowledge relationship tools while preserving source reads",()=>{
 const tools=conversationTools(decision,"execute")!;
 assert.ok(tools.includes("read_knowledge")&&tools.includes("create_canvas_node"));
 for(const toolName of ["suggest_knowledge_relation","apply_knowledge_relation","create_knowledge_document"])
  assert.throws(()=>assertConversationToolScope(tools,[{toolName}]),{code:"AGENT_TOOL_SCOPE_MISMATCH"});
 assert.ok(!conversationTools({...decision,actionTarget:"knowledge"},"execute")!.includes("create_canvas_node"));
 assert.ok(conversationTools({...decision,actionTarget:"knowledge"},"execute")!.includes("apply_knowledge_relation"));
 assert.equal(conversationTools({...decision,actionTarget:undefined},"execute"),undefined,"archived decisions retain old capabilities");
});
test("unscoped new action clarifies; typed canvas node IDs are not coerced into document UUIDs",()=>{
 assert.equal(parseConversationDecision(JSON.stringify({...decision,actionTarget:undefined}),decision.evidence,[]).intent,"clarify");
 assert.equal(parseConversationDecision(JSON.stringify(decision),decision.evidence,[]).actionTarget,"canvas");
 const input={spaceId:randomUUID(),sourceId:randomUUID(),targetId:nodeId};
 assert.throws(()=>parseTool("suggest_knowledge_relation",input),{code:"AGENT_INVALID_TOOL_ARGUMENTS"});
 assert.equal(parseTool("update_canvas_node",{nodeId,content:"剧本",expectedCanvasRevision:0}).nodeId,nodeId);
 assert.ok(safeTaskError("AGENT_INVALID_TOOL_ARGUMENTS").includes("增加预算或重新查询无法修复"));
 assert.ok(toolFailureRecoveryMessage("AGENT_INVALID_TOOL_ARGUMENTS")?.startsWith("平台"));
 assert.equal(toolFailureRecoveryMessage("AGENT_SUBMISSION_UNKNOWN"),null);
});
const url=process.env.P251_TEST_DATABASE_URL;
test("real PostgreSQL: wrong tool batch stops, explicit resume receives correction, one approval persists canvas",{skip:!url,timeout:60000},async()=>{
 assert.equal(url,"postgres://p25@127.0.0.1:55485/r21_regression_isolated");
 process.env.NATIVE_AGENT_ENABLED="true";process.env.NATIVE_AGENT_DEFAULT_ENABLED="true";process.env.KNOWLEDGE_DEFAULT_ENABLED="true";
 const {db,pool}=createDatabase(url!),repo=new PostgresPlatformRepository(db),knowledge=new KnowledgeService(db);
 let calls=0,recover=false,proposed=false,feedbackSeen=false;
 const driver:AgentModelDriver={models:async()=>[{id:"native-agent-fixture",name:"隔离替身",substitute:true}],run:async(_id,messages,_signal,_emit,execution)=>{
  calls++;let text="",toolCalls:ModelReply["calls"]=[];
  if(execution?.conversationStage==="intent")text=JSON.stringify(decision);
  else if(!recover){assert.ok(!execution?.toolNames?.includes("suggest_knowledge_relation"));toolCalls=[{toolCallId:randomUUID(),toolName:"suggest_knowledge_relation",input:{spaceId:randomUUID(),sourceId:randomUUID(),targetId:nodeId}}];}
  else if(!proposed){feedbackSeen=messages.some(m=>typeof m.content==="string"&&m.content===toolFailureRecoveryMessage("AGENT_TOOL_SCOPE_MISMATCH"));assert.ok(feedbackSeen);proposed=true;toolCalls=[{toolCallId:randomUUID(),toolName:"create_canvas_node",input:{type:"text",title:"剧本",content:"讨论确定的原方案",position:{x:0,y:0},expectedCanvasRevision:0}}];}
  else text="准备将讨论方案保存为画布文本节点，请确认平台计划。";
  return {text,calls:toolCalls,messages:[{role:"assistant",content:toolCalls.length?toolCalls.map(c=>({type:"tool-call" as const,toolCallId:c.toolCallId,toolName:c.toolName,input:c.input})):text}],inputTokens:100,outputTokens:50,meterStatus:"substitute"};
 }};
 const service=new NativeAgentService(knowledge,pool,driver,async()=>{});
 try{
  const owner=await repo.createUserWithWorkspace("scope-"+randomUUID()+"@example.test","synthetic"),actor=owner.user.id,project=owner.workspace.projectId;
  const session=await service.createSession(actor,{projectId:project,title:"作用域回归",mode:"execute",operationId:randomUUID()});
  const run=await service.start(actor,session.id,{operationId:randomUUID(),prompt:decision.evidence,mode:"execute",modelId:"native-agent-fixture",budgetCents:0,conversationVersion:1});
  await service.drive(run.id);let snapshot:any=await service.snapshot(actor,session.id);
  assert.equal(snapshot.runs[0].error_code,"AGENT_TOOL_SCOPE_MISMATCH");assert.equal(calls,2);assert.equal(snapshot.plans.length,0);assert.equal((await repo.getCanvasForUser(project,actor))!.nodes.length,0);
  recover=true;const policy:any=await service.feature(actor),payload={operationId:randomUUID(),expectedRevision:snapshot.runs[0].revision,modelId:"native-agent-fixture",additionalBudgetCents:0,limitsHash:policy.limitsHash};
  await service.resume(actor,run.id,payload);await service.resume(actor,run.id,payload);await service.drive(run.id);
  snapshot=await service.snapshot(actor,session.id);assert.ok(feedbackSeen);assert.equal(snapshot.runs[0].status,"awaiting_approval");assert.equal((await repo.getCanvasForUser(project,actor))!.nodes.length,0);
  const approval=snapshot.approvals.find((a:any)=>a.status==="pending");assert.ok(approval);
  await service.decide(actor,approval.id,{operationId:randomUUID(),expectedRevision:approval.revision,payloadHash:approval.payload_hash,decision:"approve"});await service.drive(run.id);
  assert.equal((await repo.getCanvasForUser(project,actor))!.nodes.length,1);assert.equal((await service.snapshot(actor,session.id)).runs[0].status,"completed");
 }finally{await pool.end();}
});
