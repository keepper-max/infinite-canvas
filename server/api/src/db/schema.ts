import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable(
    "sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull().unique(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [index("sessions_token_hash_idx").on(table.tokenHash), index("sessions_user_expiry_idx").on(table.userId, table.expiresAt)],
);

export const projects = pgTable(
    "projects",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        ownerId: uuid("owner_id").notNull().references(() => users.id),
        name: text("name").notNull(),
        description: text("description").default("").notNull(),
        isDefault: boolean("is_default").default(false).notNull(),
        lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }).defaultNow().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [uniqueIndex("projects_owner_default_idx").on(table.ownerId).where(sql`${table.isDefault} = true`), index("projects_recent_idx").on(table.lastOpenedAt, table.updatedAt)],
);

export const projectMembers = pgTable(
    "project_members",
    {
        projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        role: text("role").default("editor").notNull(),
    },
    (table) => [primaryKey({ columns: [table.projectId, table.userId] }), index("project_members_user_idx").on(table.userId)],
);

export const canvases = pgTable("canvases", {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").default(0).notNull(),
    contractVersion: integer("contract_version").default(1).notNull(),
    viewport: jsonb("viewport").default({ x: 0, y: 0, k: 1 }).notNull(),
    settings: jsonb("settings").default({ backgroundMode: "lines", showImageInfo: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const canvasNodes = pgTable(
    "canvas_nodes",
    {
        id: text("id").notNull(),
        projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
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
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.projectId, table.id] }), index("canvas_nodes_project_updated_idx").on(table.projectId, table.updatedAt)],
);

export const canvasEdges = pgTable(
    "canvas_edges",
    {
        id: text("id").notNull(),
        projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
        sourceNodeId: text("source_node_id").notNull(),
        sourcePortId: text("source_port_id").default("legacy.output").notNull(),
        targetNodeId: text("target_node_id").notNull(),
        targetPortId: text("target_port_id").default("legacy.input").notNull(),
        resourceType: text("resource_type").default("asset").notNull(),
        role: text("role").default("data").notNull(),
        sortOrder: integer("sort_order").default(0).notNull(),
        edgeType: text("edge_type").default("reference").notNull(),
        data: jsonb("data").default({}).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [primaryKey({ columns: [table.projectId, table.id] }), index("canvas_edges_project_target_idx").on(table.projectId, table.targetNodeId, table.sortOrder)],
);

export const canvasSnapshots = pgTable(
    "canvas_snapshots",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
        version: integer("version").notNull(),
        contractVersion: integer("contract_version").default(1).notNull(),
        nodes: jsonb("nodes").notNull(),
        edges: jsonb("edges").notNull(),
        viewport: jsonb("viewport").default({ x: 0, y: 0, k: 1 }).notNull(),
        settings: jsonb("settings").default({ backgroundMode: "lines", showImageInfo: false }).notNull(),
        source: text("source").default("save").notNull(),
        restoredFromVersion: integer("restored_from_version"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [uniqueIndex("canvas_snapshots_project_version_idx").on(table.projectId, table.version), index("canvas_snapshots_project_created_idx").on(table.projectId, table.createdAt)],
);

export const canvasMigrations = pgTable(
    "canvas_migrations",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        migrationKey: text("migration_key").notNull(),
        fromRevision: integer("from_revision").default(0).notNull(),
        toRevision: integer("to_revision").notNull(),
        report: jsonb("report").default({}).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [uniqueIndex("canvas_migrations_project_user_key_idx").on(table.projectId, table.userId, table.migrationKey)],
);

export const schema = { users, sessions, projects, projectMembers, canvases, canvasNodes, canvasEdges, canvasSnapshots, canvasMigrations };
