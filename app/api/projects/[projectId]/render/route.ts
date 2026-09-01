import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assets } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";
import { getAsset, putAsset } from "@/lib/storage";
import { concatVideos } from "@/lib/ffmpeg";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params; const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { assetIds?: string[] };
  const ids = Array.isArray(body.assetIds) ? body.assetIds.filter((id): id is string => typeof id === "string").slice(0, 30) : [];
  if (ids.length < 2) return NextResponse.json({ error: "至少选择两个视频资产" }, { status: 400 });
  const rows = await db.select().from(assets).where(inArray(assets.id, ids));
  if (rows.length !== ids.length || rows.some((row) => row.projectId !== projectId || row.kind !== "video")) return NextResponse.json({ error: "只能合成当前项目的视频资产" }, { status: 400 });
  try {
    const inputs = [];
    for (const row of rows) { const object = await getAsset(row.objectKey); const bytes = object.Body ? new Uint8Array(await object.Body.transformToByteArray()) : null; if (!bytes) throw new Error(`无法读取资产 ${row.name}`); inputs.push({ bytes, extension: row.mimeType === "video/webm" ? "webm" : "mp4" }); }
    const output = await concatVideos(inputs); const id = crypto.randomUUID(); const objectKey = `${projectId}/${id}-render.mp4`; await putAsset(objectKey, output, "video/mp4");
    const [asset] = await db.insert(assets).values({ id, projectId, kind: "video", name: "合成视频.mp4", objectKey, uri: `/api/assets/${id}/content`, mimeType: "video/mp4", size: output.byteLength, version: 1, metadata: { source: "ffmpeg", inputAssetIds: ids } }).returning();
    return NextResponse.json({ asset: { ...asset, contentUrl: `/api/assets/${id}/content` } }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "视频合成失败" }, { status: 500 }); }
}
