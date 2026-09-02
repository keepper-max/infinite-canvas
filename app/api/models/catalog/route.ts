import { NextResponse } from "next/server";

const CATALOG_URL = "https://api.token360.ai/public/models?size=200&current=1";

export async function GET() {
  try {
    const response = await fetch(CATALOG_URL, {
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`catalog_${response.status}`);
    const payload = (await response.json()) as {
      data?: { list?: Array<Record<string, unknown>>; pagination?: { total?: string } };
    };
    const list = (payload.data?.list ?? []).map((item) => ({
      name: String(item.name ?? ""),
      displayName: String(item.displayName ?? item.name ?? ""),
      type: String(item.modelType ?? ""),
      inputTypes: Array.isArray(item.modelInputTypes) ? item.modelInputTypes : [],
      outputTypes: Array.isArray(item.modelOutputTypes) ? item.modelOutputTypes : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
      defaults: item.effectiveDefaultParams ?? {},
      supportedParameters: Array.isArray(item.supported_parameters) ? item.supported_parameters : [],
    })).filter((item) => item.name);
    return NextResponse.json({ models: list, total: payload.data?.pagination?.total ?? String(list.length), source: "token360" });
  } catch {
    return NextResponse.json({ error: "模型目录暂时不可用" }, { status: 502 });
  }
}
