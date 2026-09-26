export type ApiConfig = {
  port: number;
  databaseUrl: string;
  cookieName: string;
  cookieSecure: boolean;
  sessionDays: number;
  trustedOrigins: string[];
  objectStorage: ObjectStorageConfig;
  jobs: JobConfig;
  provider: ProviderConfig;
  runningHub: RunningHubConfig;
  runningHubGlobal: RunningHubConfig;
  operations: OperationsConfig;
  payments: PaymentConfig;
  assetTrashRetentionDays: number;
  assetUnusedRetentionDays: number;
  assetStorageQuotaBytes: number;
  emailVerification?: EmailVerificationConfig;
};

export type EmailVerificationConfig = {
  enabled: boolean;
  accessKeyId: string;
  accessKeySecret: string;
  accountName: string;
  fromAlias: string;
  hashSecret: string;
  codeTtlSeconds: number;
  resendCooldownSeconds: number;
  maxSendsPerHour: number;
  maxSendsPerIpHour: number;
  maxAttempts: number;
};

export type OperationsConfig = { adminEmails: string[] };

export type PaymentConfig = {
  provider: "alipay" | "disabled";
  enabled: boolean;
  complianceApproved: boolean;
  adminOnly: boolean;
  publicBaseUrl: string;
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  sellerId: string;
  orderTimeoutMinutes?: number;
};

export type JobConfig = {
  redisUrl: string;
  queueName: string;
  transferQueueName: string;
  transferWorkerConcurrency: number;
  compositionQueueName: string;
  compositionWorkerConcurrency: number;
  ffmpegPath: string;
  workerConcurrency: number;
  maxAttempts: number;
  submitTimeoutMs: number;
  videoPollIntervalMs: number;
  maxRuntimeMs: number;
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  catalogUrl: string;
};

