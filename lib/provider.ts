import type { CanvasNodeType, GenerationJob } from "./types";

export type VideoMode = "T2V" | "I2V" | "R2V" | "FLF2V" | "edit";

export type VideoJobInput = {
  projectId: string;
  nodeId: string;
  mode: VideoMode;
  prompt: string;
  references: Array<{ assetId: string; role: string }>;
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

export function providerForNode(type: CanvasNodeType): string {
  if (type === "video") return "Mock Seedance 2.5";
  if (type === "image_edit" || type === "style_polish") return "Mock Image Edit";
  return "Mock Studio";
}
