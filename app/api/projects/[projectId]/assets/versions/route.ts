import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { putAsset } from "@/lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params; const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const rows = await db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(desc(assets.createdAt));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) { const key = String((row.metadata as { versionGroup?: string } | null)?.versionGroup ?? row.name); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  return NextResponse.json({ versions: [...groups].map(([group, items]) => ({ group, items })) });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params; const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const form = await request.formData(); const file = form.get("file"); const parentId = String(form.get("parentAssetId") ?? "");
  if (!(file instanceof File) || !parentId) return NextResponse.json({ error: "需要文件和 parentAssetId" }, { status: 400 });
  const [parent] = await db.select().from(assets).where(eq(assets.id, parentId)).limit(1); if (!parent || parent.projectId !== projectId) return NextResponse.json({ error: "原资产不存在" }, { status: 404 });
  const versionGroup = String((parent.metadata as { versionGroup?: string } | null)?.versionGroup ?? parent.id); const [latest] = await db.select({ version: assets.version }).from(assets).where(eq(assets.projectId, projectId)).orderBy(desc(assets.version)).limit(1);
  const id = crypto.randomUUID(); const objectKey = `${projectId}/${id}-${file.name.replace(/[^\w.-]+/g, "_")}`; await putAsset(objectKey, new Uint8Array(await file.arrayBuffer()), file.type);
  const [asset] = await db.insert(assets).values({ id, projectId, kind: parent.kind, name: file.name, objectKey, uri: `/api/assets/${id}/content`, mimeType: file.type || parent.mimeType, size: file.size, version: (latest?.version ?? parent.version) + 1, metadata: { source: "version", versionGroup, parentAssetId: parent.id } }).returning();
  return NextResponse.json({ asset: { ...asset, contentUrl: `/api/assets/${asset.id}/content` } }, { status: 201 });
}
