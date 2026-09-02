type CanvasNodeType = "prompt" | "character" | "scene" | "panorama" | "composition_3d" | "keyframe" | "image_edit" | "style_polish" | "video" | "audio" | "output";
type GenerationJob = { id: string; nodeId: string; nodeLabel: string; provider: string; model: string; status: "pending" | "running" | "completed" | "failed"; progress: number; createdAt: string; error?: string; outputUrl?: string };

export type VideoMode = "T2V" | "I2V" | "R2V" | "FLF2V" | "edit";

export type VideoJobInput = {
  projectId: string;
  nodeId: string;
  mode: VideoMode;
  prompt: string;
  references: Array<{ assetId: string; role: string; uri?: string }>;
  modelId: string;
  duration?: number;
  aspectRatio?: string;
};

export type VideoJobHandle = { provider: string; remoteId: string };

export interface VideoProvider {
  createJob(input: VideoJobInput): Promise<VideoJobHandle>;
  getJob(handle: VideoJobHandle): Promise<GenerationJob>;
  cancelJob(handle: VideoJobHandle): Promise<void>;
  downloadResult(handle: VideoJobHandle): Promise<{ url: string; mimeType: string }>;
}

/**
 * Local-only provider used by the MVP. It never calls an external model and
 * keeps the Seedance/Kling/Veo boundary explicit for the real integration.
 */
export class MockVideoProvider implements VideoProvider {
  async createJob(input: VideoJobInput): Promise<VideoJobHandle> {
    return { provider: "mock", remoteId: `mock_${input.projectId}_${input.nodeId}` };
  }

  async getJob(handle: VideoJobHandle): Promise<GenerationJob> {
    return {
      id: handle.remoteId,
      nodeId: handle.remoteId,
      nodeLabel: "Mock 视频任务",
      provider: handle.provider,
      model: "mock-seedance-2.5",
      status: "completed",
      progress: 100,
      createdAt: new Date().toISOString(),
    };
  }

  async cancelJob() {
    return undefined;
  }

  async downloadResult() {
    return { url: "/demo/mock-video.svg", mimeType: "image/svg+xml" };
  }
}

/** Token360 normalized async video API (server-side key only). */
export class Token360VideoProvider implements VideoProvider {
  private readonly base = (process.env.ASSISTANT_BASE_URL ?? "https://api.token360.ai/v1").replace(/\/+$/, "");
  private get key() { return process.env.TOKEN360_API_KEY; }
  private headers() {
    if (!this.key) throw new Error("TOKEN360_API_KEY 未配置");
    return { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" };
  }
  async createJob(input: VideoJobInput): Promise<VideoJobHandle> {
    const body: Record<string, unknown> = {
      model: input.modelId || "seedance-2.5",
      prompt: input.prompt,
      duration: input.duration ?? 5,
      aspect_ratio: input.aspectRatio ?? "16:9",
      resolution: "720p",
      generate_audio: true,
      metadata: { project_id: input.projectId, node_id: input.nodeId, mode: input.mode },
    };
    const frames = input.references.filter((ref) => ref.uri && (ref.role === "first_frame" || ref.role === "last_frame"));
    if (frames.length) body.frame_images = frames.map((ref) => ({ type: "image_url", frame_type: ref.role, image_url: { url: ref.uri } }));
    const refs = input.references.filter((ref) => ref.uri && ref.role !== "first_frame" && ref.role !== "last_frame");
    if (refs.length) body.input_references = refs.map((ref) => ({ type: "image_url", role: ref.role, image_url: { url: ref.uri } }));
    const response = await fetch(`${this.base}/videos`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
    if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? `Token360 视频任务创建失败（${response.status}）`);
    return { provider: "token360", remoteId: payload.id };
  }
  async getJob(handle: VideoJobHandle): Promise<GenerationJob> {
    const response = await fetch(`${this.base}/videos/${encodeURIComponent(handle.remoteId)}`, { headers: this.headers() });
    const payload = await response.json().catch(() => ({})) as { id?: string; status?: string; model?: string; prompt?: string; url?: string; video_url?: string; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Token360 视频任务查询失败（${response.status}）`);
    const status = payload.status === "completed" ? "completed" : payload.status === "failed" ? "failed" : "running";
    return { id: payload.id ?? handle.remoteId, nodeId: "", nodeLabel: "Token360 视频任务", provider: handle.provider, model: payload.model ?? "seedance-2.5", status, progress: status === "completed" ? 100 : status === "failed" ? 0 : 50, createdAt: new Date().toISOString(), error: payload.error?.message, outputUrl: payload.video_url ?? payload.url } as GenerationJob;
  }
  async cancelJob(handle: VideoJobHandle) {
    await fetch(`${this.base}/videos/${encodeURIComponent(handle.remoteId)}`, { method: "DELETE", headers: this.headers() });
  }
  async downloadResult(handle: VideoJobHandle) {
    const response = await fetch(`${this.base}/videos/${encodeURIComponent(handle.remoteId)}/content?format=url`, { headers: this.headers() });
    const payload = await response.json().catch(() => ({})) as { url?: string; video_url?: string };
    if (!response.ok || !(payload.url ?? payload.video_url)) throw new Error("Token360 视频结果尚未就绪");
    return { url: payload.url ?? payload.video_url!, mimeType: "video/mp4" };
  }
}

export function providerForNode(type: CanvasNodeType): string {
  if (type === "video") return "Mock Seedance 2.5";
  if (type === "image_edit" || type === "style_polish") return "Mock Image Edit";
  return "Mock Studio";
}
