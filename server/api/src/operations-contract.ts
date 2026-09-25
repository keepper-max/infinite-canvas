import { z } from "zod";

export const smsRequestSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{7,14}$/, "请输入有效手机号"),
    purpose: z.enum(["login", "register", "bind_phone"]),
  })
  .strict();
export const smsVerifySchema = smsRequestSchema
  .extend({ code: z.string().regex(/^\d{4,8}$/, "验证码格式不正确") })
  .strict();
export const paymentOrderSchema = z
  .object({
    planId: z.string().min(1).max(100),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export const paymentPlanInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    credits: z.number().int().positive().max(1_000_000_000),
    priceCents: z.number().int().positive().max(100_000_000),
    enabled: z.boolean(),
  })
  .strict();
export const providerBillingRuleInputSchema = z
  .object({
    provider: z.enum(["runninghub", "runninghub_global"]),
    modelPattern: z.string().trim().min(1).max(200),
    matchType: z.enum(["exact", "contains"]),
    discountRate: z
      .string()
      .trim()
      .regex(/^(?:0(?:\.\d{1,8})?|1(?:\.0{1,8})?)$/)
      .refine((value) => Number(value) > 0 && Number(value) <= 1, "折扣率必须大于 0 且不超过 1"),
    priority: z.number().int().min(-10_000).max(10_000),
    enabled: z.boolean(),
    note: z.string().trim().max(200),
  })
  .strict();
export const teamCreateSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const teamMemberSchema = z
  .object({
    email: z.string().trim().email().max(254),
    role: z.enum(["admin", "editor", "viewer"]),
  })
  .strict();
export const teamProjectSchema = z
  .object({ projectId: z.string().uuid() })
  .strict();

export type SmsRequestInput = z.infer<typeof smsRequestSchema>;
export type SmsVerifyInput = z.infer<typeof smsVerifySchema>;
export type PaymentOrderInput = z.infer<typeof paymentOrderSchema>;
export type PaymentPlanInput = z.infer<typeof paymentPlanInputSchema>;
export type ProviderBillingRuleInput = z.infer<typeof providerBillingRuleInputSchema>;
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamMemberInput = z.infer<typeof teamMemberSchema>;
