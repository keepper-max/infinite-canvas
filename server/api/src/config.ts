export type ApiConfig = {
    port: number;
    databaseUrl: string;
    cookieName: string;
    cookieSecure: boolean;
    sessionDays: number;
    trustedOrigins: string[];
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const port = Number(env.API_PORT || 3002);
    const sessionDays = Number(env.SESSION_DAYS || 14);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid port");
    if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90) throw new Error("SESSION_DAYS must be between 1 and 90");
    return {
        port,
        databaseUrl,
        cookieName: env.SESSION_COOKIE_NAME?.trim() || "jingjie_session",
        cookieSecure: env.COOKIE_SECURE === "true",
        sessionDays,
        trustedOrigins: (env.TRUSTED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
    };
}
