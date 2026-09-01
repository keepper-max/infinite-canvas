import type { modelConfigs } from "@/db/schema";

type ModelConfig = typeof modelConfigs.$inferSelect;

export async function runChatModel(config: ModelConfig, prompt: string) {
  const key = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  if (!key)
    return {
      configured: false,
      text: "模型配置已保存，但服务器环境变量中没有找到 API Key；当前返回 Mock 建议。",
    };
  const base = config.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(
      payload.error?.message ?? `模型请求失败（${response.status}）`,
    );
  return {
    configured: true,
    text: payload.choices?.[0]?.message?.content ?? "模型未返回文本",
  };
}
