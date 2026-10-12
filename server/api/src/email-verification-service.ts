import DmClientModule, { SingleSendMailRequest } from "@alicloud/dm20151123";
import { $OpenApiUtil } from "@alicloud/openapi-core";

import type { EmailVerificationConfig } from "./config.js";
import type { VerificationCodeStore, VerifiedCode, VerificationPurpose } from "./verification-code-store.js";

export type EmailVerificationPurpose = VerificationPurpose;
export type VerifiedEmailCode = { id: string; email: string; purpose: EmailVerificationPurpose } & Partial<VerifiedCode>;

export interface EmailVerificationServicePort {
  requestCode(email: string, requestIp: string, purpose: EmailVerificationPurpose): Promise<void>;
  verifyCode(email: string, code: string, purpose: EmailVerificationPurpose): Promise<VerifiedEmailCode>;
  consumeCode(verification: VerifiedEmailCode): Promise<boolean>;
}

export class EmailVerificationService implements EmailVerificationServicePort {
  private readonly mailClient: InstanceType<typeof DmClientModule.default>;

  constructor(private readonly store: VerificationCodeStore, private readonly config: EmailVerificationConfig) {
    this.mailClient = new DmClientModule.default(new $OpenApiUtil.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      regionId: "cn-hangzhou",
      endpoint: "dm.aliyuncs.com",
    }));
  }

  requestCode(email: string, requestIp: string, purpose: EmailVerificationPurpose) {
    return this.store.request({ channel: "email", purpose, account: email, ip: requestIp, config: this.config, deliver: (code) => this.sendCode(email, code, purpose) });
  }

  async verifyCode(email: string, code: string, purpose: EmailVerificationPurpose): Promise<VerifiedEmailCode> {
    const verified = await this.store.verify("email", purpose, email, code, this.config);
    return { ...verified, id: verified.fingerprint, email };
  }

  consumeCode(verification: VerifiedEmailCode) { return this.store.consume(verification as VerifiedCode); }

  private async sendCode(email: string, code: string, purpose: EmailVerificationPurpose) {
    const minutes = Math.ceil(this.config.codeTtlSeconds / 60);
    const action = purpose === "password_reset" ? "密码重置" : purpose === "login" ? "登录" : "注册";
    await this.mailClient.singleSendMail(new SingleSendMailRequest({
      accountName: this.config.accountName,
      addressType: 1,
      replyToAddress: false,
      toAddress: email,
      fromAlias: this.config.fromAlias,
      subject: `守守画布${action}验证码`,
      clickTrace: "0",
      textBody: `守守画布${action}验证\n\n验证码：${code}\n\n验证码将在 ${minutes} 分钟后失效，请勿转发给任何人。\n如非本人操作，请忽略此邮件。`,
      htmlBody: renderVerificationEmail({ action, code, minutes }),
    }));
  }
}

export function renderVerificationEmail({ action, code, minutes }: { action: string; code: string; minutes: number }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>守守画布${action}验证码</title>
</head>
<body style="margin:0;padding:0;background:#f2f0eb;color:#1c1b19;font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">你的守守画布${action}验证码将在 ${minutes} 分钟后失效。</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2f0eb;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #dedad1;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(31,28,22,0.08);">
          <tr>
            <td style="padding:26px 30px;background:#151412;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="46" valign="middle">
                    <div style="width:42px;height:42px;border:1px solid #5f5125;border-radius:13px;background:#272319;text-align:center;line-height:42px;color:#f2cc58;font-size:18px;font-weight:700;">守</div>
                  </td>
                  <td valign="middle" style="padding-left:13px;">
                    <div style="color:#f3ce62;font-size:10px;line-height:16px;letter-spacing:2.4px;">SHOUSHOU CANVAS</div>
                    <div style="color:#ffffff;font-size:17px;line-height:24px;font-weight:700;">守守画布</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:38px 34px 34px;">
              <div style="margin-bottom:10px;color:#9a7217;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.8px;">账号安全 · ${action}</div>
              <h1 style="margin:0;color:#1c1b19;font-size:27px;line-height:38px;font-weight:750;letter-spacing:-0.5px;">请验证是你本人</h1>
              <p style="margin:12px 0 0;color:#6f6b63;font-size:14px;line-height:24px;">你正在进行守守画布${action}操作，请在验证页面输入下方验证码。</p>

              <div style="margin:28px 0 22px;padding:22px 24px;background:#f8f6f1;border:1px solid #e5dfd2;border-radius:16px;text-align:center;">
                <div style="margin-bottom:8px;color:#8b857b;font-size:11px;line-height:16px;letter-spacing:2px;">一次性验证码</div>
                <div style="color:#171614;font-family:Consolas,Menlo,'Courier New',monospace;font-size:36px;line-height:48px;font-weight:700;letter-spacing:9px;white-space:nowrap;">${code}</div>
              </div>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:7px 12px;background:#fff8df;border:1px solid #eee0a7;border-radius:999px;color:#72550e;font-size:12px;line-height:18px;">
                    <span style="color:#d39d16;">●</span>&nbsp;&nbsp;${minutes} 分钟内有效
                  </td>
                </tr>
              </table>

              <div style="padding:16px 18px;background:#f6f5f2;border-left:3px solid #d5ad3d;border-radius:4px 12px 12px 4px;color:#6f6b63;font-size:13px;line-height:22px;">
                为保障账号安全，请勿将验证码转发给任何人。守守画布工作人员不会向你索要验证码。
              </div>

              <p style="margin:24px 0 0;color:#969188;font-size:12px;line-height:20px;">如非本人操作，无需进行任何处理，此验证码将在到期后自动失效。</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 30px;background:#faf9f6;border-top:1px solid #ece8df;color:#aaa49a;font-size:11px;line-height:18px;text-align:center;">此邮件由系统自动发送，请勿直接回复</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
