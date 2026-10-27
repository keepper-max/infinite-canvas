import { z } from "zod";
import { DomainError } from "../domain.js";
import { analysisSchema, type Analysis } from "./contract.js";

// Normalize textual evidence only; never coerce clip times or invent a selection.
const citedSentence = z.object({
  text: z.string(),
  segment_start: z.number().int().nonnegative(),
  segment_end: z.number().int().positive(),
}).strict();
const responseSchema = z.object({
  candidates: z.array(analysisSchema.shape.candidates.element.extend({
    evidence: z.union([z.string(), z.array(z.string()), z.array(citedSentence)]),
  }).strict()),
}).strict();
export const analysisResponseJsonSchema = z.toJSONSchema(responseSchema);

export function compileAnalysisResult(raw: unknown, info: Analysis): Analysis {
  const result = responseSchema.safeParse(raw);
  if (!result.success)
    throw new DomainError(
      "AUTOCUT_ANALYSIS_SCHEMA_INVALID",
      "素材理解结果格式不合法，已保留原请求；安全重试不会重复调用已完成模型",
      422,
    );
  return analysisSchema.parse({
    ...info,
    candidates: result.data.candidates.map((c) => ({
      ...c,
      evidence: Array.isArray(c.evidence) ? c.evidence.map((e) => {
        if (typeof e === "string") return e;
        if (e.segment_end <= e.segment_start || e.segment_end > info.durationMs)
          throw new DomainError("AUTOCUT_ANALYSIS_INVALID", "模型证据返回越界时间戳，已保留原结果", 422);
        return `${e.text}（源素材 ${e.segment_start}–${e.segment_end} ms）`;
      }).join("\n") : c.evidence,
    })),
  });
}
