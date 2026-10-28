import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { applyNarration } from "../src/autocut/narration.js";
import { fixture } from "./fixtures/autocut.js";

test("Narration preserves measured audio and captions; original volume is explicit and input immutable", () => {
 const { t,asset,info,analyses }=fixture(),voice={...asset,id:randomUUID(),assetId:randomUUID(),mimeType:'audio/wav'};
 const voiceInfo={...info,kind:'audio' as const,durationMs:1000,transcript:{segments:[{start:50,end:950,text:'真实识别',confidence:null}]}};
 const all={...analyses,[voice.id]:voiceInfo},before=structuredClone(t);
 for(const volume of [0,0.2,1]){
  const out=applyNarration(t,[asset,voice],all,volume,voice);
  assert.equal(out.tracks[0].clips[0].effects.volume,volume);
  assert.equal(out.tracks[0].clips[0].effects.muted,volume===0);
  assert.equal(out.tracks[1].clips[0].source_out,1000);
  assert.equal(out.subtitles[0].start,50);assert.equal(out.subtitles[0].end,950);
  assert.equal(out.subtitles[0].text,'真实识别');
 }
 assert.deepEqual(t,before);
 assert.deepEqual(applyNarration(t,[asset],analyses),t);
 const old=applyNarration(t,[asset,voice],all,1,voice);
 const next=applyNarration(old,[asset,voice],all,1,voice,[voice.id]);
 assert.equal(next.tracks.filter(t=>t.kind==='audio').length,1);
});

test("Narration cannot exceed actual picture or fabricate speech duration",()=>{
 const {t,asset,info,analyses}=fixture(),voice={...asset,id:randomUUID(),assetId:randomUUID(),mimeType:'audio/wav'};
 for(const durationMs of [0,2001])assert.throws(()=>applyNarration(t,[asset,voice],{...analyses,[voice.id]:{...info,kind:'audio',durationMs}},1,voice));
 assert.throws(()=>applyNarration(t,[asset,voice],{...analyses,[voice.id]:{...info,kind:'video'}},1,voice));
});
