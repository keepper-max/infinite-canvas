import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: text("phone").unique(),
  phoneVerified: boolean("phone_verified").default(false).notNull(),
  email: text("email").unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  passwordHash: text("password_hash"),
  nickname: text("nickname"),
  avatar: text("avatar"),
  inviteCode: text("invite_code"),
  sourceType: text("source_type").default("direct").notNull(),
  schoolId: text("school_id"),
  channelId: text("channel_id"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  sourceType: text("source_type").default("social").notNull(),
  schoolId: text("school_id"),
  channelId: text("channel_id"),
  enabled: boolean("enabled").default(true).notNull(),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const inviteCodeRedemptions = pgTable("invite_code_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  inviteCodeId: uuid("invite_code_id").notNull().references(() => inviteCodes.id),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  description: text("description").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").default("editor").notNull(),
});

export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").default("image").notNull(),
  name: text("name").notNull(),
  objectKey: text("object_key").notNull().unique(),
  uri: text("uri").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").default(0).notNull(),
  version: integer("version").default(1).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
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
    nodeType: text("node_type").notNull(),
    label: text("label").notNull(),
    position: jsonb("position").notNull(),
    data: jsonb("data").default({}).notNull(),
    status: text("status").default("idle").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectId, table.id] }) }),
);

export const canvasEdges = pgTable(
  "canvas_edges",
  {
    id: text("id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceNodeId: text("source_node_id").notNull(),
    targetNodeId: text("target_node_id").notNull(),
    edgeType: text("edge_type").default("reference").notNull(),
    data: jsonb("data").default({}).notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.projectId, table.id] }) }),
);

export const canvasSnapshots = pgTable("canvas_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  nodes: jsonb("nodes").notNull(),
  edges: jsonb("edges").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  mode: text("mode").default("edit").notNull(),
  prompt: text("prompt").default("").notNull(),
  input: jsonb("input").default({}).notNull(),
  parameters: jsonb("parameters").default({}).notNull(),
  status: text("status").default("pending").notNull(),
  progress: integer("progress").default(0).notNull(),
  errorReason: text("error_reason"),
  billingTraceId: text("billing_trace_id"),
  billingStatus: text("billing_status").default("not_applicable").notNull(),
  billingAttempts: integer("billing_attempts").default(0).notNull(),
  billedPoints: integer("billed_points"),
  billedAmount: numeric("billed_amount", { precision: 20, scale: 8 }),
  billedCurrency: text("billed_currency"),
  billedFxRate: numeric("billed_fx_rate", { precision: 20, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const jobEvents = pgTable("job_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => generationJobs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  progress: integer("progress").default(0).notNull(),
  message: text("message").default("").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const jobArtifacts = pgTable("job_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => generationJobs.id, { onDelete: "cascade" }),
  uri: text("uri").notNull(),
  mimeType: text("mime_type").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const storyOutlines = pgTable("story_outlines", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").default("").notNull(),
  content: text("content").default("").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projectAgents = pgTable("project_agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").default("agent").notNull(),
  enabled: integer("enabled").default(1).notNull(),
  config: jsonb("config").default({}).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  template: text("template").notNull(),
  status: text("status").default("draft").notNull(),
  input: jsonb("input").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const projectPlugins = pgTable("project_plugins", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled").default(1).notNull(),
  config: jsonb("config").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  category: text("category").default("通用").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const modelConfigs = pgTable("model_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  script: text("script").default("").notNull(),
  apiKeyEnv: text("api_key_env").default("").notNull(),
  enabled: integer("enabled").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const creditAccounts = pgTable("credit_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").default(1000).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const paymentOrders = pgTable("payment_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  amountCents: integer("amount_cents").notNull(),
  credits: integer("credits").notNull(),
  status: text("status").default("pending").notNull(),
  alipayTradeNo: text("alipay_trade_no").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const creditLots = pgTable("credit_lots", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  creditsTotal: integer("credits_total").notNull(),
  creditsRemaining: integer("credits_remaining").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const activationCodes = pgTable("activation_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  codeHint: text("code_hint").notNull(),
  credits: integer("credits").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  redeemedBy: uuid("redeemed_by").references(() => users.id),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  jobId: uuid("job_id").references(() => generationJobs.id, {
    onDelete: "set null",
  }),
  activationCodeId: uuid("activation_code_id").references(() => activationCodes.id),
  paymentOrderId: uuid("payment_order_id").references(() => paymentOrders.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const creditLotDebits = pgTable("credit_lot_debits", {
  ledgerId: uuid("ledger_id").notNull().references(() => creditLedger.id),
  lotId: uuid("lot_id").notNull().references(() => creditLots.id),
  credits: integer("credits").notNull(),
});

export const schema = {
  users,
  inviteCodes,
  inviteCodeRedemptions,
  sessions,
  projects,
  projectMembers,
  assets,
  canvasNodes,
  canvasEdges,
  canvasSnapshots,
  generationJobs,
  jobEvents,
  jobArtifacts,
  storyOutlines,
  projectAgents,
  automationRuns,
  projectPlugins,
  promptTemplates,
  modelConfigs,
  creditAccounts,
  paymentOrders,
  creditLots,
  activationCodes,
  creditLedger,
  creditLotDebits,
};
export type DbSchema = typeof schema;
