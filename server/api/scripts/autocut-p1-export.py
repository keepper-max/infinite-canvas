"""Opt-in export bridge. SDKs live in a separate interpreter; never imports ASR or contacts a model."""
import argparse, json, pathlib, shutil, os, zipfile, io, importlib, math

def duration(c): return round((c['source_out']-c['source_in'])/c['speed'])
def end(c): return c['timeline_start']+duration(c)
def srt_time(ms):
    ms=round(ms);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
def lanes(clips):
    result=[]
    for c in sorted(clips,key=lambda c:c['timeline_start']):
        lane=next((r for r in result if end(r[-1])<=c['timeline_start']),None)
        if lane is None:lane=[];result.append(lane)
        lane.append(c)
    return result

class OtioExporter:
    def export(self,t,media,out,fmt,report):
        import opentimelineio as otio
        fps=t['fps'];rt=lambda ms:otio.opentime.RationalTime(ms*fps/1000,fps)
        timeline=otio.schema.Timeline(name='AutoCut editable project')
        for tr in sorted(t['tracks'],key=lambda x:x['layer']):
            for i,lane in enumerate(lanes(tr['clips'])):
                track=otio.schema.Track(name=tr['name']+f' [{i+1}]',kind=otio.schema.TrackKind.Video if tr['kind']=='video'else otio.schema.TrackKind.Audio)
                cursor=0
                for c in lane:
                    if c['timeline_start']>cursor:track.append(otio.schema.Gap(source_range=otio.opentime.TimeRange(rt(0),rt(c['timeline_start']-cursor))))
                    item=media[c['asset_version_id']]
                    ref=otio.schema.ExternalReference(target_url='file://localhost/__AUTOCUT_ROOT__/'+item['package_path'],available_range=otio.opentime.TimeRange(rt(0),rt(max(item.get('durationMs',0),c['source_out']))))
                    clip=otio.schema.Clip(name=item['name'],media_reference=ref,source_range=otio.opentime.TimeRange(rt(c['source_in']),rt(duration(c))))
                    clip.metadata['autocut']={'source_in_ms':c['source_in'],'source_out_ms':c['source_out'],'timeline_start_ms':c['timeline_start'],'speed':c['speed'],'volume':c['effects']['volume']*tr['volume']*t['audio_settings']['master_volume'],'muted':tr['muted']or c['effects']['muted'],'clip_id':c['id']}
                    if c['speed']!=1:clip.effects.append(otio.schema.LinearTimeWarp(name='AutoCut speed',time_scalar=c['speed']))
                    track.append(clip);cursor=end(c)
                timeline.tracks.append(track)
        for cue in t['subtitles']:
            timeline.tracks.markers.append(otio.schema.Marker(name=cue['text'],marked_range=otio.opentime.TimeRange(rt(cue['start']),rt(cue['end']-cue['start']))))
        timeline.metadata['autocut']={'schema_version':2,'effects':t['effect_stack'],'caption_file':'../subtitles.srt','client_compatibility':'unverified'}
        otio.adapters.write_to_file(timeline,str(out/'project.otio'),'otio_json')
        if fmt=='fcp7':otio.adapters.write_to_file(timeline,str(out/'project.xml'),'fcp_xml')
        report['limitations'] += ['重叠片段拆到独立轨道保留时间位置，转场效果未自动原生映射。','OTIO内保留原始效果元数据，FCP7适配器不保证还原这些效果。','字幕以SRT独立交付，OTIO标记不是原生字幕轨。','音量、静音、变速的目标客户端解释未验证，请核对兼容清单。']

