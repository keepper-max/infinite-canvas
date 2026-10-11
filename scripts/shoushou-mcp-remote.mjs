import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sshConfig = "H:\\CodexStorage\\ssh\\shoumiren-deploy-config";
const sshTarget = "shoumiren-production";
const remoteBundle = "/home/adminsun/.local/share/shoushou-mcp/shoushou-mcp-server.cjs";
const accountFile = join(scriptDir, "..", ".env.mcp");
const ssh = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "OpenSSH",
  "ssh.exe",
);

const accountLine = readFileSync(accountFile, "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("SHOUSHOU_MCP_ACCOUNT="));
const account = accountLine?.split("=", 2)[1]?.trim() ?? "";
if (!/^[A-Za-z0-9@._+-]+$/.test(account)) {
  throw new Error("Missing or unsafe SHOUSHOU_MCP_ACCOUNT");
}

const containerFile = `/tmp/shoushou-mcp-${randomUUID().replaceAll("-", "")}.cjs`;
const remoteCommand = `set -eu
host_file='${remoteBundle}'
container_file='${containerFile}'
container="$(docker ps --filter 'label=com.docker.compose.project=jingjie-studio' --filter 'label=com.docker.compose.service=api' --format '{{.ID}}' | head -n 1)"
if [ -z "$container" ]; then exit 41; fi
if [ ! -f "$host_file" ]; then exit 42; fi
cleanup() { docker exec "$container" rm -f "$container_file" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM
docker cp "$host_file" "$container:$container_file" >/dev/null 2>&1
docker exec -i -e "SHOUSHOU_MCP_ACCOUNT=${account}" "$container" node "$container_file"`;

const child = spawn(
  ssh,
  ["-F", sshConfig, "-o", "BatchMode=yes", sshTarget, remoteCommand],
  { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
);
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("error", (error) => {
  console.error(`[shoushou-mcp] SSH startup failed: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
