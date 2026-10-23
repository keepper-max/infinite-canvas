import { randomUUID } from "node:crypto";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import * as tables from "./db/schema.js";
import { PostgresPlatformRepository } from "./repository.js";
import { DomainError } from "./domain.js";

export const vibeStoryboardSchema = z.object({
  operationId: z.string().uuid(), expectedCanvasRevision: z.number().int().nonnegative(),
  title: z.string().min(1).max(160), summary: z.string().min(1).max(5000),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]), style: z.string().max(1000).optional(),
  scenes: z.array(z.object({ title: z.string().min(1).max(120), narration: z.string().min(1).max(2000),
    visual: z.string().min(1).max(3000), onScreenText: z.string().max(500).optional(), durationSeconds: z.number().positive().max(60) })).min(1).max(30),
}).strict();

export const vibeVideoSchema = z.object({
  operationId: z.string().uuid(), expectedCanvasRevision: z.number().int().nonnegative(), storyboardId: z.string().uuid(),
  title: z.string().min(1).max(160), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(),
  mimeType: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
}).strict();

export class VibeCanvasService {
  readonly repository: PostgresPlatformRepository;
  constructor(pool: Pick<Pool, "query"> & { connect: unknown }) {
    // The two source projects carry different @types/pg versions. Accept only the
    // common query boundary, and verify Drizzle will acquire a dedicated Pool client.
    if (typeof pool.connect !== "function" || !Object.getPrototypeOf(pool).constructor.name.includes("Pool"))
      throw new TypeError("VibeCanvasService requires a pg Pool");
    this.repository = new PostgresPlatformRepository(drizzle(pool as unknown as Pool, { schema: tables }));
  }

  async createStoryboard(projectId: string, actorId: string, raw: unknown) {
    const { operationId, expectedCanvasRevision, ...payload } = vibeStoryboardSchema.parse(raw);
    return this.repository.applyCanvasOperationForUser(projectId, actorId, { operationId, expectedCanvasRevision, kind: "vibe.storyboard.create", payload }, async current => {
      const storyboardId = randomUUID();
      const prefix = `vibe-${storyboardId}`;
      const rootId = `${prefix}-script`, outputId = `${prefix}-output`;
      const common = { source: "codex-vibe", storyboardId, aspectRatio: payload.aspectRatio, style: payload.style ?? "电影感知识短视频" };
      const added = [
        { id: rootId, type: "text", title: payload.title, position: { x: 80, y: 120 }, width: 360, height: 240,
          metadata: { ...common, vibeRole: "prompt", content: payload.summary } },
        ...payload.scenes.map((scene, index) => ({ id: `${prefix}-scene-${index + 1}`, type: "text", title: `场景 ${index + 1} · ${scene.title}`,
          position: { x: 420 + index * 340, y: 120 }, width: 300, height: 240,
          metadata: { ...common, ...scene, vibeRole: "scene", order: index + 1, content: `${scene.narration}\n\n${scene.visual}` } })),
        { id: outputId, type: "video", title: `${payload.title} · 成片`, position: { x: 420 + payload.scenes.length * 340, y: 120 }, width: 360, height: 240,
          metadata: { ...common, vibeRole: "output", status: "idle", content: "" } },
      ];
      const links = added.slice(1).map((node, i) => ({ id: `${prefix}-edge-${i}`, fromNodeId: added[i].id, toNodeId: node.id,
        sourcePortId: "text.output", targetPortId: "text.input", resourceType: "text", role: "data", order: current.edges.length + i }));
      return { nodes: [...current.nodes, ...added], edges: [...current.edges, ...links], viewport: current.viewport, settings: current.settings,
        result: { storyboardId, outputNodeId: outputId, createdNodeIds: added.map(node => node.id),
        createdEdgeIds: links.map(edge => edge.id), sceneCount: payload.scenes.length, totalDurationSeconds: payload.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) } };
    });
  }

  async importVideo(projectId: string, actorId: string, raw: unknown, upload: (storageKey: string) => Promise<void>) {
    const { operationId, expectedCanvasRevision, ...payload } = vibeVideoSchema.parse(raw);
    return this.repository.applyCanvasOperationForUser(projectId, actorId, { operationId, expectedCanvasRevision, kind: "vibe.video.import", payload }, async (current, tx) => {
      const output = current.nodes.find(node => node.metadata?.source === "codex-vibe" && node.metadata.storyboardId === payload.storyboardId && node.metadata.vibeRole === "output");
      if (!output) throw new DomainError("CANVAS_OUTPUT_NOT_FOUND", "未找到该分镜的成片节点", 404);
      const assetId = randomUUID(), assetVersionId = randomUUID();
      const extension = { "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" }[payload.mimeType];
      const storageKey = `projects/${projectId}/vibe-v2/${actorId}/${operationId}/${payload.sha256}${extension}`;
      // Content-addressed staging: SQL failure can leave an unreferenced object, never
      // delete on an ambiguous COMMIT error (it might already be referenced).
      await upload(storageKey);
      await tx.insert(tables.assets).values({ id: assetId, projectId, kind: "video", name: `${payload.title}${extension}`, createdBy: actorId });
      await tx.insert(tables.assetVersions).values({ id: assetVersionId, assetId, version: 1, storageKey,
        mimeType: payload.mimeType, bytes: payload.bytes, sha256: payload.sha256, source: "compose", createdBy: actorId,
        provenance: { source: "codex-vibe", storyboardId: payload.storyboardId, operationId } });
      await tx.update(tables.assets).set({ currentVersionId: assetVersionId }).where(eq(tables.assets.id, assetId));
      const nodes = current.nodes.map(node => node.id !== output.id ? node : { ...node,
        metadata: { ...node.metadata, status: "completed", content: `/api/media/asset-versions/${assetVersionId}`, assetId, assetVersionId, storageKey } });
      return { ...current, nodes, result: { assetId, assetVersionId, outputNodeId: output.id, storageKey } };
    });
  }
}
