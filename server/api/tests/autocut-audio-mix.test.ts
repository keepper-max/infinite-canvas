import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixtures/autocut.js";
import { applyNarration } from "../src/autocut/narration.js";
import { validateTimeline } from "../src/autocut/contract.js";
import { narrationWindows, originalSoundGain, originalSoundExpression } from "../src/autocut/audio-mix.js";
import { upgradeTimeline, removeClips } from "../src/autocut/p1/runtime.js";
import { validateP1 } from "../src/autocut/p1/contract.js";
import { previewTimeline } from "../src/autocut/p1/preview.js";
import { bakeNarrationMix } from "../src/autocut/p1/audio-export.js";

function setup() {
 const {t,asset,info}=fixture();t.target_duration=6000;t.tracks[0].clips[0].source_in=0;t.tracks[0].clips[0].source_out=6000;
 const processing={asrMs:1,preprocessMs:1,basis:'local_cpu_no_api_charge' as const,asrApiCostCny:0 as const};
 const source={...info,durationMs:6000,processing,transcript:{segments:[{start:1000,end:3000,text:'原片讲话',confidence:null}]}};
 const voice={...asset,id:randomUUID(),assetId:randomUUID(),mimeType:'audio/wav'};
 const voiceInfo={...source,kind:'audio' as const,durationMs:1000,transcript:{segments:[{start:100,end:900,text:'配音',confidence:null}]}};
 return{t,asset,voice,source,voiceInfo,assets:[asset,voice],analyses:{[asset.id]:source,[voice.id]:voiceInfo}};
}

test('Speech avoidance uses exact half-open pauses and shifts real captions without altering its input',()=>{
 const f=setup(),before=structuredClone(f.t);
 const out=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],'preserve-original');
 assert.equal(out.tracks[1].clips[0].timeline_start,0);
 assert.deepEqual(out.subtitles.map(c=>[c.start,c.end,c.text]),[[100,900,'配音'],[1000,3000,'原片讲话']]);
 assert.deepEqual(f.t,before);
 f.voiceInfo.durationMs=1500;
 const later=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],'preserve-original');
 assert.equal(later.tracks[1].clips[0].timeline_start,3000);
 assert.equal(later.subtitles.find(c=>c.text==='配音')!.start,3100);
 assert.equal(originalSoundGain(later,3100),1);
 const bad=structuredClone(later);bad.tracks[1].clips[0].timeline_start=2000;
 assert.throws(()=>validateTimeline(bad,bad.project_id,f.assets,f.analyses),/重叠/);
});

test('Unknown audio is occupied until proven silent; insufficient pauses fail without inventing or slicing speech',()=>{
 const f=setup();delete (f.source as any).processing;f.source.transcript.segments=[];
 assert.throws(()=>applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],'preserve-original'),(e:any)=>e.code==='AUTOCUT_NARRATION_NO_GAP');
 f.source.silences=[{start:2000,end:3500}];
 const out=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],'preserve-original');
 assert.equal(out.tracks[1].clips[0].timeline_start,2000);
 assert.equal(out.tracks[1].clips.length,1);assert.equal(out.tracks[1].clips[0].source_out,1000);
 f.source.silences=[];const muted=applyNarration(f.t,f.assets,f.analyses,0,f.voice,[],'preserve-original');
 assert.equal(muted.tracks[1].clips[0].timeline_start,0);assert.equal(muted.subtitles.length,1);
});

