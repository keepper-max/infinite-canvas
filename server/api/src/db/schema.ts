import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  accountStatus: text("account_status").default("active").notNull(),
  disabledReason: text("disabled_reason"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledBy: uuid("disabled_by"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("projects_owner_default_idx")
      .on(table.ownerId)
      .where(sql`${table.isDefault} = true and ${table.deletedAt} is null`),
    index("projects_recent_idx").on(table.lastOpenedAt, table.updatedAt),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").default("editor").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_members_user_idx").on(table.userId),
  ],
);

export const canvases = pgTable("canvases", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  revision: integer("revision").default(0).notNull(),
  contractVersion: integer("contract_version").default(1).notNull(),
  viewport: jsonb("viewport").default({ x: 0, y: 0, k: 1 }).notNull(),
  settings: jsonb("settings")
    .default({ backgroundMode: "lines", showImageInfo: false })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const canvasNodes = pgTable(
  "canvas_nodes",
  {
    id: text("id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    definitionId: text("definition_id").default("legacy").notNull(),
    definitionVersion: integer("definition_version").default(1).notNull(),
    nodeType: text("node_type").notNull(),
    workflowKind: text("workflow_kind").default("generic").notNull(),
    label: text("label").notNull(),
    position: jsonb("position").notNull(),
    width: integer("width").default(320).notNull(),
    height: integer("height").default(220).notNull(),
    locked: boolean("locked").default(false).notNull(),
    groupId: text("group_id"),
    sortOrder: integer("sort_order").default(0).notNull(),
    data: jsonb("data").default({}).notNull(),
    status: text("status").default("idle").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id] }),
    index("canvas_nodes_project_updated_idx").on(
      table.projectId,
      table.updatedAt,
    ),
  ],
);

export const canvasEdges = pgTable(
  "canvas_edges",
  {
    id: text("id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id").notNull(),
    sourcePortId: text("source_port_id").default("legacy.output").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    targetPortId: text("target_port_id").default("legacy.input").notNull(),
    resourceType: text("resource_type").default("asset").notNull(),
    role: text("role").default("data").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    edgeType: text("edge_type").default("reference").notNull(),
    data: jsonb("data").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id] }),
    index("canvas_edges_project_target_idx").on(
      table.projectId,
      table.targetNodeId,
      table.sortOrder,
    ),
  ],
);

