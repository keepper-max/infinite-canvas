import assert from 'node:assert/strict';
import test from 'node:test';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {executeAgentProtocol} from '../src/native-agent/model.js';
import {contextCost} from '../src/native-agent/context.js';
import {PINHAOZHAN_SYSTEM_SUFFIX} from '../src/pinhaozhan.js';

test('actual SDK stream accepts provider system guidance without trusting system roles in user messages',async()=>{
 let dispatched=0;
 const messages=[{role:'user' as const,content:'读取当前画布'}],original=JSON.stringify(messages);
 const provider=createOpenAICompatible({name:'pinhaozhan-protocol-substitute',baseURL:'http://127.0.0.1/v1',fetch:async(_url,init)=>{
  dispatched++;const body=JSON.parse(String(init?.body));
  assert.equal(body.messages[0].role,'system');assert.ok(body.messages[0].content.endsWith(PINHAOZHAN_SYSTEM_SUFFIX));
  assert.equal(body.messages.filter((m:any)=>m.role==='system').length,1);
  assert.equal(body.messages[1].content,messages[0].content);
  assert.deepEqual(body.tools[0].function.parameters.properties,{});
  const event=(delta:unknown,finish_reason:unknown=null,usage?:unknown)=>'data: '+JSON.stringify({id:'synthetic-tool-response',object:'chat.completion.chunk',created:1,model:'synthetic',choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})+'\n\n';
  return new Response(event({role:'assistant'})+event({tool_calls:[{index:0,id:'call-synthetic',type:'function',function:{name:'get_canvas_state',arguments:'{}'}}]})+event({},'tool_calls',{prompt_tokens:100,completion_tokens:10,total_tokens:110})+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 }});
 const execution={mode:'advice' as const,actor:{actorId:'actor',projectId:'project',runId:'run'},stepId:'step',budgetCents:100,toolNames:['get_canvas_state'],readCurrentCanvasOnly:true};
 const result=await executeAgentProtocol(provider('synthetic'),messages,new AbortController().signal,async()=>{},execution,'substitute',PINHAOZHAN_SYSTEM_SUFFIX);
 assert.equal(dispatched,1);assert.deepEqual(result.calls[0].input,{});assert.equal(result.inputTokens,100);assert.equal(JSON.stringify(messages),original);
 assert.ok(contextCost(messages,execution.toolNames,execution,PINHAOZHAN_SYSTEM_SUFFIX)>contextCost(messages,execution.toolNames,execution));
});
