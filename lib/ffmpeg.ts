import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function concatVideos(inputs: Array<{ bytes: Uint8Array; extension: string }>) {
  const workDir = path.join(os.tmpdir(), `jingjie-render-${crypto.randomUUID()}`); await mkdir(workDir, { recursive: true });
  try {
    const files: string[] = [];
    for (let i = 0; i < inputs.length; i += 1) { const file = path.join(workDir, `input-${i}.${inputs[i].extension}`); await writeFile(file, inputs[i].bytes); files.push(file); }
    const list = path.join(workDir, "concat.txt"); await writeFile(list, files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
    const output = path.join(workDir, "output.mp4");
    await new Promise<void>((resolve, reject) => { const child = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_BIN ?? "ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", output]); let error = ""; child.stderr.on("data", (chunk) => { error += String(chunk); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(error.slice(-1000) || `ffmpeg exited with ${code}`))); });
    const result = await import("node:fs/promises").then(({ readFile: read }) => read(output));
    return new Uint8Array(result);
  } finally { await rm(workDir, { recursive: true, force: true }).catch(() => undefined); }
}