export const canvasSnapshots = pgTable(
  "canvas_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contractVersion: integer("contract_version").default(1).notNull(),
    nodes: jsonb("nodes").notNull(),
    edges: jsonb("edges").notNull(),
    viewport: jsonb("viewport").default({ x: 0, y: 0, k: 1 }).notNull(),
    settings: jsonb("settings")
      .default({ backgroundMode: "lines", showImageInfo: false })
      .notNull(),
    source: text("source").default("save").notNull(),
    restoredFromVersion: integer("restored_from_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("canvas_snapshots_project_version_idx").on(
      table.projectId,
      table.version,
    ),
    index("canvas_snapshots_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const canvasMigrations = pgTable(
  "canvas_migrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    migrationKey: text("migration_key").notNull(),
    fromRevision: integer("from_revision").default(0).notNull(),
    toRevision: integer("to_revision").notNull(),
    report: jsonb("report").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("canvas_migrations_project_user_key_idx").on(
      table.projectId,
      table.userId,
      table.migrationKey,
    ),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    currentVersionId: uuid("current_version_id"),
    status: text("status").default("active").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
  },
  (table) => [
    index("assets_project_status_updated_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const assetVersions = pgTable(
  "asset_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).default(0).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    sha256: text("sha256").notNull(),
    source: text("source").notNull(),
    sourceJobId: uuid("source_job_id"),
    parentVersionIds: jsonb("parent_version_ids").default([]).notNull(),
    provenance: jsonb("provenance").default({}).notNull(),
    thumbnailStorageKey: text("thumbnail_storage_key").unique(),
    thumbnailMimeType: text("thumbnail_mime_type"),
    thumbnailBytes: bigint("thumbnail_bytes", { mode: "number" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("asset_versions_asset_version_idx").on(
      table.assetId,
      table.version,
    ),
    index("asset_versions_asset_created_idx").on(
      table.assetId,
      table.createdAt,
    ),
  ],
);

export const virtualPortraitLibraries = pgTable("virtual_portrait_libraries", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  providerGroupId: text("provider_group_id").notNull().unique(),
  name: text("name").notNull(),
  providerStatus: text("provider_status").default("active").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const virtualPortraits = pgTable(
  "virtual_portraits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => virtualPortraitLibraries.id, { onDelete: "cascade" }),
    sourceAssetId: uuid("source_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sourceAssetVersionId: uuid("source_asset_version_id")
      .notNull()
      .references(() => assetVersions.id, { onDelete: "restrict" }),
    providerRecordId: text("provider_record_id"),
    providerAssetId: text("provider_asset_id").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").default("processing").notNull(),
    errorMessage: text("error_message"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("virtual_portraits_project_status_updated_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const assetLinks = pgTable(
  "asset_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetVersionId: uuid("asset_version_id")
      .notNull()
      .references(() => assetVersions.id, { onDelete: "restrict" }),
    nodeId: text("node_id"),
    role: text("role").default("reference").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("asset_links_project_version_idx").on(
      table.projectId,
      table.assetVersionId,
    ),
    index("asset_links_project_node_idx").on(table.projectId, table.nodeId),
  ],
);

export const trashItems = pgTable(
  "trash_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    reason: text("reason").default("").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    deletedBy: uuid("deleted_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("trash_items_active_object_idx").on(
      table.projectId,
      table.objectType,
      table.objectId,
    ),
  ],
);

export const assetPurgeJobs = pgTable(
  "asset_purge_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    assetId: uuid("asset_id").notNull().unique(),
    storageKeys: jsonb("storage_keys").default([]).notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("asset_purge_jobs_status_requested_idx").on(
      table.status,
      table.requestedAt,
    ),
  ],
);

export const assetUploads = pgTable(
  "asset_uploads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    source: text("source").notNull(),
    parentVersionIds: jsonb("parent_version_ids").default([]).notNull(),
    provenance: jsonb("provenance").default({}).notNull(),
    thumbnailStorageKey: text("thumbnail_storage_key").unique(),
    thumbnailMimeType: text("thumbnail_mime_type"),
    thumbnailBytes: bigint("thumbnail_bytes", { mode: "number" }),
    thumbnailSha256: text("thumbnail_sha256"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("asset_uploads_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const smsVerificationRequests = pgTable("sms_verification_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: text("phone").notNull(),
  purpose: text("purpose").notNull(),
  codeHash: text("code_hash"),
  status: text("status").default("disabled").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const creditAccounts = pgTable("credit_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: bigint("balance", { mode: "bigint" }).default(0n).notNull(),
  reserved: bigint("reserved", { mode: "bigint" }).default(0n).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const creditLedger = pgTable("credit_ledger", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => creditAccounts.id, { onDelete: "cascade" }),
  entryType: text("entry_type").notNull(),
  delta: bigint("delta", { mode: "bigint" }).notNull(),
  balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const creditLots = pgTable("credit_lots", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => creditAccounts.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  credits: bigint("credits", { mode: "bigint" }).notNull(),
  remaining: bigint("remaining", { mode: "bigint" }).notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}).notNull(),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const activationCodes = pgTable("activation_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  codeHint: text("code_hint").notNull(),
  credits: bigint("credits", { mode: "bigint" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  redeemedBy: uuid("redeemed_by").references(() => users.id, { onDelete: "set null" }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const creditLotAllocations = pgTable(
  "credit_lot_allocations",
  {
    ledgerId: bigint("ledger_id", { mode: "bigint" })
      .notNull()
      .references(() => creditLedger.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => creditLots.id, { onDelete: "restrict" }),
    credits: bigint("credits", { mode: "bigint" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.ledgerId, table.lotId] })],
);

export const billingPlans = pgTable("billing_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  credits: bigint("credits", { mode: "number" }).default(0).notNull(),
  priceCents: integer("price_cents").default(0).notNull(),
  currency: text("currency").default("CNY").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const paymentOrders = pgTable("payment_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  planId: text("plan_id").references(() => billingPlans.id, {
    onDelete: "restrict",
  }),
  amountCents: integer("amount_cents").default(0).notNull(),
  credits: bigint("credits", { mode: "bigint" }).default(0n).notNull(),
  currency: text("currency").default("CNY").notNull(),
  provider: text("provider").notNull(),
  providerOrderId: text("provider_order_id"),
  status: text("status").default("disabled").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const paymentCallbackReceipts = pgTable("payment_callback_receipts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  signatureValid: boolean("signature_valid").default(false).notNull(),
  status: text("status").default("disabled").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);

export const teamProjects = pgTable(
  "team_projects",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.projectId] })],
);

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  requestId: text("request_id"),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const schema = {
  users,
  sessions,
  projects,
  projectMembers,
  canvases,
  canvasNodes,
  canvasEdges,
  canvasSnapshots,
  canvasMigrations,
  assets,
  assetVersions,
  assetLinks,
  trashItems,
  assetPurgeJobs,
  assetUploads,
  smsVerificationRequests,
  creditAccounts,
  creditLedger,
  creditLots,
  creditLotAllocations,
  billingPlans,
  paymentOrders,
  paymentCallbackReceipts,
  teams,
  teamMembers,
  teamProjects,
  adminAuditLogs,
};
