import { useState, type PointerEvent } from "react";
import { Button, Slider, theme } from "antd";
import { Magnet, ZoomIn, ZoomOut } from "lucide-react";
import { clipEnd, clipDuration, reflow, shiftEffects, type P1Timeline, type P1Clip } from "./model";

export function Timeline({
    document: t,
    time,
    selected,
    select,
    seek,
    change,
    thumbnails,
}: {
    document: P1Timeline;
    time: number;
    selected: string[];
    select: (ids: string[]) => void;
    seek: (ms: number) => void;
    change: (t: P1Timeline) => void;
    thumbnails: Record<string, string>;
}) {
    const { token } = theme.useToken(),
        [zoom, setZoom] = useState(35),
        [snap, setSnap] = useState(true);
    const width = Math.max(900, (t.target_duration / 1000) * zoom + 120),
        label = 132;
    function drag(event: PointerEvent, clip: P1Clip, mode: "move" | "left" | "right") {
        event.stopPropagation();
        if (event.button !== 0) return;
        select(event.shiftKey ? [...new Set([...selected, clip.id])] : [clip.id]);
        const origin = event.clientX,
            base = structuredClone(t),
            tr = base.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id))!;
        // Linked original sound follows its picture; unlink explicitly in the inspector first.
        if (clip.linked_clip_id) return;
        const targets = [0, time, ...t.tracks.flatMap((tr) => tr.clips.flatMap((c) => [c.timeline_start, clipEnd(c)]))];
        let next = base,
            moved = false;
        const align = (v: number) => (snap ? (targets.find((p) => Math.abs(v - p) < 7000 / zoom) ?? v) : v);
        function move(e: globalThis.PointerEvent) {
            const delta = Math.round(((e.clientX - origin) / zoom) * 1000);
            if (Math.abs(e.clientX - origin) < 3) return;
            moved = true;
            next = structuredClone(base);
            const track = next.tracks.find((x) => x.id === tr.id)!,
                c = track.clips.find((c) => c.id === clip.id)!;
            if (mode === "left") c.source_in = Math.round(Math.max(0, Math.min(c.source_out - Math.ceil(c.speed), clip.source_in + delta * c.speed)));
            else if (mode === "right") c.source_out = Math.max(c.source_in + 1, Math.round(clip.source_out + delta * c.speed));
            else if (track.role === "main") {
                const at = align(Math.max(0, clip.timeline_start + delta));
                track.clips = track.clips.filter((c) => c.id !== clip.id);
                const i = track.clips.findIndex((c) => at < c.timeline_start + clipDuration(c) / 2);
                track.clips.splice(i < 0 ? track.clips.length : i, 0, c);
                next.effect_stack = next.effect_stack.filter((e) => e.type !== "transition" || track.clips.some((c, i) => c.id === e.target.id && track.clips[i + 1]?.id === e.target.next_id));
            } else {
                c.timeline_start = Math.round(align(Math.max(0, Math.min(t.target_duration - clipDuration(c), clip.timeline_start + delta))));
                shiftEffects(next, c.id, c.timeline_start - clip.timeline_start);
            }
            if (track.role === "main") reflow(next, base);
            // One history entry per gesture; the ghost shows the tentative position until release.
            setGhost(next);
        }
        function end() {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", cancel);
            setGhost(null);
            if (moved) change(next);
        }
        function cancel() {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", cancel);
            setGhost(null);
        }
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end, { once: true });
        window.addEventListener("pointercancel", cancel, { once: true });
    }
    const [ghost, setGhost] = useState<P1Timeline | null>(null),
        doc = ghost ?? t;
    const step = zoom > 70 ? 1000 : zoom > 25 ? 5000 : 10000;
    return (
        <section className="flex min-h-0 flex-col border-t" style={{ borderColor: token.colorBorderSecondary }}>
            <div className="flex items-center justify-between px-4 py-1">
                <span className="text-xs opacity-60">时间线 · 拖动片段排序 / 两端裁剪 · Shift 多选</span>
                <div className="flex w-64 items-center gap-2">
                    <Button type="text" size="small" icon={<Magnet size={14} />} aria-label="磁吸" aria-pressed={snap} onClick={() => setSnap(!snap)} style={{ color: snap ? token.colorPrimary : undefined }} />
                    <ZoomOut size={14} />
                    <Slider className="flex-1" min={10} max={150} value={zoom} onChange={setZoom} />
                    <ZoomIn size={14} />
                </div>
            </div>
            <div className="relative flex-1 overflow-auto" style={{ maxHeight: 320 }}>
                <div style={{ width: width + label, position: "relative" }}>
                    <div
                        className="sticky top-0 z-20 h-8 cursor-crosshair"
                        style={{ marginLeft: label, width, background: token.colorBgContainer }}
                        onPointerDown={(e) => seek(Math.round(Math.max(0, Math.min(t.target_duration, ((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * 1000))))}
                    >
                        {Array.from({ length: Math.ceil(t.target_duration / step) + 1 }, (_, i) => (
                            <span key={i} className="absolute border-l pl-1 text-[10px] opacity-60" style={{ left: ((i * step) / 1000) * zoom, borderColor: token.colorBorder }}>
                                {((i * step) / 1000).toFixed(0)}s
                            </span>
                        ))}
                    </div>
                    {doc.tracks.map((tr) => (
                        <div key={tr.id} className="relative flex h-16 border-b" style={{ borderColor: token.colorBorderSecondary }}>
                            <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 px-2 text-xs" style={{ width: label, background: token.colorBgContainer }}>
                                <span className="flex-1 truncate">{tr.name}</span>
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label={`${tr.muted ? "启用" : "静音"}${tr.name}`}
                                    onClick={() => {
                                        const n = structuredClone(t);
                                        n.tracks.find((x) => x.id === tr.id)!.muted = !tr.muted;
                                        change(n);
                                    }}
                                >
                                    {tr.muted ? "关" : "开"}
                                </Button>
                            </div>
                            <div
                                style={{ width, position: "relative" }}
                                onPointerDown={(e) => {
                                    if (e.target === e.currentTarget) seek(Math.round(Math.max(0, Math.min(t.target_duration, ((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom) * 1000))));
                                }}
                            >
                                {tr.clips.map((c) => (
                                    <div
                                        key={c.id}
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`选择片段 ${c.id}`}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") select([c.id]);
                                        }}
                                        onPointerDown={(e) => drag(e, c, "move")}
                                        className="absolute top-2 flex h-12 cursor-grab items-center overflow-hidden rounded border px-2 text-xs select-none"
                                        style={{
                                            left: (c.timeline_start / 1000) * zoom,
                                            width: Math.max(8, (clipDuration(c) / 1000) * zoom),
                                            borderColor: selected.includes(c.id) ? token.colorPrimary : token.colorBorder,
                                            backgroundColor: tr.kind === "audio" ? token.colorSuccessBg : token.colorFillSecondary,
                                            backgroundImage: thumbnails[c.asset_version_id] ? `linear-gradient(transparent,${token.colorBgContainer}),url("${thumbnails[c.asset_version_id]}")` : undefined,
                                            backgroundSize: "auto 100%",
                                        }}
                                    >
                                        <span className="truncate">
                                            {tr.kind === "audio" ? "♫" : "▶"} {(clipDuration(c) / 1000).toFixed(1)}s · {c.speed}×
                                        </span>
                                        <span role="slider" aria-label="裁剪起点" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" style={{ background: token.colorPrimary, opacity: 0.45 }} onPointerDown={(e) => drag(e, c, "left")} />
                                        <span role="slider" aria-label="裁剪终点" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" style={{ background: token.colorPrimary, opacity: 0.45 }} onPointerDown={(e) => drag(e, c, "right")} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div className="relative flex h-12">
                        <div className="sticky left-0 z-10 shrink-0 px-3 py-3 text-xs" style={{ width: label, background: token.colorBgContainer }}>
                            字幕 / 标题
                        </div>
                        <div style={{ position: "relative", width }}>
                            {doc.subtitles.map((s) => (
                                <button
                                    key={s.id}
                                    className="absolute top-2 h-7 overflow-hidden rounded border px-1 text-left text-[10px] whitespace-nowrap"
                                    style={{ left: (s.start / 1000) * zoom, width: Math.max(6, ((s.end - s.start) / 1000) * zoom), borderColor: selected.includes(s.id) ? token.colorPrimary : token.colorBorder, background: token.colorWarningBg }}
                                    onClick={() => {
                                        select([s.id]);
                                        seek(s.start);
                                    }}
                                >
                                    {s.text}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="pointer-events-none absolute inset-y-0 z-30 border-l" style={{ left: label + (time / 1000) * zoom, borderColor: token.colorError }} />
                </div>
            </div>
        </section>
    );
}
