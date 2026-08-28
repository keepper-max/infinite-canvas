import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { getAsset } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const user = await getCurrentUser(); const { assetId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset || !await getProjectForUser(asset.projectId, user.id)) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  const object = await getAsset(asset.objectKey); const body = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
  return new Response(body as unknown as BodyInit, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(body.byteLength), "Cache-Control": "private, max-age=3600" } });
}
