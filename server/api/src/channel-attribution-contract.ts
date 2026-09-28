import { z } from "zod";

export const attributionStatus = z.enum(["active", "disabled"]);
export const inviteMode = z.enum(["required", "optional", "disabled"]);
export const channelType = z.enum([
  "school",
  "enterprise",
  "agent",
  "douyin",
  "xiaohongshu",
  "kol",
  "offline",
  "organic",
  "public",
  "legacy",
  "other",
]);
const optionalDate = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional();
const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

export const channelInput = z
  .object({
    channelType,
    channelName: z.string().trim().min(1).max(120),
    codePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{2,12}$/)
      .nullable()
      .optional(),
    contactName: optionalText(100),
    contactPhone: optionalText(100),
    remark: z.string().trim().max(1000).default(""),
    status: attributionStatus.default("active"),
  })
  .strict();

export const campaignInput = z
  .object({
    channelId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    startAt: optionalDate,
    endAt: optionalDate,
    status: attributionStatus.default("active"),
  })
  .strict();

export const batchInput = z
  .object({
    campaignId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    startAt: optionalDate,
    endAt: optionalDate,
    status: attributionStatus.default("active"),
  })
  .strict();

export const inviteCodeInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9-]{4,40}$/)
      .optional(),
    channelId: z.string().uuid(),
    campaignId: z.string().uuid().nullable().optional(),
    batchId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    maxUses: z.number().int().positive().max(1_000_000).nullable().optional(),
    startAt: optionalDate,
    expireAt: optionalDate,
    status: attributionStatus.default("active"),
  })
  .strict();

export const inviteBatchInput = inviteCodeInput
  .omit({ code: true, name: true })
  .extend({
    count: z.union([
      z.literal(1),
      z.literal(5),
      z.literal(10),
      z.literal(20),
      z.literal(50),
      z.literal(100),
    ]),
    namePrefix: z.string().trim().min(1).max(100),
  })
  .strict();

export const attributionListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(200).optional(),
    status: attributionStatus.optional(),
    channelId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
  })
  .strict();

export const inviteValidateInput = z
  .object({
    code: z.string().trim().toUpperCase().min(1).max(40),
    deviceId: z.string().trim().min(16).max(200).optional(),
  })
  .strict();

export const inviteModeInput = z.object({ mode: inviteMode }).strict();
export const attributionStatusInput = z
  .object({ status: attributionStatus })
  .strict();
export const userAttributionInput = z
  .object({
    inviteCodeId: z.string().uuid().nullable().optional(),
    channelId: z.string().uuid(),
    campaignId: z.string().uuid().nullable().optional(),
    batchId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type ChannelInput = z.infer<typeof channelInput>;
export type CampaignInput = z.infer<typeof campaignInput>;
export type BatchInput = z.infer<typeof batchInput>;
export type InviteCodeInput = z.infer<typeof inviteCodeInput>;
export type InviteBatchInput = z.infer<typeof inviteBatchInput>;
export type AttributionListQuery = z.infer<typeof attributionListQuery>;
