import { z } from "zod";

export const knowledgeReferenceSchema = z.discriminatedUnion("mode", [
  z
    .object({
      spaceId: z.string().uuid(),
      documentId: z.string().uuid(),
      mode: z.literal("latest"),
    })
    .strict(),
  z
    .object({
      spaceId: z.string().uuid(),
      documentId: z.string().uuid(),
      mode: z.literal("pinned"),
      revision: z.number().int().positive(),
    })
    .strict(),
]);
export type KnowledgeReference = z.infer<typeof knowledgeReferenceSchema>;
