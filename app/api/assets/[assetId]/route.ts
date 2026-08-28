import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { deleteAsset } from "@/lib/storage";

export async function DELETE(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const user = await getCurrentUser(); const { assetId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset || !await getProjectForUser(asset.projectId, user.id)) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  await deleteAsset(asset.objectKey); await db.delete(assets).where(eq(assets.id, assetId));
  return NextResponse.json({ ok: true });
}
