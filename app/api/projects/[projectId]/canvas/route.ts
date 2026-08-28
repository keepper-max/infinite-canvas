import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { canvasEdges, canvasNodes, canvasSnapshots } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProjectForUser } from "@/lib/project-access";

type CanvasPayload = { nodes?: Array<{ id: string; type?: string; position?: unknown; data?: unknown }>; edges?: Array<{ id: string; source: string; target: string; label?: string; type?: string; data?: unknown }> };

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const [nodes, edges, snapshot] = await Promise.all([
    db.select().from(canvasNodes).where(eq(canvasNodes.projectId, projectId)),
    db.select().from(canvasEdges).where(eq(canvasEdges.projectId, projectId)),
    db.select({ version: canvasSnapshots.version }).from(canvasSnapshots).where(eq(canvasSnapshots.projectId, projectId)).orderBy(desc(canvasSnapshots.version)).limit(1),
  ]);
  return NextResponse.json({ nodes: nodes.map((item) => ({ id: item.id, type: item.nodeType, position: item.position, data: item.data })), edges: edges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.edgeType, data: item.data })), version: snapshot[0]?.version ?? 0 });
}

export async function PUT(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getCurrentUser(); const { projectId } = await context.params;
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!await getProjectForUser(projectId, user.id)) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const body = await request.json().catch(() => null) as CanvasPayload | null;
  if (!Array.isArray(body?.nodes) || !Array.isArray(body?.edges)) return NextResponse.json({ error: "画布数据格式错误" }, { status: 400 });
  const nodes = body.nodes;
  const edges = body.edges;
  const version = await db.transaction(async (tx) => {
    const [last] = await tx.select({ version: canvasSnapshots.version }).from(canvasSnapshots).where(eq(canvasSnapshots.projectId, projectId)).orderBy(desc(canvasSnapshots.version)).limit(1);
    const nextVersion = (last?.version ?? 0) + 1;
    await tx.delete(canvasEdges).where(eq(canvasEdges.projectId, projectId));
    await tx.delete(canvasNodes).where(eq(canvasNodes.projectId, projectId));
    if (nodes.length) await tx.insert(canvasNodes).values(nodes.map((item) => ({ id: item.id, projectId, nodeType: item.type ?? "studio", label: String((item.data as { label?: string } | undefined)?.label ?? item.id), position: item.position ?? { x: 0, y: 0 }, data: item.data ?? {}, status: String((item.data as { status?: string } | undefined)?.status ?? "idle") })));
    if (edges.length) await tx.insert(canvasEdges).values(edges.map((item) => ({ id: item.id, projectId, sourceNodeId: item.source, targetNodeId: item.target, edgeType: item.label ?? item.type ?? "reference", data: item.data ?? {} })));
    await tx.insert(canvasSnapshots).values({ projectId, version: nextVersion, nodes, edges });
    return nextVersion;
  });
  return NextResponse.json({ version, updatedAt: new Date().toISOString() });
}
