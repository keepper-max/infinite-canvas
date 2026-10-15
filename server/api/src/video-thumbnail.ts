import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

export interface VideoMetadata {
    width: number | null;
    height: number | null;
    durationMs: number | null;
}

export function parseVideoMetadata(value: unknown): VideoMetadata {
    const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const stream = Array.isArray(data.streams)
        ? data.streams.find((item) => item && item.codec_type === "video") : undefined;
    const format = data.format && typeof data.format === "object" ? data.format as Record<string, unknown> : {};
    const positive = (value: unknown, scale = 1) => {
        if (typeof value !== "string" && typeof value !== "number") return null;
        const number = Math.round(Number(value) * scale);
        return Number.isFinite(number) && number > 0 && number <= 2_147_483_647 ? number : null;
    };
    return {
        width: positive(stream?.width),
        height: positive(stream?.height),
        durationMs: positive(format.duration, 1000) ?? positive(stream?.duration, 1000),
    };
}

export async function readVideoMetadata(bytes: Uint8Array, ffmpegPath: string, sourceName = "video.mp4") {
    const directory = await mkdtemp(join(tmpdir(), "infinite-canvas-video-metadata-"));
    const input = join(directory, `input${extname(sourceName) || ".mp4"}`);
    const name = basename(ffmpegPath);
    const probeName = /\.exe$/i.test(name) ? "ffprobe.exe" : "ffprobe";
    const probePath = dirname(ffmpegPath) === "." ? probeName : join(dirname(ffmpegPath), probeName);
    try {
        await writeFile(input, bytes);
        const output = await runFfmpeg(probePath, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", input]);
        return parseVideoMetadata(JSON.parse(output));
    } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
}

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
    return new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-8_000); });
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
            if (timedOut) reject(new Error("video inspection timed out"));
            else if (code === 0) resolve(stdout);
            else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
        });
    });
}
