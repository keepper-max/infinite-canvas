import { Button, Input, InputNumber, Select, Switch, theme } from "antd";
import { Plus, Trash2, Diamond } from "lucide-react";
import { clipEnd, primary, reflow, setTransition, uid, effectValues, type P1Timeline, type Effect, type EffectValues, type Curve, type TransitionStyle } from "./model";

const names: Record<string, string> = { x: "水平位置", y: "垂直位置", scale: "缩放", rotation: "旋转", opacity: "透明度", brightness: "亮度", contrast: "对比度", saturation: "饱和度", blur: "模糊", sharpen: "锐化", gain: "音量增益" };
const curves: Curve[] = ["linear", "easeIn", "easeOut", "easeInOut", "hold"];
const ranges: Record<string, [number, number, number]> = {
    x: [-1, 1, 0.01],
    y: [-1, 1, 0.01],
    scale: [0.1, 4, 0.01],
    rotation: [-360, 360, 1],
    opacity: [0, 1, 0.01],
    brightness: [-1, 1, 0.01],
    contrast: [0, 3, 0.01],
    saturation: [0, 3, 0.01],
    blur: [0, 20, 0.1],
    sharpen: [0, 2, 0.1],
    gain: [0, 2, 0.01],
};
export function Inspector({ document: t, selected, time, change }: { document: P1Timeline; selected: string[]; time: number; change: (t: P1Timeline) => void }) {
    const { token } = theme.useToken(),
        clip = t.tracks.flatMap((tr) => tr.clips).find((c) => c.id === selected[0]),
        track = t.tracks.find((tr) => tr.clips.some((c) => c.id === clip?.id)),
        cue = t.subtitles.find((s) => s.id === selected[0]);
    const mutate = (fn: (n: P1Timeline) => void) => {
        const n = structuredClone(t);
        fn(n);
        change(n);
    };
    const field = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void) => (
        <label key={label} className="flex items-center justify-between gap-2 py-1 text-xs">
            <span>{label}</span>
            <InputNumber
                size="small"
                style={{ width: 104 }}
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(v) => {
                    if (v !== null) set(v);
                }}
            />
        </label>
    );
    function add(type: Effect["type"]) {
        if (!clip && !cue) return;
        const start = clip?.timeline_start ?? cue!.start,
            end = clip ? clipEnd(clip) : cue!.end;
        mutate((n) =>
            n.effect_stack.push({
                id: uid(),
                version: 1,
                type,
                target: { kind: clip ? "clip" : "subtitle", id: clip?.id ?? cue!.id },
                start,
                end,
                enabled: true,
                interpolation: "linear",
                params: type === "audio" ? { gain: 1 } : type === "filter" ? { brightness: 0, contrast: 1, saturation: 1, blur: 0, sharpen: 0 } : { x: 0, y: 0, scale: 1, ...(!cue ? { rotation: 0 } : {}), opacity: 1 },
                keyframes: [],
            }),
        );
    }
    const effects = t.effect_stack.filter((e) => e.target.id === (clip?.id ?? cue?.id) && e.type !== "transition");
    return (
        <aside className="h-full overflow-y-auto p-4">
            <h2 className="mb-4 text-sm font-medium">属性与效果</h2>
            {!clip && !cue ? (
                <p className="text-xs opacity-50">选择片段或字幕后开始精修</p>
            ) : (
                <>
                    {clip && track && (
                        <>
                            <div className="mb-3 truncate text-xs opacity-50">
                                {track.name} · {clip.id.slice(0, 8)}
                            </div>
                            {clip.linked_clip_id ? (
                                <Button
                                    size="small"
                                    onClick={() =>
                                        mutate((n) => {
                                            delete n.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)!.linked_clip_id;
                                        })
                                    }
                                >
                                    解除原声联动
                                </Button>
                            ) : (
                                <>
                                    {field("源起点 / 秒", clip.source_in / 1000, 0, clip.source_out / 1000 - 0.001, 0.01, (v) =>
                                        mutate((n) => {
                                            n.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)!.source_in = Math.round(v * 1000);
                                            reflow(n, t);
                                        }),
                                    )}
                                    {field("源终点 / 秒", clip.source_out / 1000, clip.source_in / 1000 + 0.001, 1800, 0.01, (v) =>
                                        mutate((n) => {
                                            n.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)!.source_out = Math.round(v * 1000);
                                            reflow(n, t);
                                        }),
                                    )}
                                    {field("速度", clip.speed, 0.25, 4, 0.05, (v) =>
                                        mutate((n) => {
                                            n.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)!.speed = v;
                                            reflow(n, t);
                                        }),
                                    )}
                                </>
                            )}
                            {track.kind === "audio" && (
                                <>
                                    {field("音量", clip.effects.volume, 0, 2, 0.05, (v) =>
                                        mutate((n) => {
                                            n.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)!.effects.volume = v;
                                        }),
                                    )}
                                    <label className="my-2 flex justify-between text-xs">
                                        静音
                                        <Switch
                                            size="small"
                                            checked={clip.effects.muted}
                                            onChange={(v) =>
                                                mutate((n) => {
                                                    n.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id)!.effects.muted = v;
                                                })
                                            }
                                        />
                                    </label>
                                </>
                            )}
                            {track.role === "main" && primary(t).clips.some((c, i, a) => c.id === clip.id && i < a.length - 1) && (
                                <div className="my-4 space-y-2">
                                    <span className="text-xs">与下一镜头转场</span>
                                    <Select
                                        className="w-full"
                                        value={t.effect_stack.find((e) => e.type === "transition" && e.target.id === clip.id)?.params.style ?? "cut"}
                                        options={(
                                            [
                                                ["cut", "硬切"],
                                                ["dissolve", "叠化"],
                                                ["fadeblack", "淡入黑场"],
                                                ["slideleft", "向左滑动"],
                                                ["slideright", "向右滑动"],
                                                ["wipeleft", "向左擦除"],
                                                ["wiperight", "向右擦除"],
                                            ] as const
                                        ).map(([value, label]) => ({ value, label }))}
                                        onChange={(v) => {
                                            const a = primary(t).clips,
                                                i = a.findIndex((c) => c.id === clip.id);
                                            change(setTransition(structuredClone(t), clip.id, a[i + 1].id, v as TransitionStyle, 400));
                                        }}
                                    />
                                    {t.effect_stack
                                        .filter((e) => e.type === "transition" && e.target.id === clip.id)
                                        .map((edge) =>
                                            field(
                                                "转场时长 / 秒",
                                                (edge.end - edge.start) / 1000,
                                                0.001,
                                                Math.min(
                                                    clipEnd(clip) - clip.timeline_start,
                                                    clipEnd(primary(t).clips[primary(t).clips.findIndex((c) => c.id === clip.id) + 1]) - primary(t).clips[primary(t).clips.findIndex((c) => c.id === clip.id) + 1].timeline_start,
                                                ) / 2000,
                                                0.01,
                                                (v) => change(setTransition(structuredClone(t), clip.id, edge.target.next_id!, edge.params.style!, Math.round(v * 1000))),
                                            ),
                                        )}
                                </div>
                            )}
                        </>
                    )}
                    {cue && (
                        <>
                            <Input.TextArea
                                aria-label="字幕文字"
                                value={cue.text}
                                onChange={(e) =>
                                    mutate((n) => {
                                        n.subtitles.find((s) => s.id === cue.id)!.text = e.target.value;
                                    })
                                }
                            />
                            {field("开始 / 秒", cue.start / 1000, 0, cue.end / 1000 - 0.001, 0.01, (v) =>
                                mutate((n) => {
                                    const s = n.subtitles.find((s) => s.id === cue.id)!;
                                    s.start = Math.round(v * 1000);
                                    delete s.anchor;
                                }),
                            )}
                            {field("结束 / 秒", cue.end / 1000, cue.start / 1000 + 0.001, t.target_duration / 1000, 0.01, (v) =>
                                mutate((n) => {
                                    const s = n.subtitles.find((s) => s.id === cue.id)!;
                                    s.end = Math.round(v * 1000);
                                    delete s.anchor;
                                }),
                            )}
                            {field("字号", cue.font_size, 8, 120, 1, (v) =>
                                mutate((n) => {
                                    n.subtitles.find((s) => s.id === cue.id)!.font_size = v;
                                }),
                            )}
                            {field("水平位置", cue.x, -1, 1, 0.01, (v) =>
                                mutate((n) => {
                                    n.subtitles.find((s) => s.id === cue.id)!.x = v;
                                }),
                            )}
                            {field("垂直位置", cue.y, -1, 1, 0.01, (v) =>
                                mutate((n) => {
                                    n.subtitles.find((s) => s.id === cue.id)!.y = v;
                                }),
                            )}
                            <input
                                type="color"
                                aria-label="字幕颜色"
                                value={cue.color}
                                onChange={(e) =>
                                    mutate((n) => {
                                        n.subtitles.find((s) => s.id === cue.id)!.color = e.target.value;
                                    })
                                }
                            />
                        </>
                    )}
                    <div className="my-4 flex flex-wrap gap-2">
                        {track?.kind === "audio" ? (
                            <Button size="small" icon={<Plus size={12} />} onClick={() => add("audio")}>
                                音量效果
                            </Button>
                        ) : (
                            <>
                                <Button size="small" onClick={() => add("transform")}>
                                    变换 / 运镜
                                </Button>
                                <Button size="small" onClick={() => add("animation")}>
                                    关键帧动画
                                </Button>
                                {!cue && (
                                    <Button size="small" onClick={() => add("filter")}>
                                        调色 / 滤镜
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                    {effects.map((effect) => (
                        <div key={effect.id} className="mb-3 rounded border p-3" style={{ borderColor: token.colorBorderSecondary }}>
                            <div className="mb-2 flex items-center gap-2 text-xs">
                                <Switch
                                    size="small"
                                    checked={effect.enabled}
                                    onChange={(v) =>
                                        mutate((n) => {
                                            n.effect_stack.find((e) => e.id === effect.id)!.enabled = v;
                                        })
                                    }
                                />
                                <span className="flex-1">{effect.type}</span>
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label="删除效果"
                                    icon={<Trash2 size={12} />}
                                    onClick={() =>
                                        mutate((n) => {
                                            n.effect_stack = n.effect_stack.filter((e) => e.id !== effect.id);
                                        })
                                    }
                                />
                            </div>
                            {(Object.keys(effect.params) as (keyof EffectValues)[])
                                .filter((k) => k in ranges)
                                .map((k) => {
                                    const [min, max, step] = ranges[k];
                                    return field(names[k], effect.params[k] as number, min, max, step, (v) =>
                                        mutate((n) => {
                                            n.effect_stack.find((e) => e.id === effect.id)!.params[k] = v;
                                        }),
                                    );
                                })}
                            <Button
                                size="small"
                                className="my-2"
                                icon={<Diamond size={12} />}
                                disabled={time < effect.start || time > effect.end || effect.keyframes.length >= 128}
                                onClick={() =>
                                    mutate((n) => {
                                        const e = n.effect_stack.find((e) => e.id === effect.id)!,
                                            at = Math.round(time),
                                            values = effectValues(e, at);
                                        delete values.blur;
                                        delete values.sharpen;
                                        e.keyframes = e.keyframes.filter((k) => k.at !== at);
                                        e.keyframes.push({ at, values, interpolation: e.interpolation });
                                        e.keyframes.sort((a, b) => a.at - b.at);
                                    })
                                }
                            >
                                在播放头添加关键帧
                            </Button>
                            {effect.keyframes.map((key, i) => (
                                <div key={key.at} className="my-2 border-t pt-2" style={{ borderColor: token.colorBorderSecondary }}>
                                    <div className="flex items-center justify-between text-xs">
                                        <span>{(key.at / 1000).toFixed(2)}s</span>
                                        <Select
                                            size="small"
                                            style={{ width: 110 }}
                                            value={key.interpolation}
                                            options={curves.map((value) => ({ value, label: value }))}
                                            onChange={(v) =>
                                                mutate((n) => {
                                                    n.effect_stack.find((e) => e.id === effect.id)!.keyframes[i].interpolation = v;
                                                })
                                            }
                                        />
                                        <Button
                                            type="text"
                                            size="small"
                                            aria-label="删除关键帧"
                                            icon={<Trash2 size={12} />}
                                            onClick={() =>
                                                mutate((n) => {
                                                    n.effect_stack.find((e) => e.id === effect.id)!.keyframes.splice(i, 1);
                                                })
                                            }
                                        />
                                    </div>
                                    {(Object.keys(key.values) as (keyof EffectValues)[]).map((k) => {
                                        const [min, max, step] = ranges[k];
                                        return field(names[k], key.values[k]!, min, max, step, (v) =>
                                            mutate((n) => {
                                                n.effect_stack.find((e) => e.id === effect.id)!.keyframes[i].values[k] = v;
                                            }),
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    ))}
                </>
            )}
        </aside>
    );
}
