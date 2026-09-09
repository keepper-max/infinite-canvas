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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const schema = { users, sessions, projects, projectMembers, canvases };
