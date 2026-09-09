export type ApiConfig = {
    port: number;
    databaseUrl: string;
    cookieName: string;
    cookieSecure: boolean;
    sessionDays: number;
    trustedOrigins: string[];
    objectStorage: ObjectStorageConfig;
};

export type ObjectStorageConfig = {
    endpoint: string;
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    autoCreateBucket: boolean;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
    const databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const port = Number(env.API_PORT || 3002);
    const sessionDays = Number(env.SESSION_DAYS || 14);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be a valid port");
    if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90) throw new Error("SESSION_DAYS must be between 1 and 90");
    const objectStorage = readObjectStorageConfig(env);
    return {
        port,
        databaseUrl,
        cookieName: env.SESSION_COOKIE_NAME?.trim() || "jingjie_session",
        cookieSecure: env.COOKIE_SECURE === "true",
        sessionDays,
        trustedOrigins: (env.TRUSTED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
        objectStorage,
    };
}

function readObjectStorageConfig(env: NodeJS.ProcessEnv): ObjectStorageConfig {
    const endpoint = env.OBJECT_STORAGE_ENDPOINT?.trim();
    const publicEndpoint = env.OBJECT_STORAGE_PUBLIC_ENDPOINT?.trim() || endpoint;
    const bucket = env.OBJECT_STORAGE_BUCKET?.trim();
    const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
    if (!endpoint || !publicEndpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("Object storage configuration is required");
    for (const [name, value] of [["OBJECT_STORAGE_ENDPOINT", endpoint], ["OBJECT_STORAGE_PUBLIC_ENDPOINT", publicEndpoint]] as const) {
        try {
            new URL(value);
        } catch {
            throw new Error(`${name} must be a valid URL`);
        }
    }
    return {
        endpoint,
        publicEndpoint,
        region: env.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
        bucket,
        accessKeyId,
        secretAccessKey,
        forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "false",
        autoCreateBucket: env.OBJECT_STORAGE_AUTO_CREATE_BUCKET === "true",
    };
}
