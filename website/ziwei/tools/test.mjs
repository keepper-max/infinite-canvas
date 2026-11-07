import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
const output = "H:/CodexStorage/ziwei-website-verification";
await mkdir(`${output}/tmp`, { recursive: true });
process.env.TMP = process.env.TEMP = `${output}/tmp`;
await build({
  absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
  entryPoints: ["tools/unit.ts"],
  outfile: `${output}/unit.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
execFileSync(process.execPath, ["--test", `${output}/unit.cjs`], {
  stdio: "inherit",
  env: {...process.env,NODE_PATH:[fileURLToPath(new URL('../../../server/api/node_modules',import.meta.url)),fileURLToPath(new URL('../node_modules',import.meta.url))].join(path.delimiter)},
});
