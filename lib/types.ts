export const NODE_TYPES = [
  "prompt",
  "character",
  "scene",
  "panorama",
  "composition_3d",
  "keyframe",
  "image_edit",
  "style_polish",
  "video",
  "audio",
  "output",
] as const;

export type CanvasNodeType = (typeof NODE_TYPES)[number];

export type JobStatus = "pending" | "running" | "completed" | "failed";

export type CanvasNodeData = {
  label: string;
  description: string;
  status: JobStatus | "idle";
  output?: string;
  locked?: boolean;
  [key: string]: unknown;
};

export type GenerationJob = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  provider: string;
  model: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  error?: string;
};

export type Project = {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  nodeCount: number;
  status: "draft" | "processing" | "completed";
};

