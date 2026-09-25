import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

export async function createVideoThumbnail(bytes: Uint8Array, ffmpegPath: string, sourceName = "video.mp4") {
    const directory = await mkdtemp(join(tmpdir(), "infinite-canvas-video-thumbnail-"));
    const input = join(directory, `input${extname(sourceName) || ".mp4"}`);
    const output = join(directory, "thumbnail.jpg");
    try {
        await writeFile(input, bytes);
        await runFfmpeg(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", "0.1", "-i", input, "-frames:v", "1", "-vf", "scale=512:-2:force_original_aspect_ratio=decrease", "-q:v", "3", "-y", output]);
        return new Uint8Array(await readFile(output));
    } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
}

function runFfmpeg(command: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, 30_000);
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr = `${stderr}${chunk}`.slice(-8_000);
        });
        child.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once("close", (code) => {
            clearTimeout(timeout);
            if (timedOut) reject(new Error("ffmpeg thumbnail extraction timed out"));
            else if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
        });
    });
}
