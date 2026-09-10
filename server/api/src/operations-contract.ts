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
    provider: z.string().min(1).max(50),
    idempotencyKey: z.string().min(8).max(200),
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
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamMemberInput = z.infer<typeof teamMemberSchema>;
