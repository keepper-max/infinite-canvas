import { existsSync } from "node:fs";

async function main() {
  for (const file of [".env", ".env.local", ".env.mcp"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
  if (process.env.SHOUSHOU_MCP_DATABASE_URL) process.env.DATABASE_URL = process.env.SHOUSHOU_MCP_DATABASE_URL;
  if (process.env.SHOUSHOU_MCP_REDIS_URL) process.env.REDIS_URL = process.env.SHOUSHOU_MCP_REDIS_URL;
  if (process.env.SHOUSHOU_MCP_S3_ENDPOINT) process.env.S3_ENDPOINT = process.env.SHOUSHOU_MCP_S3_ENDPOINT;
  await import("./shoushou-mcp-server");
}

main().catch((error) => {
  console.error("[shoushou-mcp] startup failed", error);
  process.exit(1);
});
