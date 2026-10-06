import DysmsapiPackage, * as DysmsapiModels from "@alicloud/dysmsapi20170525";
import OpenApi, * as OpenApiModels from "@alicloud/openapi-client";
import * as Util from "@alicloud/tea-util";

export interface SmsService {
  sendVerificationCode(phone: string, code: string): Promise<void>;
}

type DysmsapiClient = {
  sendSmsWithOptions(request: DysmsapiModels.SendSmsRequest, runtime: Util.RuntimeOptions): Promise<DysmsapiModels.SendSmsResponse>;
};

let client: DysmsapiClient | null = null;

type DysmsapiConstructor = new (config: OpenApiModels.Config) => DysmsapiClient;

function getClientConstructor() {
  const imported = DysmsapiPackage as unknown as DysmsapiConstructor & { default?: DysmsapiConstructor };
  return imported.default ?? imported;
}

function getClient() {
  if (client) return client;
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET ?? process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) throw new Error("Aliyun SMS credentials are not configured");
  const config = new OpenApiModels.Config({ accessKeyId, accessKeySecret });
  config.endpoint = "dysmsapi.aliyuncs.com";
  const Client = getClientConstructor();
  client = new Client(config);
  return client;
}

export const aliyunSmsService: SmsService = {
  async sendVerificationCode(phone, code) {
    const signName = process.env.ALIYUN_SMS_SIGN_NAME;
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;
    if (!signName || !templateCode) throw new Error("Aliyun SMS template is not configured");
    const request = new DysmsapiModels.SendSmsRequest({
      phoneNumbers: phone.replace(/^\+86/, ""),
      signName,
      templateCode,
      templateParam: JSON.stringify({ code }),
    });
    const response = await getClient().sendSmsWithOptions(request, new Util.RuntimeOptions({}));
    if (response.body?.code !== "OK") throw new Error(`Aliyun SMS rejected request: ${response.body?.code ?? "unknown"}`);
  },
};