test('Source cuts and additional audio map back to output time before choosing a safe gap',()=>{
 const f=setup(),second={...f.asset,id:randomUUID(),assetId:randomUUID()},extra={...f.voice,id:randomUUID(),assetId:randomUUID()};
 f.t.target_duration=5000;f.t.tracks[0].clips[0].source_in=2000;f.t.tracks[0].clips[0].source_out=4000;
 f.source.transcript.segments=[{start:2500,end:3500,text:'切后讲话',confidence:null}];
 const secondInfo={...f.source,durationMs:10000,transcript:{segments:[{start:7000,end:8000,text:'第二段',confidence:null}]}};
 f.t.tracks[0].clips.push({...f.t.tracks[0].clips[0],id:randomUUID(),asset_id:second.assetId,asset_version_id:second.id,source_in:7000,source_out:10000,timeline_start:2000});
 f.voiceInfo.durationMs=1200;
 const out=applyNarration(f.t,[...f.assets,second],{...f.analyses,[second.id]:secondInfo},1,f.voice,[],'preserve-original');
 assert.equal(out.tracks[1].clips[0].timeline_start,3000);
 const blocked=structuredClone(f.t);blocked.tracks.push({id:randomUUID(),kind:'audio',clips:[{...f.t.tracks[0].clips[0],id:randomUUID(),asset_id:extra.assetId,asset_version_id:extra.id,source_in:0,source_out:2000,timeline_start:3000}]});
 assert.throws(()=>applyNarration(blocked,[...f.assets,second,extra],{...f.analyses,[second.id]:secondInfo,[extra.id]:{...f.voiceInfo,durationMs:2000,processing:undefined,transcript:{segments:[]}}},1,f.voice,[],'preserve-original'),/没有足够/);
});

test('Ducking follows audible narration, restores at the exact end, and never attenuates the voice itself',()=>{
 const f=setup();
 for(const mode of ['narration-first','duck-original'] as const){
  const t=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],mode);t.tracks[1].clips[0].timeline_start=2000;
  assert.equal(originalSoundGain(t,1999),1);assert.equal(originalSoundGain(t,2000),mode==='duck-original'?0.2:0);
  assert.equal(originalSoundGain(t,2999),mode==='duck-original'?0.2:0);assert.equal(originalSoundGain(t,3000),1);
  assert.equal(originalSoundGain(t,2500,f.voice.id),1);assert.ok(!originalSoundExpression(t).includes(f.voice.id));
  t.tracks[1].clips.push({...t.tracks[1].clips[0],id:randomUUID(),timeline_start:2500});
  assert.deepEqual(narrationWindows(t),[{start:2000,end:3500}]);
  t.tracks[1].clips.forEach(c=>c.effects.muted=true);assert.equal(originalSoundGain(t,2500),1);
 }
 const old=setup();assert.equal(originalSoundExpression(old.t),'1');
 const invalid=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],'narration-first');invalid.audio_settings.narration_mix!.asset_version_id=randomUUID();
 assert.throws(()=>validateTimeline(invalid,invalid.project_id,f.assets,f.analyses),/不存在/);
});

test('P1 preview and ordinary native-export clips preserve ducking with no mutation or gain-effect loss',()=>{
 const f=setup(),v=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],'duck-original');v.tracks[1].clips[0].timeline_start=2000;
 const t=upgradeTimeline(v,()=>true),before=structuredClone(t);validateP1(t,t.project_id,f.assets,f.analyses);
 const baked=bakeNarrationMix(t);validateP1(baked,t.project_id,f.assets,f.analyses);
 const original=baked.tracks.find(tr=>tr.id===t.tracks.find(x=>x.role==='original')!.id)!;
 assert.equal(original.role,'music');assert.ok(original.clips.every(c=>!c.linked_clip_id));
 assert.deepEqual(original.clips.map(c=>[c.timeline_start,c.source_in,c.source_out,c.effects.volume]),[[0,0,2000,1],[2000,2000,3000,0.2],[3000,3000,6000,1]]);
 assert.equal(baked.audio_settings.narration_mix,undefined);assert.deepEqual(t,before);
 const preview=previewTimeline(t,t.tracks[0].clips[0].id);assert.equal(originalSoundGain(preview,2500),0.2);
 const removed=removeClips(structuredClone(t),new Set(t.tracks.filter(tr=>tr.kind==='audio').flatMap(tr=>tr.clips.filter(c=>c.asset_version_id===f.voice.id).map(c=>c.id))));
 assert.equal(removed.audio_settings.narration_mix,undefined);validateP1(removed,t.project_id,f.assets,f.analyses);
 const withEffect=structuredClone(t);withEffect.effect_stack.push({id:randomUUID(),version:1,type:'audio',target:{kind:'track',id:original.id},start:0,end:6000,enabled:true,interpolation:'linear',params:{gain:0.5},keyframes:[]});
 assert.throws(()=>bakeNarrationMix(withEffect),/已有音频效果/);
 delete withEffect.audio_settings.narration_mix;assert.equal(bakeNarrationMix(withEffect),withEffect);
});


