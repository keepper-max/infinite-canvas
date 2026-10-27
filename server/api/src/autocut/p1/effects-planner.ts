import { z } from "zod";
import { DomainError } from "../../domain.js";
import { uid, clipEnd, type P1Timeline, type Effect } from "./runtime.js";
export const effectPlanSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            target_id: z.string().uuid(),
            preset: z.enum([
              "push-in",
              "pull-out",
              "fade-in",
              "fade-out",
              "slide-in",
              "warm",
              "soften",
              "audio-fade-in",
              "audio-fade-out",
            ]),
            strength: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(200),
    notes: z.array(z.string().max(2000)).max(20),
  })
  .strict();
/** A separate protocol; never broadens the v3 source-selection planner. */
export function compileEffectPlan(
  raw: unknown,
  before: P1Timeline,
  scope: string[],
) {
  const plan = effectPlanSchema.parse(raw),
    next = structuredClone(before),
    allowed = new Set(scope);
  if (!plan.suggestions.length && !plan.notes.length)
    throw new DomainError(
      "AUTOCUT_P1_UNSUPPORTED",
      "模型未提供可执行效果或原因说明，原工程保留",
      422,
    );
  for (const suggestion of plan.suggestions) {
    if (!allowed.has(suggestion.target_id))
      throw new DomainError("AUTOCUT_P1_SCOPE", "AI效果超出用户选择范围", 422);
    const track = next.tracks.find((tr) =>
        tr.clips.some((c) => c.id === suggestion.target_id),
      ),
      clip = track?.clips.find((c) => c.id === suggestion.target_id),
      cue = next.subtitles.find((s) => s.id === suggestion.target_id);
    if (!clip && !cue)
      throw new DomainError("AUTOCUT_P1_SCOPE", "目标已不存在", 422);
    const start = clip?.timeline_start ?? cue!.start,
      end = clip ? clipEnd(clip) : cue!.end,
      d = Math.min(600, (end - start) / 2),
      type =
        track?.kind === "audio"
          ? "audio"
          : suggestion.preset === "warm" || suggestion.preset === "soften"
            ? "filter"
            : "animation";
    const effect: Effect = {
        id: uid(),
        version: 1,
        type,
        target: { kind: cue ? "subtitle" : "clip", id: suggestion.target_id },
        start,
        end,
        enabled: true,
        interpolation: "easeInOut",
        params: {},
        keyframes: [],
      },
      s = suggestion.strength;
    const keys = (
      name: "scale" | "opacity" | "x" | "gain",
      a: number,
      b: number,
      from = start,
      to = end,
    ) => {
      effect.keyframes = [
        { at: from, values: { [name]: a }, interpolation: "easeInOut" },
        { at: to, values: { [name]: b }, interpolation: "linear" },
      ];
    };
    switch (suggestion.preset) {
      case "push-in":
        keys("scale", 1, 1 + 0.2 * s);
        break;
      case "pull-out":
        keys("scale", 1 + 0.2 * s, 1);
        break;
      case "fade-in":
        keys("opacity", 0, 1, start, start + d);
        break;
      case "fade-out":
        keys("opacity", 1, 0, end - d, end);
        break;
      case "slide-in":
        keys("x", -0.2 * s, 0, start, start + d);
        break;
      case "warm":
        effect.params = {
          brightness: 0.05 * s,
          contrast: 1 + 0.15 * s,
          saturation: 1 + 0.15 * s,
        };
        break;
      case "soften":
        effect.params = { blur: 2 * s };
        break;
      case "audio-fade-in":
        keys("gain", 0, 1, start, start + d);
        break;
      case "audio-fade-out":
        keys("gain", 1, 0, end - d, end);
        break;
    }
    next.effect_stack.push(effect);
  }
  next.warnings.push(...plan.notes);
  return next;
}
