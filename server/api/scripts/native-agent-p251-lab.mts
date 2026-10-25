// Explicit local-only P2.5.1 environment; never used by the production entrypoint.
process.env.NATIVE_AGENT_LAB_ROOT = "H:/CodexStorage/shoushou-p251";
process.env.NATIVE_AGENT_LAB_DATABASE_URL =
  "postgres://p25@127.0.0.1:55485/p251_isolated";
process.env.NATIVE_AGENT_LAB_PORT = "3196";
process.env.NATIVE_AGENT_LAB_WEB_PORT = "5196";
process.env.NATIVE_AGENT_LAB_REDIS = "redis://127.0.0.1:56385/1";
process.env.NATIVE_AGENT_LAB_FIXTURE_URL = "http://127.0.0.1:3298/v1";
process.env.NATIVE_AGENT_LAB_FIXTURE_PORT = "3298";
process.env.P25_USE_PAID_MODEL ??= "false";
if (process.argv.includes("--fixture")) {
  const { startFixture } = await import("./native-agent-fixture.mjs");
  startFixture(3298);
  console.log("P251 loopback protocol substitute 3298; no provider calls");
} else if (process.argv.includes("--web"))
  await import("./native-agent-web.mjs");
else await import("./native-agent-lab.mjs");
