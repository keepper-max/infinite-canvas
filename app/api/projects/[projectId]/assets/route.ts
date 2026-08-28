import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { putAsset } from "@/lib/storage";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "audio/mpeg", "audio/wav"]);

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const rows = await db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(desc(assets.createdAt));
  return NextResponse.json({ assets: rows.map((asset) => ({ ...asset, contentUrl: `/api/assets/${asset.id}/content` })) });
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "暂不支持该文件类型" }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: "文件不能超过 50MB" }, { status: 413 });
  const id = crypto.randomUUID(); const objectKey = `${projectId}/${id}-${file.name.replace(/[^\w.-]+/g, "_")}`; await putAsset(objectKey, new Uint8Array(await file.arrayBuffer()), file.type);
  const [asset] = await db.insert(assets).values({ id, projectId, kind: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio", name: file.name, objectKey, uri: `/api/assets/${id}/content`, mimeType: file.type, size: file.size, metadata: { source: "upload" } }).returning();
  return NextResponse.json({ asset: { ...asset, contentUrl: `/api/assets/${asset.id}/content` } }, { status: 201 });
}
