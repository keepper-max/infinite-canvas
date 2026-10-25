import type { KnowledgeService } from "../knowledge-service.js";
import { DomainError } from "../domain.js";
/** Shared formal knowledge authorization before exposing history, reserving cost or sending context. */
export async function validateAgentSources(
  knowledge: KnowledgeService,
  run: { actor_id: string; project_id: string; sources?: any[] },
) {
  if (!run.sources?.length) return;
  const spaces = await knowledge.spaces(run.actor_id);
  for (const source of run.sources ?? []) {
    if (
      !spaces.some(
        (s) =>
          s.id === source.spaceId &&
          (s.kind === "personal" || s.project_id === run.project_id),
      )
    )
      throw new DomainError(
        "AGENT_SOURCE_REVOKED",
        "知识来源权限已撤销，停止读取和模型提交",
        403,
      );
    if (!source.documentId) {
      await knowledge.run(
        run.actor_id,
        source.spaceId,
        false,
        async () => undefined,
      );
      continue;
    }
    const current = await knowledge.read(
      run.actor_id,
      source.spaceId,
      source.documentId,
    );
    if (current.deletedAt)
      throw new DomainError(
        "AGENT_SOURCE_REVOKED",
        "已引用知识被删除，原记录保留",
        403,
      );
    const version = await knowledge.version(
      run.actor_id,
      source.spaceId,
      source.documentId,
      source.revision,
    );
    if (version.deleted_at || version.content_hash !== source.contentHash)
      throw new DomainError(
        "AGENT_SOURCE_CHANGED",
        "资料历史版本校验失败，停止向模型提交",
        409,
      );
  }
}
