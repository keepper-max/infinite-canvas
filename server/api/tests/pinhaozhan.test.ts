import assert from "node:assert/strict";
import test from "node:test";
import { pinhaozhanPrice, pinhaozhanReceipt, pinhaozhanMessages } from "../src/pinhaozhan.js";
import { currentCanvasProbeSchema } from "../src/native-agent/tools.js";
test("provider guidance keeps original messages immutable and never accepts wrapped tool arguments",()=>{
  const source=[{role:"user" as const,content:"读取当前画布"}];
  const before=JSON.stringify(source),messages=pinhaozhanMessages(source);
  assert.equal(JSON.stringify(source),before);assert.equal(messages[0].role,"system");assert.equal(messages[1],source[0]);
  assert.equal(currentCanvasProbeSchema.safeParse({parameters:{}}).success,false);
  assert.equal(currentCanvasProbeSchema.safeParse({}).success,true);
});
const pricing = () => ({success:true, group_ratio:{default:1}, data:[{model_name:"deepseek-v4.1-flash",quota_type:0,model_ratio:0.006849,completion_ratio:4,enable_groups:["default"]}]});
const ledger = () => ({success:true,data:[{request_id:"exact",type:2,model_name:"deepseek-v4.1-flash",quota:3,prompt_tokens:311,completion_tokens:33}]});
test("New API preflight bounds the full context and output in platform points",()=>{assert.equal(pinhaozhanPrice(pricing(),7.3,12,12000,2000).maximumPoints,1);});
test("unknown or increased pricing blocks dispatch",()=>{for(const p of [{}, {...pricing(),group_ratio:{}}, {...pricing(),data:[{...pricing().data[0],model_ratio:1000}]}, {...pricing(),data:[{...pricing().data[0],enable_groups:["auto"]}]}])assert.throws(()=>pinhaozhanPrice(p,7.3,12,12000,2000));});
test("billing binds actual quota to exact provider request, model and tokens",()=>{assert.equal(pinhaozhanReceipt(ledger(),"exact",311,33).amountUsd,"0.000006"); for(const [id,p,c] of [["other",311,33],["exact",310,33],["exact",311,34]] as const)assert.throws(()=>pinhaozhanReceipt(ledger(),id,p,c));});
test("missing, duplicate, malformed or unrelated receipts never imply free usage",()=>{for(const data of [[],[...ledger().data,...ledger().data],[{...ledger().data[0],quota:-1}],[{...ledger().data[0],model_name:"other"}]])assert.throws(()=>pinhaozhanReceipt({success:true,data},"exact",311,33));});
