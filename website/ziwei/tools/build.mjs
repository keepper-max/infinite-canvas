import { build } from "esbuild";
import { mkdir, copyFile, cp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}/dist`, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/app.ts"],
  outfile: "dist/app.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "external",
});
for (const name of ["index.html", "styles.css", "credits.html", "api-contract.json"])
  await copyFile(`${root}/${name}`, `${root}/dist/${name}`);
await cp(`${root}/licenses`, `${root}/dist/licenses`, { recursive: true });
await writeFile(
  `${root}/public-files.json`,
  JSON.stringify(
    [
      "index.html",
      "styles.css",
      "credits.html",
      "api-contract.json",
      "app.js",
      "app.js.LEGAL.txt",
      "licenses/ziwei-doushu.txt",
      "licenses/iztro.txt",
      "licenses/lunar-javascript.txt",
      "licenses/lunar-lite.txt",
      "licenses/localforage.txt",
    ],
    null,
    2,
  ) + "\n",
);
console.log(
  "Built standalone website page in website/ziwei/dist (no canvas dependency).",
);
