import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { isValidProviderAssetSignature } from "@/lib/provider-asset-url";
import { getAsset } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  const url = new URL(request.url);
  const providerAccess = isValidProviderAssetSignature(assetId, url.searchParams.get("expires"), url.searchParams.get("signature"));
  if (!providerAccess) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (!await getProjectForUser(asset.projectId, user.id)) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  }
  const object = await getAsset(asset.objectKey);
  const body = object.Body?.transformToWebStream();
  if (!body) return NextResponse.json({ error: "素材内容为空" }, { status: 404 });
  return new Response(body as BodyInit, { headers: { "Content-Type": asset.mimeType, ...(object.ContentLength == null ? {} : { "Content-Length": String(object.ContentLength) }), "Cache-Control": "private, max-age=3600" } });
}
