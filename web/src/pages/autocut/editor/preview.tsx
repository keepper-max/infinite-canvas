import { originalSoundGain } from "../../../../../server/api/src/autocut/audio-mix";
import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";
import { Play, Pause } from "lucide-react";
import { primary, clipEnd, frameValues, dimensions, type P1Timeline, type P1Clip, type P1Track } from "./model";

type Video = { element: HTMLVideoElement; clip: P1Clip };
type Sound = { element: HTMLAudioElement; gain: GainNode };
export function SourcePreview({ timeline, time, playing, onTime, onPlaying, mimeTypes }: { timeline: P1Timeline; time: number; playing: boolean; onTime: (ms: number) => void; onPlaying: (v: boolean) => void; mimeTypes: Record<string, string> }) {
    const canvas = useRef<HTMLCanvasElement>(null),
        videos = useRef(new Map<string, Video>()),
        sounds = useRef(new Map<string, Sound>()),
        audio = useRef<AudioContext | null>(null),
        state = useRef({ timeline, time, playing }),
        [buffering, setBuffering] = useState(false),
        [error, setError] = useState("");
    state.current = { timeline, time, playing };
    useEffect(() => {
        let running = true,
            last = performance.now(),
            raf = 0;
        const size = dimensions(timeline.aspect_ratio);
        const scratch = [document.createElement("canvas"), document.createElement("canvas")];
        scratch.forEach((c) => {
            c.width = size.width;
            c.height = size.height;
        });
        function syncVideo(c: P1Clip, at: number, play: boolean) {
            let v = videos.current.get(c.id);
            if (!v) {
                const e = document.createElement("video");
                e.src = `/api/media/asset-versions/${c.asset_version_id}`;
                e.muted = true;
                e.playsInline = true;
                e.preload = "auto";
                v = { element: e, clip: c };
                videos.current.set(c.id, v);
            }
            const e = v.element;
            e.playbackRate = c.speed;
            const target = (c.source_in + (at - c.timeline_start) * c.speed) / 1000;
            if (Math.abs(e.currentTime - target) > (play ? 0.08 : 0.02) && !e.seeking) e.currentTime = Math.max(0, target);
            if (play) e.play().catch(() => {});
            else e.pause();
            return e;
        }
        const images = new Map<string, HTMLImageElement>();
        function drawClip(ctx: CanvasRenderingContext2D, c: P1Clip, tr: P1Track, at: number) {
            const mime = mimeTypes[c.asset_version_id];
            let source: CanvasImageSource;
            let iw = 0,
                ih = 0;
            if (mime?.startsWith("image/")) {
                let image = images.get(c.asset_version_id);
                if (!image) {
                    image = new Image();
                    image.src = `/api/media/asset-versions/${c.asset_version_id}`;
                    images.set(c.asset_version_id, image);
                }
                if (!image.complete || !image.naturalWidth) return false;
                source = image;
                iw = image.naturalWidth;
                ih = image.naturalHeight;
            } else {
                const v = syncVideo(c, at, state.current.playing);
                if (v.readyState < 2 || v.seeking) return false;
                source = v;
                iw = v.videoWidth;
                ih = v.videoHeight;
            }
            const p = frameValues(state.current.timeline, c, tr, at),
                fit = Math.min(size.width / iw, size.height / ih);
            ctx.save();
            ctx.translate(size.width / 2 + p.x * size.width, size.height / 2 + p.y * size.height);
            ctx.rotate((p.rotation * Math.PI) / 180);
            ctx.scale(p.scale, p.scale);
            ctx.globalAlpha = p.opacity;
            ctx.filter = `brightness(${Math.max(0, 1 + p.brightness)}) contrast(${p.contrast}) saturate(${p.saturation}) blur(${p.blur}px)`;
            ctx.drawImage(source, (-iw * fit) / 2, (-ih * fit) / 2, iw * fit, ih * fit);
            ctx.restore();
            return true;
        }
        function tick(now: number) {
            if (!running) return;
            const s = state.current,
                t = s.timeline,
                cx = canvas.current?.getContext("2d");
            if (!cx) {
                raf = requestAnimationFrame(tick);
                return;
            }
            const dt = Math.min(100, now - last);
            last = now;
            const main = primary(t),
                active = main.clips.filter((c) => c.timeline_start <= s.time && clipEnd(c) > s.time),
                live = new Set<string>();
            let ready = true;
            cx.fillStyle = "#000";
            cx.fillRect(0, 0, size.width, size.height);
            const rendered = active.map((c, i) => {
                live.add(c.id);
                const sc = scratch[i % 2],
                    ct = sc.getContext("2d")!;
                ct.fillStyle = "#000";
                ct.fillRect(0, 0, size.width, size.height);
                if (!main.muted) ready = drawClip(ct, c, main, s.time) && ready;
                return sc;
            });
            if (active.length === 2) {
                const edge = t.effect_stack.find((e) => e.enabled && e.type === "transition" && e.target.id === active[0].id && e.target.next_id === active[1].id),
                    p = edge ? Math.max(0, Math.min(1, (s.time - edge.start) / (edge.end - edge.start))) : 1,
                    style = edge?.params.style;
                if (style?.startsWith("slide")) {
                    const sign = style === "slideleft" ? -1 : 1;
                    cx.drawImage(rendered[0], sign * p * size.width, 0);
                    cx.drawImage(rendered[1], -sign * (1 - p) * size.width, 0);
                } else if (style?.startsWith("wipe")) {
                    cx.drawImage(rendered[0], 0, 0);
                    cx.save();
                    cx.beginPath();
                    cx.rect(style === "wipeleft" ? size.width * (1 - p) : 0, 0, size.width * p, size.height);
                    cx.clip();
                    cx.drawImage(rendered[1], 0, 0);
                    cx.restore();
                } else {
                    cx.save();
                    cx.globalCompositeOperation = "lighter";
                    cx.globalAlpha = style === "fadeblack" || style === "fade" ? Math.max(0, 1 - 2 * p) : 1 - p;
                    cx.drawImage(rendered[0], 0, 0);
                    cx.globalAlpha = style === "fadeblack" || style === "fade" ? Math.max(0, 2 * p - 1) : p;
                    cx.drawImage(rendered[1], 0, 0);
                    cx.restore();
                }
            } else if (rendered[0]) cx.drawImage(rendered[0], 0, 0);
            for (const tr of t.tracks.filter((tr) => tr.role === "overlay" && !tr.muted).sort((a, b) => a.layer - b.layer))
                for (const c of tr.clips)
                    if (c.timeline_start <= s.time && clipEnd(c) > s.time) {
                        live.add(c.id);
                        ready = drawClip(cx, c, tr, s.time) && ready;
                    }
            for (const [id, v] of videos.current)
                if (!live.has(id)) {
                    v.element.pause();
                    v.element.removeAttribute("src");
                    v.element.load();
                    videos.current.delete(id);
                }
            for (const cue of [...t.subtitles].sort((a, b) => a.layer - b.layer))
                if (cue.start <= s.time && cue.end > s.time) {
                    const p = frameValues(t, cue, undefined, s.time);
                    cx.save();
                    cx.globalAlpha = p.opacity;
                    cx.font = `${cue.font_size * p.scale}px "WenQuanYi Zen Hei", "Microsoft YaHei", sans-serif`;
                    cx.textAlign = "center";
                    cx.textBaseline = "top";
                    cx.lineWidth = 3;
                    cx.strokeStyle = "#000";
                    cx.fillStyle = cue.color;
                    const x = size.width / 2 + (cue.x + p.x) * size.width,
                        y = (cue.y + p.y) * size.height;
                    cue.text.split("\n").forEach((text, i) => {
                        cx.strokeText(text, x, y + i * cue.font_size * 1.2);
                        cx.fillText(text, x, y + i * cue.font_size * 1.2);
                    });
                    cx.restore();
                }
            const heard = new Set<string>();
            if (s.playing && ready && audio.current)
                for (const tr of t.tracks.filter((tr) => tr.kind === "audio" && !tr.muted))
                    for (const c of tr.clips)
                        if (!c.effects.muted && c.timeline_start <= s.time && clipEnd(c) > s.time) {
                            heard.add(c.id);
                            let sound = sounds.current.get(c.id);
                            if (!sound) {
                                const el = new Audio(`/api/media/asset-versions/${c.asset_version_id}`),
                                    gain = audio.current.createGain();
                                audio.current.createMediaElementSource(el).connect(gain);
                                gain.connect(audio.current.destination);
                                sound = { element: el, gain };
                                sounds.current.set(c.id, sound);
                            }
                            const el = sound.element,
                                target = (c.source_in + (s.time - c.timeline_start) * c.speed) / 1000;
                            el.playbackRate = c.speed;
                            el.preservesPitch = true;
                            if (Math.abs(el.currentTime - target) > 0.08 && !el.seeking) el.currentTime = target;
                            const p = frameValues(t, c, tr, s.time);
                            let fade = 1;
                            if (tr.role === "original")
                                for (const e of t.effect_stack.filter((e) => e.enabled && e.type === "transition")) {
                                    if (e.target.next_id === c.linked_clip_id) fade *= Math.min(1, Math.max(0, (s.time - e.start) / (e.end - e.start)));
                                    if (e.target.id === c.linked_clip_id) fade *= Math.min(1, Math.max(0, (e.end - s.time) / (e.end - e.start)));
                                }
                            sound.gain.gain.value = c.effects.volume * tr.volume * t.audio_settings.master_volume * p.gain * fade * originalSoundGain(t, s.time, c.asset_version_id);
                            el.play().catch(() => setError("原声播放被浏览器阻止，请再次点击播放"));
                        }
            for (const [id, v] of sounds.current)
                if (!heard.has(id)) {
                    v.element.pause();
                    v.gain.disconnect();
                    v.element.removeAttribute("src");
                    v.element.load();
                    sounds.current.delete(id);
                }
            setBuffering(!ready);
            if (s.playing && ready) {
                const next = s.time + dt;
                if (next >= t.target_duration) {
                    onTime(t.target_duration);
                    onPlaying(false);
                } else onTime(next);
            }
            raf = requestAnimationFrame(tick);
        }
        raf = requestAnimationFrame(tick);
        return () => {
            running = false;
            cancelAnimationFrame(raf);
            for (const v of videos.current.values()) {
                v.element.pause();
                v.element.removeAttribute("src");
                v.element.load();
            }
            videos.current.clear();
            for (const v of sounds.current.values()) {
                v.element.pause();
                v.gain.disconnect();
                v.element.removeAttribute("src");
                v.element.load();
            }
            sounds.current.clear();
        };
    }, [timeline.aspect_ratio, onTime, onPlaying, mimeTypes]);
    useEffect(
        () => () => {
            void audio.current?.close();
        },
        [],
    );
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                <canvas ref={canvas} {...dimensions(timeline.aspect_ratio)} className="max-h-full max-w-full object-contain" aria-label="源素材实时预览" />
                {buffering && <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs text-white">定位源画面…</span>}
            </div>
            <div className="flex items-center justify-center gap-4 py-2">
                <Button
                    type="text"
                    aria-label={playing ? "暂停预览" : "播放预览"}
                    icon={playing ? <Pause size={16} /> : <Play size={16} />}
                    onClick={() => {
                        if (!playing) {
                            audio.current ??= new AudioContext();
                            void audio.current.resume();
                            if (time >= timeline.target_duration) onTime(0);
                        }
                        onPlaying(!playing);
                    }}
                />
                <span className="font-mono text-xs">
                    {(time / 1000).toFixed(2)} / {(timeline.target_duration / 1000).toFixed(2)} 秒
                </span>
                <span className="text-xs opacity-55">源素材预览 · 字体 / 滤镜近似，导出前请核对</span>
            </div>
            {error && <Alert type="warning" message={error} closable onClose={() => setError("")} />}
        </div>
    );
}
