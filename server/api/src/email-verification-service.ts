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
      textBody: `你的守守画布${action}验证码是：${code}。验证码 ${minutes} 分钟内有效，请勿转发给他人。`,
      htmlBody: `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#222;line-height:1.7"><h2>守守画布${action}验证码</h2><p>你的验证码是：</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 ${minutes} 分钟内有效，请勿转发给他人。</p><p style="color:#777">如非本人操作，请忽略此邮件。</p></div>`,
    }));
  }
}
