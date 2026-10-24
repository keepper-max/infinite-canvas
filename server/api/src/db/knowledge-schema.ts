import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  bigserial,
  bigint,
} from "drizzle-orm/pg-core";
// SQL migration owns the partial indexes/check constraints. These exports expose
// the native knowledge tables to the existing Drizzle database schema.
export const knowledgeImports = pgTable('knowledge_imports', {
  id: uuid('id').primaryKey().defaultRandom(), spaceId: uuid('space_id').notNull(), actorId: uuid('actor_id').notNull(),
  operationId: uuid('operation_id').notNull(), payloadHash:text('payload_hash').notNull(), filename:text('filename').notNull(),
  extension:text('extension').notNull(), mimeType:text('mime_type').notNull(), sha256:text('sha256').notNull(),
  bytes:bigint('bytes',{mode:'number'}).notNull(), storageKey:text('storage_key').notNull(), folderId:uuid('folder_id'),
  state:text('state').notNull(), markdown:text('markdown'), converter:text('converter'), warnings:jsonb('warnings').notNull(),
  pages:jsonb('pages').notNull(), assets:jsonb('assets').notNull(), metrics:jsonb('metrics').notNull(), error:text('error'),
  documentId:uuid('document_id'), documentRevision:integer('document_revision'), reparseDocumentId:uuid('reparse_document_id'), expectedRevision:integer('expected_revision'),
  createdAt:timestamp('created_at',{withTimezone:true}).defaultNow(), updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow(),
});
export const knowledgeSpaces = pgTable("knowledge_spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  ownerUserId: uuid("owner_user_id"),
  projectId: uuid("project_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const knowledgeFolders = pgTable("knowledge_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull(),
  parentId: uuid("parent_id"),
  name: text("name").notNull(),
  revision: integer("revision").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull(),
  folderId: uuid("folder_id"),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  revision: integer("revision").notNull(),
  contentHash: text("content_hash").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
export const knowledgeCopySources = pgTable("knowledge_copy_sources", {
  documentId: uuid("document_id").primaryKey(), sourceSpaceId: uuid("source_space_id").notNull(),
  sourceDocumentId: uuid("source_document_id").notNull(), sourceRevision: integer("source_revision").notNull(),
  sourceHash: text("source_hash").notNull(), copiedBy: uuid("copied_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const knowledgeVersions = pgTable("knowledge_versions", {
  documentId: uuid("document_id").notNull(),
  revision: integer("revision").notNull(),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  contentHash: text("content_hash").notNull(),
  folderId: uuid("folder_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  actorId: uuid("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
});
export const knowledgeTags = pgTable("knowledge_tags", {
  documentId: uuid("document_id").notNull(),
  tag: text("tag").notNull(),
});
export const knowledgeLinks = pgTable("knowledge_links", {
  sourceId: uuid("source_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  targetText: text("target_text").notNull(),
  displayText: text("display_text"),
  targetId: uuid("target_id"),
  boundTargetId: uuid("bound_target_id"),
  candidates: uuid("candidates").array().notNull(),
  status: text("status").notNull(),
});
export const knowledgeDocumentNames = pgTable("knowledge_document_names", {
  documentId: uuid("document_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  name: text("name").notNull(),
});
export const knowledgeOperations = pgTable("knowledge_operations", {
  actorId: uuid("actor_id").notNull(),
  operationId: uuid("operation_id").notNull(),
  spaceId: uuid("space_id"),
  payloadHash: text("payload_hash").notNull(),
  receipt: jsonb("receipt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
});
export const knowledgeAudit = pgTable("knowledge_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: uuid("actor_id").notNull(),
  spaceId: uuid("space_id").notNull(),
  operationId: uuid("operation_id").notNull(),
  action: text("action").notNull(),
  targetId: uuid("target_id"),
  revision: integer("revision"),
  createdAt: timestamp("created_at", { withTimezone: true }),
});
export const knowledgeDocumentProjectGrants = pgTable(
  "knowledge_document_project_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull(),
    targetProjectId: uuid("target_project_id").notNull(),
    grantedByOwner: uuid("granted_by_owner").notNull(),
    capability: text("capability").notNull(),
    pinnedRevision: integer("pinned_revision"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
);