class JianyingDraftExporter:
    module='pyJianYingDraft'
    def export(self,t,media,out,fmt,report):
        sdk=importlib.import_module(self.module)
        w,h=(1280,720)if t['aspect_ratio']=='16:9'else(720,1280)if t['aspect_ratio']=='9:16'else(720,720)
        folder=sdk.DraftFolder(str(out));script=folder.create_draft('draft',w,h,t['fps'],maintrack_adsorb=False,allow_replace=False)
        micro=lambda ms:round(ms*1000)
        for tr in sorted(t['tracks'],key=lambda x:x['layer']):
            for i,lane in enumerate(lanes(tr['clips'])):
                name=f"{tr['name']}-{tr['id']}-{i}";track_ref=script.append_track(sdk.TrackSpec(sdk.TrackType.video if tr['kind']=='video'else sdk.TrackType.audio,name))
                for c in lane:
                    item=media[c['asset_version_id']];target=sdk.trange(micro(c['timeline_start']),micro(duration(c)));source=sdk.trange(micro(c['source_in']),micro(c['source_out']-c['source_in']))
                    if tr['kind']=='video':
                        params=t.get('_native',{}).get(c['id'],[]);v=params[0]['values']if params else{}
                        settings=sdk.ClipSettings(alpha=0 if tr['muted']else v.get('opacity',1),rotation=v.get('rotation',0),scale_x=v.get('scale',1),scale_y=v.get('scale',1),transform_x=v.get('x',0)*2,transform_y=-v.get('y',0)*2)
                        segment=sdk.VideoSegment(item['sdk_source'],target,source_timerange=source,speed=c['speed'],volume=0,clip_settings=settings)
                        mapping={'x':sdk.KeyframeProperty.position_x,'y':sdk.KeyframeProperty.position_y,'scale':sdk.KeyframeProperty.uniform_scale,'rotation':sdk.KeyframeProperty.rotation,'opacity':sdk.KeyframeProperty.alpha}
                        for sample in params:
                            for key,prop in mapping.items():
                                value=(0 if key=='opacity'and tr['muted']else sample['values'][key])*(2 if key=='x'else -2 if key=='y'else 1)
                                segment.add_keyframe(prop,micro(sample['at']-c['timeline_start']),value)
                    else:
                        volume=0 if tr['muted']or c['effects']['muted']else c['effects']['volume']*tr['volume']*t['audio_settings']['master_volume']
                        segment=sdk.AudioSegment(item.get('audio_source')or item['sdk_source'],target,source_timerange=source,speed=c['speed'],volume=volume)
                        incoming=next((e for e in t['effect_stack']if e['enabled']and e['type']=='transition'and e['target'].get('next_id')==c.get('linked_clip_id')),None)
                        outgoing=next((e for e in t['effect_stack']if e['enabled']and e['type']=='transition'and e['target']['id']==c.get('linked_clip_id')),None)
                        if incoming or outgoing:segment.add_fade(micro(incoming['end']-incoming['start'])if incoming else 0,micro(outgoing['end']-outgoing['start'])if outgoing else 0)
                    script.add_segment(segment,track_ref)
        # Independent text lanes permit overlapping subtitles/titles without silently dropping them.
        for i,cue in enumerate(t['subtitles']):
            name=f'caption-{i}';track_ref=script.append_track(sdk.TrackSpec(sdk.TrackType.text,name))
            rgb=tuple(int(cue['color'][j:j+2],16)/255 for j in (1,3,5))
            seg=sdk.TextSegment(cue['text'],sdk.trange(micro(cue['start']),micro(cue['end']-cue['start'])),style=sdk.TextStyle(size=cue['font_size']/3,color=rgb),clip_settings=sdk.ClipSettings(transform_x=cue['x']*2,transform_y=1-2*cue['y']))
            script.add_segment(seg,track_ref)
        script.save()
        report['limitations'] += ['转场的重叠时间保留为分轨素材，但原生转场效果未可靠跨版本映射。','基础画面空间变换/关键帧由SDK生成；缓动降级线性，滤镜、模糊、锐化、字幕动效保留在原工程JSON，未声称原生还原。','字幕字体及排版受本机客户端影响；文字大小映射未客户端验收。','音频自定义增益关键帧保留在AutoCut JSON，SDK工程只映射静态音量与转场原声淡入淡出。']