export type RunningHubConfig = ProviderConfig;

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
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("API_PORT must be a valid port");
  if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90)
    throw new Error("SESSION_DAYS must be between 1 and 90");
  const objectStorage = readObjectStorageConfig(env);
  const jobs = {
    redisUrl: env.REDIS_URL?.trim() || "redis://redis:6379",
    queueName: env.JOB_QUEUE_NAME?.trim() || "generation-jobs",
    transferQueueName:
      env.TRANSFER_QUEUE_NAME?.trim() || "generation-transfers",
    transferWorkerConcurrency: readInteger(
      env.TRANSFER_WORKER_CONCURRENCY,
      4,
      1,
      16,
      "TRANSFER_WORKER_CONCURRENCY",
    ),
    compositionQueueName:
      env.COMPOSITION_QUEUE_NAME?.trim() || "composition-jobs",
    compositionWorkerConcurrency: readInteger(
      env.COMPOSITION_WORKER_CONCURRENCY,
      1,
      1,
      4,
      "COMPOSITION_WORKER_CONCURRENCY",
    ),
    ffmpegPath: env.FFMPEG_PATH?.trim() || "ffmpeg",
    workerConcurrency: readInteger(
      env.WORKER_CONCURRENCY,
      2,
      1,
      32,
      "WORKER_CONCURRENCY",
    ),
    maxAttempts: readInteger(
      env.JOB_MAX_ATTEMPTS,
      3,
      1,
      10,
      "JOB_MAX_ATTEMPTS",
    ),
    submitTimeoutMs: readInteger(
      env.PROVIDER_SUBMIT_TIMEOUT_MS,
      0,
      0,
      300_000,
      "PROVIDER_SUBMIT_TIMEOUT_MS",
    ),
    videoPollIntervalMs: readInteger(
      env.VIDEO_POLL_INTERVAL_MS,
      2_000,
      1_000,
      60_000,
      "VIDEO_POLL_INTERVAL_MS",
    ),
    maxRuntimeMs: readInteger(
      env.JOB_MAX_RUNTIME_MS,
      0,
      0,
      86_400_000,
      "JOB_MAX_RUNTIME_MS",
    ),
  };
  const provider = {
    baseUrl: (env.TOKEN360_UPSTREAM || "https://api.token360.ai").replace(
      /\/+$/,
      "",
    ),
    apiKey: env.TOKEN360_API_KEY?.trim() || "",
    catalogUrl:
      env.TOKEN360_CATALOG_URL?.trim() ||
      "https://api.token360.ai/public/models?size=200&current=1",
  };
  const runningHub = {
    baseUrl: (
      env.RH_API_BASE_URL || "https://www.runninghub.cn/openapi/v2"
    ).replace(/\/+$/, ""),
    apiKey: env.RH_API_KEY?.trim() || "",
    catalogUrl:
      env.RH_MODEL_REGISTRY_URL?.trim() ||
      "https://raw.githubusercontent.com/HM-RunningHub/ComfyUI_RH_OpenAPI/main/developer-kit/model-registry.public.json",
  };
  const runningHubGlobal = {
    baseUrl: (
      env.RH_GLOBAL_API_BASE_URL || "https://www.runninghub.ai/openapi/v2"
    ).replace(/\/+$/, ""),
    apiKey: env.RH_GLOBAL_API_KEY?.trim() || "",
    catalogUrl: "",
  };
  const operations = {
    adminEmails: (env.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  };
  const payments = readPaymentConfig(env);
  const assetTrashRetentionDays = readInteger(
    env.ASSET_TRASH_RETENTION_DAYS,
    14,
    1,
    365,
    "ASSET_TRASH_RETENTION_DAYS",
  );
  const assetUnusedRetentionDays = readInteger(
    env.ASSET_UNUSED_RETENTION_DAYS,
    30,
    1,
    365,
    "ASSET_UNUSED_RETENTION_DAYS",
  );
  const assetStorageQuotaBytes = readInteger(
    env.ASSET_STORAGE_QUOTA_BYTES,
    1_073_741_824,
    1,
    Number.MAX_SAFE_INTEGER,
    "ASSET_STORAGE_QUOTA_BYTES",
  );
  const emailVerification = readEmailVerificationConfig(env);
  return {
    port,
    databaseUrl,
    cookieName: env.SESSION_COOKIE_NAME?.trim() || "jingjie_session",
    cookieSecure: env.COOKIE_SECURE === "true",
    sessionDays,
    trustedOrigins: (env.TRUSTED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    objectStorage,
    jobs,
    provider,
    runningHub,
    runningHubGlobal,
    operations,
    payments,
    assetTrashRetentionDays,
    assetUnusedRetentionDays,
    assetStorageQuotaBytes,
    emailVerification,
  };
}

function readEmailVerificationConfig(
  env: NodeJS.ProcessEnv,
): EmailVerificationConfig {
  const enabled = env.EMAIL_VERIFICATION_ENABLED === "true";
  const config = {
    enabled,
    accessKeyId: env.ALIYUN_DIRECTMAIL_ACCESS_KEY_ID?.trim() || "",
    accessKeySecret: env.ALIYUN_DIRECTMAIL_ACCESS_KEY_SECRET?.trim() || "",
    accountName:
      env.ALIYUN_DIRECTMAIL_ACCOUNT_NAME?.trim() ||
      "verify@mail.shoumiren.online",
    fromAlias: env.ALIYUN_DIRECTMAIL_FROM_ALIAS?.trim() || "守守画布",
    hashSecret: env.EMAIL_VERIFICATION_HASH_SECRET?.trim() || "",
    codeTtlSeconds: readInteger(
      env.EMAIL_VERIFICATION_TTL_SECONDS,
      300,
      60,
      1_800,
      "EMAIL_VERIFICATION_TTL_SECONDS",
    ),
    resendCooldownSeconds: readInteger(
      env.EMAIL_VERIFICATION_RESEND_SECONDS,
      60,
      30,
      600,
      "EMAIL_VERIFICATION_RESEND_SECONDS",
    ),
    maxSendsPerHour: readInteger(
      env.EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR,
      5,
      1,
      20,
      "EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR",
    ),
    maxSendsPerIpHour: readInteger(
      env.EMAIL_VERIFICATION_MAX_SENDS_PER_IP_HOUR,
      20,
      1,
      100,
      "EMAIL_VERIFICATION_MAX_SENDS_PER_IP_HOUR",
    ),
    maxAttempts: readInteger(
      env.EMAIL_VERIFICATION_MAX_ATTEMPTS,
      5,
      1,
      10,
      "EMAIL_VERIFICATION_MAX_ATTEMPTS",
    ),
  };
  if (
    enabled &&
    (!config.accessKeyId ||
      !config.accessKeySecret ||
      !config.accountName ||
      config.hashSecret.length < 32)
  )
    throw new Error(
      "Enabled email verification requires DirectMail credentials, an account name, and a hash secret of at least 32 characters",
    );
  return config;
}

function readPaymentConfig(env: NodeJS.ProcessEnv): PaymentConfig {
  const provider = env.PAYMENT_PROVIDER === "alipay" ? "alipay" : "disabled";
  const enabled = env.PAYMENT_ENABLED === "true";
  const complianceApproved = env.PAYMENT_COMPLIANCE_APPROVED === "true";
  const adminOnly = env.PAYMENT_ADMIN_ONLY !== "false";
  const publicBaseUrl = (env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  const appId = (env.ALIPAY_APP_ID || "").trim();
  const privateKey = (env.ALIPAY_APP_PRIVATE_KEY_PEM || "").replace(/\\n/g, "\n").trim();
  const alipayPublicKey = (env.ALIPAY_PUBLIC_KEY_PEM || "").replace(/\\n/g, "\n").trim();
  const sellerId = (env.ALIPAY_SELLER_ID || "").trim();
  const timeoutText = (env.ALIPAY_ORDER_TIMEOUT_MINUTES || "").trim();
  const orderTimeoutMinutes = timeoutText
    ? readInteger(timeoutText, 0, 5, 1_440, "ALIPAY_ORDER_TIMEOUT_MINUTES")
    : undefined;
  if (enabled) {
    if (provider !== "alipay" || !complianceApproved)
      throw new Error("Enabled payments require the approved alipay provider");
    if (!publicBaseUrl.startsWith("https://"))
      throw new Error("PUBLIC_BASE_URL must use HTTPS when payments are enabled");
    if (!appId || !privateKey || !alipayPublicKey || !sellerId || !orderTimeoutMinutes)
      throw new Error("Enabled payments require complete Alipay configuration");
  }
  return {
    provider,
    enabled,
    complianceApproved,
    adminOnly,
    publicBaseUrl,
    appId,
    privateKey,
    alipayPublicKey,
    sellerId,
    orderTimeoutMinutes,
  };
}

function readInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return parsed;
}

function readObjectStorageConfig(env: NodeJS.ProcessEnv): ObjectStorageConfig {
  const endpoint = env.OBJECT_STORAGE_ENDPOINT?.trim();
  const publicEndpoint = env.OBJECT_STORAGE_PUBLIC_ENDPOINT?.trim() || endpoint;
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim();
  const accessKeyId = env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  if (
    !endpoint ||
    !publicEndpoint ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw new Error("Object storage configuration is required");
  for (const [name, value] of [
    ["OBJECT_STORAGE_ENDPOINT", endpoint],
    ["OBJECT_STORAGE_PUBLIC_ENDPOINT", publicEndpoint],
  ] as const) {
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
