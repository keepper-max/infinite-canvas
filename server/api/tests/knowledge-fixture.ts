import { sql } from "drizzle-orm";
import { PostgresPlatformRepository as BaseRepository } from "../src/repository.js";
import type { PlatformDatabase } from "../src/db/client.js";
// Explicit opt-in for historical knowledge suites only. Production registrations remain default-off.
export class PostgresPlatformRepository extends BaseRepository {
  constructor(private readonly fixtureDb: PlatformDatabase) {
    super(fixtureDb);
  }
  override async createUserWithWorkspace(
    ...args: Parameters<BaseRepository["createUserWithWorkspace"]>
  ) {
    const result = await super.createUserWithWorkspace(...args);
    await this.fixtureDb.execute(
      sql`insert into user_feature_grants(user_id,feature,enabled,updated_by,reason) values(${result.user.id},'knowledge',true,${result.user.id},'isolated knowledge test fixture')`,
    );
    return result;
  }
  override async saveCanvasForUser(
    ...args: Parameters<BaseRepository["saveCanvasForUser"]>
  ) {
    const [project, user, input, source] = args;
    const current = await this.getCanvasForUser(project, user);
    if (
      current &&
      (current.nodes.some((n) => n.type === "knowledge:document") ||
        input.nodes.some((n) => n.type === "knowledge:document")) &&
      source !== "restore"
    ) {
      const ack = current.nodes
        .filter((n) => n.type === "knowledge:document")
        .map((n) => ({
          id: n.id,
          reference: n.metadata?.knowledgeReference ?? null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const proof = await this.issueCanvasWriteCapability(
        project,
        user,
        input.expectedRevision,
        ack,
      );
      args[2] = {
        ...input,
        writeCapability: {
          token: proof.token,
          deletedKnowledgeNodeIds: ack
            .filter((n) => !input.nodes.some((d) => d.id === n.id))
            .map((n) => n.id),
        },
      };
    }
    return super.saveCanvasForUser(...args);
  }
}
