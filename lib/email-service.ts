import nodemailer from "nodemailer";

export interface EmailService {
  sendVerificationCode(email: string, code: string): Promise<void>;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !Number.isInteger(port) || !user || !pass) throw new Error("SMTP is not configured");
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
  });
  return transporter;
}

export const smtpEmailService: EmailService = {
  async sendVerificationCode(email, code) {
    const from = process.env.SMTP_FROM;
    if (!from) throw new Error("SMTP sender is not configured");
    const name = process.env.SMTP_FROM_NAME ?? "守守画布";
    await getTransporter().sendMail({
      from: { name, address: from },
      to: email,
      subject: "守守画布验证码",
      text: `您的验证码是：${code}\n\n验证码 5 分钟内有效，请勿泄露给他人。`,
      html: `<p>您的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 5 分钟内有效，请勿泄露给他人。</p>`,
    });
  },
};