class CapCutDraftExporter(JianyingDraftExporter):
    module='pycapcut'
    def export(self,*args):
        if os.environ.get('AUTOCUT_P1_CAPCUT_LICENSE_APPROVED')!='true':raise RuntimeError('CapCut dependency license not approved')
        return super().export(*args)

INSTALLER=r'''"""Run only after extracting this package; creates ONE new folder, never scans existing drafts."""
import argparse,pathlib,shutil,json
p=argparse.ArgumentParser();p.add_argument('--destination',required=True);a=p.parse_args();source=pathlib.Path(__file__).resolve().parent;dest=pathlib.Path(a.destination).expanduser().resolve()
if dest.exists():raise SystemExit('Destination exists: choose a NEW draft folder; existing projects are never overwritten')
if not dest.parent.is_dir():raise SystemExit('Destination parent must already exist')
dest.mkdir()
project=source/'project'/'draft'
if not project.exists():project=source/'project'
for item in project.iterdir():
 target=dest/item.name
 if item.is_dir():shutil.copytree(item,target)
 else:shutil.copy2(item,target)
if(source/'media').exists():shutil.copytree(source/'media',dest/'media')
def bind(v):
 if isinstance(v,str):return v.replace('file://localhost/__AUTOCUT_ROOT__',dest.as_uri()).replace('__AUTOCUT_ROOT__',dest.as_posix())
 if isinstance(v,list):return[bind(x)for x in v]
 if isinstance(v,dict):return{k:bind(x)for k,x in v.items()}
 return v
for f in dest.rglob('*'):
 if f.is_file()and f.suffix in ['.json','.otio']:
  f.write_text(json.dumps(bind(json.loads(f.read_text(encoding='utf-8-sig'))),ensure_ascii=False,indent=2),encoding='utf-8')
 elif f.is_file()and f.suffix=='.xml':f.write_text(f.read_text(encoding='utf-8').replace('file://localhost/__AUTOCUT_ROOT__',dest.as_uri()),encoding='utf-8')
print('Created new project folder:',dest)
print('Refresh/import it in the target editor; client compatibility is experimental. No existing draft index was modified.')
'''

class BoundedWriter(io.BufferedIOBase):
    def __init__(self,base,limit):self.base=base;self.limit=limit
    def writable(self):return True
    def seekable(self):return True
    def write(self,data):
        if self.base.tell()+len(data)>self.limit:raise RuntimeError('ZIP exceeds configured size limit')
        return self.base.write(data)
    def seek(self,*args):return self.base.seek(*args)
    def tell(self):return self.base.tell()
    def flush(self):
        if not self.base.closed:self.base.flush()

