import { z } from "zod";

export const createVirtualPortraitSchema = z
  .object({
    assetVersionId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const archiveVirtualPortraitSchema = z.object({}).strict();

export type VirtualPortraitDocument = {
  id: string;
  projectId: string;
  name: string;
  status: "processing" | "active" | "failed";
  errorMessage: string | null;
  sourceAssetId: string;
  sourceAssetVersionId: string;
  providerAssetId: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
};