test('Actual FFmpeg waveform restores original sound and keeps narration in V1, P1 and export representation', {skip:!process.env.AUTOCUT_MEDIA_TEST},async()=>{
 const {mkdir,mkdtemp,readFile}=await import('node:fs/promises'),{join}=await import('node:path');
 const {runMedia,probeMedia,renderTimeline}=await import('../src/autocut/media.js');
 const {renderP1}=await import('../src/autocut/p1/render.js');
 const root=process.env.AUTOCUT_TEST_TEMP_ROOT||'H:/CodexStorage/autocut/audio-avoidance';await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'waveform-'));
 const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',signal=AbortSignal.timeout(120000),source=join(dir,'source.mp4'),voice=join(dir,'voice.wav');
 await runMedia(ffmpeg,['-v','error','-f','lavfi','-i','color=c=black:s=320x180:r=25:d=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx264','-threads','2','-c:a','aac','-y',source],signal);
 await runMedia(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1','-c:a','pcm_s16le','-y',voice],signal);
 const f=setup();f.t.target_duration=3000;f.t.tracks[0].clips[0].source_out=3000;f.source.durationMs=3000;
 const paths={[f.asset.id]:source,[f.voice.id]:voice};
 function tone(bytes:Buffer,start:number,end:number,hz:number){let a=0,b=0;const from=Math.round(start*48000),to=Math.round(end*48000);for(let i=from;i<to;i++){const v=bytes.readInt16LE(i*2)/32768,angle=2*Math.PI*hz*i/48000;a+=v*Math.cos(angle);b+=v*Math.sin(angle)}return 2*Math.hypot(a,b)/(to-from)}
 for(const mode of ['duck-original','narration-first'] as const){
  const t=applyNarration(f.t,f.assets,f.analyses,1,f.voice,[],mode);t.tracks[1].clips[0].timeline_start=1000;t.subtitles=[];
  const p1=upgradeTimeline(t,()=>true),variants=mode==='duck-original'?['v1','p1','export']:['v1'];
  for(const variant of variants){
   const target=join(dir,mode+'-'+variant);await mkdir(target);
   const output=variant==='v1'?await renderTimeline(ffmpeg,t,paths,f.analyses,target,signal):await renderP1(ffmpeg,variant==='export'?bakeNarrationMix(p1):p1,paths,f.analyses,target,signal,true);
   const info=await probeMedia(ffmpeg,output.output,signal);assert.ok(Math.abs(info.durationMs-3000)<80);assert.equal(info.hasAudio,true);
   const pcm=join(target,'output.pcm');await runMedia(ffmpeg,['-v','error','-i',output.output,'-vn','-ac','1','-ar','48000','-f','s16le','-y',pcm],signal);const bytes=await readFile(pcm);
   const before=tone(bytes,.2,.7,440),during=tone(bytes,1.2,1.7,440),after=tone(bytes,2.2,2.7,440),speech=tone(bytes,1.2,1.7,880);
   assert.ok(before>.04,variant+' source missing');assert.ok(Math.abs(after/before-1)<.12,variant+' source failed to recover');
   assert.ok(Math.abs(during/before-(mode==='duck-original'?.2:0))<.07,variant+' wrong ducking gain');
   assert.ok(speech/before>.75,variant+' narration itself was ducked');
   assert.ok(tone(bytes,.2,.7,880)/speech<.05,variant+' narration played too early');
  }
 }
});
