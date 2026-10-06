import DysmsapiPackage, * as DysmsapiModels from "@alicloud/dysmsapi20170525";
import * as OpenApiModels from "@alicloud/openapi-client";
import * as Util from "@alicloud/tea-util";

import type { SmsVerificationConfig } from "./config.js";
import type { VerificationCodeStore, VerifiedCode } from "./verification-code-store.js";

export type SmsVerificationPurpose = "register" | "login";
export type VerifiedSmsCode = VerifiedCode & { phone: string };
export interface SmsVerificationServicePort {
  requestCode(phone: string, requestIp: string, purpose: SmsVerificationPurpose): Promise<void>;
  verifyCode(phone: string, code: string, purpose: SmsVerificationPurpose): Promise<VerifiedSmsCode>;
  consumeCode(verification: VerifiedSmsCode): Promise<boolean>;
}

type SmsClient = { sendSmsWithOptions(request: DysmsapiModels.SendSmsRequest, runtime: Util.RuntimeOptions): Promise<DysmsapiModels.SendSmsResponse> };

export class SmsVerificationService implements SmsVerificationServicePort {
  private readonly client: SmsClient;
  constructor(private readonly store: VerificationCodeStore, private readonly config: SmsVerificationConfig) {
    const clientConfig = new OpenApiModels.Config({ accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret });
    clientConfig.endpoint = "dysmsapi.aliyuncs.com";
    const imported = DysmsapiPackage as unknown as (new (config: OpenApiModels.Config) => SmsClient) & { default?: new (config: OpenApiModels.Config) => SmsClient };
    const Client = imported.default ?? imported;
    this.client = new Client(clientConfig);
  }

  requestCode(phone: string, requestIp: string, purpose: SmsVerificationPurpose) {
    return this.store.request({ channel: "sms", purpose, account: phone, ip: requestIp, config: this.config, deliver: (code) => this.send(phone, code) });
  }

  async verifyCode(phone: string, code: string, purpose: SmsVerificationPurpose): Promise<VerifiedSmsCode> {
    return { ...(await this.store.verify("sms", purpose, phone, code, this.config)), phone };
  }

  consumeCode(verification: VerifiedSmsCode) { return this.store.consume(verification); }

  private async send(phone: string, code: string) {
    const response = await this.client.sendSmsWithOptions(new DysmsapiModels.SendSmsRequest({ phoneNumbers: phone.replace(/^\+86/, ""), signName: this.config.signName, templateCode: this.config.templateCode, templateParam: JSON.stringify({ code }) }), new Util.RuntimeOptions({}));
    if (response.body?.code !== "OK") throw new Error(`Aliyun SMS rejected request: ${response.body?.code || "unknown"}`);
  }
}