def main():
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    manifest=json.loads(pathlib.Path(a.input).read_text(encoding='utf-8-sig'));t=manifest['timeline'];fmt=manifest['format'];output=pathlib.Path(a.output);work=output.parent/'export-project';work.mkdir();project=work/'project';project.mkdir();media={};aliases={}
    suffixes={'video/mp4':'.mp4','video/quicktime':'.mov','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','audio/mpeg':'.mp3','audio/mp3':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/mp4':'.m4a','audio/x-m4a':'.m4a'}
    local=output.parent/'export-local-media';local.mkdir()
    for item in manifest['media']:
        item=dict(item);item['package_path']='media/'+item['id']+suffixes[item['mimeType']];alias=local/(item['id']+suffixes[item['mimeType']]);source=pathlib.Path(item['local_source']).resolve()
        if not source.is_file()or source.is_symlink():raise RuntimeError('Invalid provisioned source')
        try:os.link(source,alias)
        except OSError:shutil.copyfile(source,alias)
        item['sdk_source']=str(alias);aliases[str(alias).replace('\\','/')] = '__AUTOCUT_ROOT__/'+item['package_path'];
        if item.get('audio_source'):
            item['audio_package_path']='media/audio-'+item['id']+'.wav';aliases[item['audio_source'].replace('\\','/')] = '__AUTOCUT_ROOT__/'+item['audio_package_path']
        media[item['id']]=item
    report={'format':fmt,'experimental':True,'verifiedClientVersions':[],'sourceRevision':t['revision_id'],'includesMedia':manifest['includeMedia'],'limitations':[],'effectsKeptAsEditableAutocutJson':True}
    if fmt in ['otio','fcp7']:OtioExporter().export(t,media,project,fmt,report)
    elif fmt=='jianying':JianyingDraftExporter().export(t,media,project,fmt,report)
    elif fmt=='capcut':CapCutDraftExporter().export(t,media,project,fmt,report)
    elif fmt!='srt':raise RuntimeError('Unsupported format')
    # Scrub server-local paths from newly generated SDK documents only.
    def scrub(v):
        if isinstance(v,str):
            for src,target in aliases.items():v=v.replace(src,target).replace(src.replace('/','\\'),target)
            return v.replace(str(work),'__AUTOCUT_ROOT__').replace(str(work).replace('\\','/'),'__AUTOCUT_ROOT__')
        if isinstance(v,list):return[scrub(x)for x in v]
        if isinstance(v,dict):return{k:scrub(x)for k,x in v.items()}
        return v
    for f in project.rglob('*.json'):f.write_text(json.dumps(scrub(json.loads(f.read_text(encoding='utf-8-sig'))),ensure_ascii=False,indent=2),encoding='utf-8')
    (work/'timeline.autocut.json').write_text(json.dumps({k:v for k,v in t.items()if k!='_native'},ensure_ascii=False,indent=2),encoding='utf-8')
    (work/'subtitles.srt').write_text('\n'.join(f"{i+1}\n{srt_time(s['start'])} --> {srt_time(s['end'])}\n{s['text']}\n"for i,s in enumerate(sorted(t['subtitles'],key=lambda s:s['start']))),encoding='utf-8-sig')
    (work/'compatibility.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (work/'media-manifest.json').write_text(json.dumps([{k:v for k,v in m.items()if k not in ['local_source','sdk_source','audio_source']}for m in media.values()],ensure_ascii=False,indent=2),encoding='utf-8')
    (work/'install-project.py').write_text(INSTALLER,encoding='utf-8')
    (work/'IMPORT.txt').write_text('实验性工程导出，未进行目标客户端验收。\n先解压到自己的目录，查看 compatibility.json。\n运行 python install-project.py --destination "新的本地工程文件夹" 重关联素材路径；该脚本拒绝覆盖已有目录，不改其他草稿或根索引。\n剪映/CapCut需把新目录放在其认可的草稿位置并刷新，当前版本是否识别尚未验证。\nOTIO/FCP7 XML请在目标软件导入；SRT是独立字幕。未包含素材时需按media-manifest.json手动定位自己的原文件。\n请核对变速、转场、图层、音量、字幕和特殊效果；不要把此导出当成无损转换。',encoding='utf-8')
    with output.open('w+b')as raw:
        with zipfile.ZipFile(BoundedWriter(raw,manifest['maxBytes']),'w',compression=zipfile.ZIP_STORED,allowZip64=True)as archive:
            for file in work.rglob('*'):
                if file.is_file():archive.write(file,str(file.relative_to(work)).replace('\\','/'))
            if manifest['includeMedia']:
                for item in media.values():
                    with pathlib.Path(item['local_source']).open('rb')as src,archive.open(item['package_path'],'w',force_zip64=True)as dst:shutil.copyfileobj(src,dst,1024*1024)
                    if item.get('audio_source'):
                        with pathlib.Path(item['audio_source']).open('rb')as src,archive.open(item['audio_package_path'],'w',force_zip64=True)as dst:shutil.copyfileobj(src,dst,1024*1024)
    print(json.dumps({'format':fmt,'bytes':output.stat().st_size,'experimental':True}))
if __name__=='__main__':main()
