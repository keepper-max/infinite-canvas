export type IntegrationName = "credits" | "payment" | "sms";

export type IntegrationStatus = {
  name: IntegrationName;
  provider: string;
  configured: boolean;
  message: string;
};

const config = {
  credits: process.env.CREDITS_PROVIDER ?? "mock",
  payment: process.env.PAYMENT_PROVIDER ?? "unconfigured",
  sms: process.env.SMS_PROVIDER ?? "unconfigured",
} as const;

export function integrationStatus(name: IntegrationName): IntegrationStatus {
  const provider = config[name];
  const configured = provider !== "unconfigured";
  return { name, provider, configured, message: configured ? "接口边界已启用，等待服务商适配器" : "尚未配置服务商" };
}

export function integrationStatuses() {
  return (Object.keys(config) as IntegrationName[]).map(integrationStatus);
}
