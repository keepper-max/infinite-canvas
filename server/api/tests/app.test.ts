import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../src/app.js";
import { DomainError, type PlatformRepository, type PlatformUser, type ProjectSummary, type Workspace } from "../src/domain.js";
import type { ApiConfig } from "../src/config.js";

const config: ApiConfig = {
    port: 3002,
    databaseUrl: "postgresql://unused",
    cookieName: "test_session",
    cookieSecure: false,
    sessionDays: 14,
    trustedOrigins: [],
};

test("register creates one workspace and subsequent login reuses it", async () => {
    const repository = new MemoryRepository();
    const app = createApp(repository, config);
    const registered = await jsonRequest(app, "/api/auth/register", { email: "first@example.com", password: "password-123" });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.data.workspace.projectTitle, "未命名项目");
    assert.equal(repository.workspaces.size, 1);

    const loggedIn = await jsonRequest(app, "/api/auth/login", { email: "first@example.com", password: "password-123" });
    assert.equal(loggedIn.response.status, 200);
    assert.equal(loggedIn.body.data.workspace.projectId, registered.body.data.workspace.projectId);
    assert.equal(repository.workspaces.size, 1);
});

test("duplicate email and wrong password return stable errors", async () => {
    const repository = new MemoryRepository();
    const app = createApp(repository, config);
    await jsonRequest(app, "/api/auth/register", { email: "same@example.com", password: "password-123" });
    const duplicate = await jsonRequest(app, "/api/auth/register", { email: "SAME@example.com", password: "password-456" });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.error.code, "EMAIL_ALREADY_REGISTERED");
    const wrong = await jsonRequest(app, "/api/auth/login", { email: "same@example.com", password: "not-the-password" });
    assert.equal(wrong.response.status, 401);
    assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");
});

test("session survives a new app instance and logout revokes it", async () => {
    const repository = new MemoryRepository();
    const firstApp = createApp(repository, config);
    const registered = await jsonRequest(firstApp, "/api/auth/register", { email: "persist@example.com", password: "password-123" });
    const cookie = cookieFrom(registered.response);
    const restartedApp = createApp(repository, config);
    const me = await restartedApp.request("/api/auth/me", { headers: { cookie } });
    assert.equal(me.status, 200);
    const logout = await restartedApp.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 200);
    const after = await restartedApp.request("/api/auth/me", { headers: { cookie } });
    assert.equal(after.status, 401);
});

test("project lookup is scoped to the signed-in member", async () => {
    const repository = new MemoryRepository();
    const app = createApp(repository, config);
    const first = await jsonRequest(app, "/api/auth/register", { email: "a@example.com", password: "password-123" });
    const second = await jsonRequest(app, "/api/auth/register", { email: "b@example.com", password: "password-123" });
    const response = await app.request(`/api/projects/${second.body.data.workspace.projectId}`, { headers: { cookie: cookieFrom(first.response) } });
    const body = await response.json() as any;
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "PROJECT_FORBIDDEN");
});

test("cross-site state changes are rejected", async () => {
    const app = createApp(new MemoryRepository(), config);
    const response = await app.request("http://local.test/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ email: "blocked@example.com", password: "password-123" }),
    });
    assert.equal(response.status, 403);
});

async function jsonRequest(app: ReturnType<typeof createApp>, path: string, body: unknown) {
    const response = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { response, body: await response.json() as any };
}

function cookieFrom(response: Response) {
    const value = response.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(value);
    return value;
}

class MemoryRepository implements PlatformRepository {
    users = new Map<string, PlatformUser & { passwordHash: string }>();
    sessions = new Map<string, { userId: string; expiresAt: Date }>();
    workspaces = new Map<string, Workspace>();

    async createUserWithWorkspace(email: string, passwordHash: string) {
        if ([...this.users.values()].some((user) => user.email === email)) throw new DomainError("EMAIL_ALREADY_REGISTERED", "邮箱已注册", 409);
        const user = { id: crypto.randomUUID(), email, passwordHash };
        this.users.set(user.id, user);
        const workspace = this.workspaceFor(user.id);
        return { user: { id: user.id, email: user.email }, workspace };
    }

    async findUserByEmail(email: string) {
        return [...this.users.values()].find((user) => user.email === email) || null;
    }

    async createSession(userId: string, tokenHash: string, expiresAt: Date) {
        this.sessions.set(tokenHash, { userId, expiresAt });
    }

    async findUserBySession(tokenHash: string, now: Date) {
        const session = this.sessions.get(tokenHash);
        const user = session && session.expiresAt > now ? this.users.get(session.userId) : null;
        return user ? { id: user.id, email: user.email } : null;
    }

    async deleteSession(tokenHash: string) {
        this.sessions.delete(tokenHash);
    }

    async ensureDefaultWorkspace(userId: string) {
        return this.workspaceFor(userId);
    }

    async listProjects(userId: string): Promise<ProjectSummary[]> {
        const workspace = this.workspaces.get(userId);
        return workspace ? [{ ...workspace, role: "owner" }] : [];
    }

    async getProjectForUser(projectId: string, userId: string): Promise<ProjectSummary | null> {
        const workspace = this.workspaces.get(userId);
        return workspace?.projectId === projectId ? { ...workspace, role: "owner" } : null;
    }

    async isReady() {
        return true;
    }

    private workspaceFor(userId: string) {
        const existing = this.workspaces.get(userId);
        if (existing) return existing;
        const now = new Date().toISOString();
        const workspace = { projectId: crypto.randomUUID(), projectTitle: "未命名项目", projectDescription: "", canvasId: crypto.randomUUID(), isDefault: true, updatedAt: now };
        this.workspaces.set(userId, workspace);
        return workspace;
    }
}
