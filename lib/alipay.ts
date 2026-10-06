import { AlipaySdk } from "alipay-sdk";

export const paymentPlans = {
  starter: { amountCents: 1000, credits: 1000 },
  standard: { amountCents: 5000, credits: 5000 },
  plus: { amountCents: 10000, credits: 10000 },
} as const;

export function paymentReady() {
  const base = process.env.PUBLIC_BASE_URL;
  return process.env.PAYMENT_ENABLED === "true" &&
    process.env.PAYMENT_COMPLIANCE_APPROVED === "true" &&
    process.env.PAYMENT_PROVIDER === "alipay" &&
    Boolean(base?.startsWith("https://") && process.env.ALIPAY_APP_ID &&
      process.env.ALIPAY_APP_PRIVATE_KEY_PEM && process.env.ALIPAY_PUBLIC_KEY_PEM &&
      process.env.ALIPAY_SELLER_ID && process.env.SERVICE_OPERATOR_NAME &&
      process.env.SERVICE_SUPPORT_EMAIL);
}

export function alipaySdk() {
  if (!paymentReady()) throw new Error("支付宝充值尚未开放");
  return new AlipaySdk({
    appId: process.env.ALIPAY_APP_ID!,
    privateKey: process.env.ALIPAY_APP_PRIVATE_KEY_PEM!.replace(/\\n/g, "\n"),
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY_PEM!.replace(/\\n/g, "\n"),
    keyType: "PKCS8",
  });
}
