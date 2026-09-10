import { z } from "zod";

const referenceSchema = z
  .object({
    role: z.enum([
      "first_frame",
      "last_frame",
      "identity_reference",
      "environment_reference",
      "motion_reference",
      "audio_reference",
    ]),
    assetVersionId: z.string().uuid().optional(),
    url: z.string().url().optional(),
    dataUrl: z.string().max(30_000_000).optional(),
    mimeType: z.string().max(128).optional(),
  })
  .refine(
    (value) => Boolean(value.assetVersionId || value.url || value.dataUrl),
    "参考素材缺少来源",
  );

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
    references: z.array(referenceSchema).max(15).default([]),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export type CreateJobInput = z.infer<typeof createJobSchema>;
