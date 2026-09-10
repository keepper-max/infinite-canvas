import { z } from "zod";

const videoClipSchema = z.object({
  assetVersionId: z.string().uuid(),
  durationMs: z.number().int().positive(),
  trimStartMs: z.number().int().nonnegative().default(0),
  volume: z.number().min(0).max(2).default(1),
  transition: z.enum(["cut", "fade"]).default("cut"),
  transitionMs: z.number().int().nonnegative().default(0),
});

const audioClipSchema = z.object({
  assetVersionId: z.string().uuid(),
  role: z.enum(["dialogue", "sound_effect", "music"]),
  startMs: z.number().int().nonnegative().default(0),
  trimStartMs: z.number().int().nonnegative().default(0),
  durationMs: z.number().int().positive().optional(),
  volume: z.number().min(0).max(2).default(1),
});

const subtitleCueSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string().trim().min(1).max(2_000),
});

export const timelineDocumentSchema = z
  .object({
    video: z.array(videoClipSchema).min(1),
    audio: z.array(audioClipSchema).default([]),
    subtitles: z.array(subtitleCueSchema).default([]),
    output: z
      .object({
        width: z
          .number()
          .int()
          .min(16)
          .refine((value) => value % 2 === 0, "视频宽度必须是偶数")
          .default(1280),
        height: z
          .number()
          .int()
          .min(16)
          .refine((value) => value % 2 === 0, "视频高度必须是偶数")
          .default(720),
        fps: z.number().int().min(1).default(25),
        subtitleFontSize: z.number().int().min(12).default(36),
      })
      .default({ width: 1280, height: 720, fps: 25, subtitleFontSize: 36 }),
  })
  .strict()
  .superRefine((value, context) => {
    value.subtitles.forEach((cue, index) => {
      if (cue.endMs <= cue.startMs)
        context.addIssue({
          code: "custom",
          path: ["subtitles", index, "endMs"],
          message: "字幕结束时间必须晚于开始时间",
        });
    });
  });

export const createCompositionJobSchema = z
  .object({
    nodeId: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200).default("成片时间线"),
    timeline: timelineDocumentSchema,
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export type TimelineDocument = z.infer<typeof timelineDocumentSchema>;
export type CreateCompositionJobInput = z.infer<
  typeof createCompositionJobSchema
>;
