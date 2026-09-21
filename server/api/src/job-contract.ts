import { z } from "zod";

const referenceSchema = z
  .object({
    role: z.enum([
      "first_frame",
      "last_frame",
      "identity_reference",
      "environment_reference",
      "composition_reference",
      "motion_reference",
      "video_input",
      "audio_reference",
    ]),
    assetVersionId: z.string().uuid().optional(),
    virtualPortraitId: z.string().uuid().optional(),
    url: z
      .string()
      .url()
      .refine(
        (value) => ["http:", "https:"].includes(new URL(value).protocol),
        "参考素材 URL 只支持 HTTP 或 HTTPS",
      )
      .optional(),
    dataUrl: z.string().max(30_000_000).optional(),
    mimeType: z.string().max(128).optional(),
    durationMs: z.number().finite().min(0).max(86_400_000).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.assetVersionId ||
        value.virtualPortraitId ||
        value.url ||
        value.dataUrl,
      ),
    "参考素材缺少来源",
  );

const traceSchema = z
  .object({
    workflowKind: z.string().min(1).max(200).optional(),
    skillId: z.string().min(1).max(200).optional(),
    skillVersion: z.string().min(1).max(100).optional(),
    inputHash: z
      .string()
      .regex(/^[a-f0-9]{8,64}$/i)
      .optional(),
    outputRevision: z.number().int().min(0).optional(),
    userModified: z.boolean().optional(),
    inputSnapshot: z.record(z.string(), z.unknown()).optional(),
    assetKind: z
      .enum(["character", "scene", "prop", "image", "video", "audio"])
      .optional(),
    assetName: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const createJobSchema = z
  .object({
    nodeId: z.string().min(1).max(200).optional(),
    nodeRevision: z.number().int().min(0).default(0),
    modelId: z.string().min(1).max(200),
    capability: z.enum(["text", "image", "video", "audio"]),
    mode: z.enum([
      "chat",
      "t2i",
      "i2i",
      "tts",
      "t2v",
      "i2v",
      "flf2v",
      "multiref",
    ]),
    prompt: z.string().min(1).max(120_000),
    parameters: z.record(z.string(), z.unknown()).default({}),
    references: z.array(referenceSchema).max(50).default([]),
    trace: traceSchema.optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export type CreateJobInput = z.infer<typeof createJobSchema>;
