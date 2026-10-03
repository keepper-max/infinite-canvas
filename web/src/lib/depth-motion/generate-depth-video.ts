import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, Quality, canEncodeVideo } from "mediabunny";

export const DEPTH_VIDEO_RESOLUTION = 480;
export const DEPTH_VIDEO_MIN_PIXELS = 407_696;
const DEPTH_VIDEO_MAX_LONG_EDGE = 854;

export type DepthVideoProgress = {
    phase: "loading" | "analyzing" | "encoding";
    percent: number;
    backend?: string;
};

export type DepthVideoResult = {
    blob: Blob;
    width: number;
    height: number;
    durationMs: number;
    frameRate: number;
    backend: string;
};

export type DepthVideoSourceMetadata = {
    durationMs: number;
    frameRate: number;
    variableFrameRate: boolean;
};

type WorkerResult = {
    type: "ready" | "frame" | "error" | "model-progress";
    requestId: number;
    backend?: string;
    message?: string;
    depth?: ArrayBuffer;
    width?: number;
    height?: number;
    progress?: { status?: string; progress?: number };
};

type PendingRequest = {
    resolve: (message: WorkerResult) => void;
    reject: (error: Error) => void;
};

class DepthWorkerClient {
    private readonly worker = new Worker(new URL("./depth-motion.worker.ts", import.meta.url), { type: "module" });
    private readonly pending = new Map<number, PendingRequest>();
    private requestId = 0;
    private stopped = false;

    constructor(private readonly onModelProgress: (progress: number) => void) {
        this.worker.onmessage = (event: MessageEvent<WorkerResult>) => {
            const message = event.data;
            if (message.type === "model-progress") {
                const progress = typeof message.progress?.progress === "number" ? message.progress.progress : 0;
                this.onModelProgress(Math.min(100, Math.max(0, progress)));
                return;
            }
            const request = this.pending.get(message.requestId);
            if (!request) return;
            this.pending.delete(message.requestId);
            if (message.type === "error") request.reject(new Error(message.message || "深度处理失败"));
            else request.resolve(message);
        };
        this.worker.onerror = (event) => this.stop(new Error(event.message || "深度处理线程异常"));
    }

    async init(signal?: AbortSignal) {
        const result = await this.request({ type: "init" }, [], signal);
        return result.backend || "unknown";
    }

    async process(pixels: Uint8ClampedArray, width: number, height: number, signal?: AbortSignal) {
        const buffer = pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength);
        const result = await this.request({ type: "process", pixels: buffer, width, height, smoothing: 0.65 }, [buffer], signal);
        if (!result.depth || !result.width || !result.height) throw new Error("深度模型没有返回有效画面");
        return { depth: new Uint8Array(result.depth), width: result.width, height: result.height, backend: result.backend };
    }

    dispose() {
        this.stop(new DOMException("Aborted", "AbortError"));
    }

    private request(payload: Record<string, unknown>, transfer: Transferable[], signal?: AbortSignal) {
        if (this.stopped) return Promise.reject(new DOMException("Aborted", "AbortError"));
        const requestId = ++this.requestId;
        return new Promise<WorkerResult>((resolve, reject) => {
            const abort = () => {
                this.pending.delete(requestId);
                reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal?.aborted) return abort();
            signal?.addEventListener("abort", abort, { once: true });
            this.pending.set(requestId, {
                resolve: (message) => {
                    signal?.removeEventListener("abort", abort);
                    resolve(message);
                },
                reject: (error) => {
                    signal?.removeEventListener("abort", abort);
                    reject(error);
                },
            });
            this.worker.postMessage({ ...payload, requestId }, transfer);
        });
    }

    private stop(error: Error) {
        if (this.stopped) return;
        this.stopped = true;
        this.worker.terminate();
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
    }
}

export async function inspectDepthVideoSource(file: Blob): Promise<DepthVideoSourceMetadata> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error("未检测到可用的视频轨道");
        const [durationFromMetadata, stats] = await Promise.all([input.getDurationFromMetadata([track]), track.computeFrameRateMetrics({ targetPacketCount: 256 })]);
        const duration = durationFromMetadata ?? (await input.computeDuration([track]));
        const frameRate = Number(stats.bestGuessFrameRate.toFixed(3));
        if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长，请更换 MP4、MOV 或 WebM 文件");
        if (!Number.isFinite(frameRate) || frameRate <= 0) throw new Error("无法读取视频帧率，请更换视频文件");
        return { durationMs: Math.round(duration * 1000), frameRate, variableFrameRate: stats.underlyingFrameRate === null };
    } finally {
        input.dispose();
    }
}

export async function generateDepthVideo(file: File, options: { signal?: AbortSignal; onProgress?: (progress: DepthVideoProgress) => void; sourceMetadata?: DepthVideoSourceMetadata } = {}): Promise<DepthVideoResult> {
    const { signal, onProgress = () => undefined } = options;
    throwIfAborted(signal);
    const sourceMetadata = options.sourceMetadata || (await inspectDepthVideoSource(file));
    const frameRate = sourceMetadata.frameRate;
    const sourceUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = sourceUrl;
    const client = new DepthWorkerClient((percent) => onProgress({ phase: "loading", percent: Math.min(18, Math.round(percent * 0.18)) }));
    let mediaOutput: Output<Mp4OutputFormat, BufferTarget> | null = null;

    try {
        await waitForVideoMetadata(video, signal);
        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("无法读取视频时长，请更换 MP4、MOV 或 WebM 文件");

        const { width, height } = fitVideoSize(video.videoWidth, video.videoHeight, DEPTH_VIDEO_RESOLUTION, DEPTH_VIDEO_MAX_LONG_EDGE, DEPTH_VIDEO_MIN_PIXELS);
        const quality = new Quality({ bitrate: 6_000_000, bitrateMode: "variable" });
        if (!(await canEncodeVideo("avc", { width, height, frameRate, quality }))) throw new Error(`当前浏览器无法按源视频的 ${formatFrameRate(frameRate)}fps 编码 MP4，请使用最新版 Chrome 或 Edge`);

        onProgress({ phase: "loading", percent: 1 });
        const backend = await client.init(signal);
        onProgress({ phase: "analyzing", percent: 20, backend });

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("浏览器无法创建视频处理画布");
        const depthCanvas = document.createElement("canvas");
        const depthContext = depthCanvas.getContext("2d");
        if (!depthContext) throw new Error("浏览器无法绘制深度画面");

        const target = new BufferTarget();
        mediaOutput = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
        const canvasSource = new CanvasSource(canvas, { codec: "avc", quality, keyFrameInterval: 2 });
        mediaOutput.addVideoTrack(canvasSource, { frameRate });
        await mediaOutput.start();

        const frameCount = Math.max(1, Math.ceil(video.duration * frameRate));
        const frameDuration = 1 / frameRate;
        const keyFrameInterval = Math.max(1, Math.round(frameRate * 2));
        for (let index = 0; index < frameCount; index += 1) {
            throwIfAborted(signal);
            await seekVideo(video, Math.min(video.duration - 0.001, index / frameRate), signal);
            context.drawImage(video, 0, 0, width, height);
            const image = context.getImageData(0, 0, width, height);
            const depth = await client.process(image.data, width, height, signal);
            drawDepth(context, depthContext, depthCanvas, depth.depth, depth.width, depth.height, width, height);

            await canvasSource.add(index * frameDuration, frameDuration, { keyFrame: index % keyFrameInterval === 0 });
            onProgress({ phase: "analyzing", percent: 20 + Math.round(((index + 1) / frameCount) * 72), backend });
        }

        onProgress({ phase: "encoding", percent: 94, backend });
        await mediaOutput.finalize();
        if (!target.buffer || target.buffer.byteLength < 32) throw new Error("MP4 编码结果为空，请重试");
        onProgress({ phase: "encoding", percent: 100, backend });
        return { blob: new Blob([target.buffer], { type: "video/mp4" }), width, height, durationMs: Math.round(video.duration * 1000), frameRate, backend };
    } finally {
        if (mediaOutput && mediaOutput.state !== "finalized" && mediaOutput.state !== "canceled") await mediaOutput.cancel().catch(() => undefined);
        client.dispose();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(sourceUrl);
    }
}

export function formatFrameRate(frameRate: number) {
    return Number.isInteger(frameRate) ? String(frameRate) : frameRate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function fitVideoSize(sourceWidth: number, sourceHeight: number, shortEdge: number, maxLongEdge: number, minPixels: number) {
    const scale = Math.min(1, shortEdge / Math.min(sourceWidth, sourceHeight), maxLongEdge / Math.max(sourceWidth, sourceHeight));
    let width = even(Math.max(2, Math.round(sourceWidth * scale)));
    let height = even(Math.max(2, Math.round(sourceHeight * scale)));
    if (width * height < minPixels) {
        const minimumScale = Math.sqrt(minPixels / (width * height));
        width = evenCeil(width * minimumScale);
        height = evenCeil(height * minimumScale);
    }
    return { width, height };
}

function even(value: number) {
    return value % 2 === 0 ? value : value - 1;
}

function evenCeil(value: number) {
    const rounded = Math.ceil(value);
    return rounded % 2 === 0 ? rounded : rounded + 1;
}

function drawDepth(context: CanvasRenderingContext2D, sourceContext: CanvasRenderingContext2D, source: HTMLCanvasElement, depth: Uint8Array, depthWidth: number, depthHeight: number, outputWidth: number, outputHeight: number) {
    if (source.width !== depthWidth || source.height !== depthHeight) {
        source.width = depthWidth;
        source.height = depthHeight;
    }
    const image = sourceContext.createImageData(depthWidth, depthHeight);
    for (let index = 0; index < depth.length; index += 1) {
        const offset = index * 4;
        const value = depth[index];
        image.data[offset] = value;
        image.data[offset + 1] = value;
        image.data[offset + 2] = value;
        image.data[offset + 3] = 255;
    }
    sourceContext.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, outputWidth, outputHeight);
}

function waitForVideoMetadata(video: HTMLVideoElement, signal?: AbortSignal) {
    return eventPromise(video, "loadedmetadata", "无法读取视频，请确认文件未损坏", signal);
}

function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
    const pending = eventPromise(video, "seeked", "读取视频帧超时", signal, 8000);
    video.currentTime = time;
    return pending;
}

function eventPromise(target: HTMLMediaElement, eventName: string, errorMessage: string, signal?: AbortSignal, timeoutMs = 12000) {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            window.clearTimeout(timer);
            target.removeEventListener(eventName, done);
            target.removeEventListener("error", failed);
            signal?.removeEventListener("abort", aborted);
        };
        const done = () => {
            cleanup();
            resolve();
        };
        const failed = () => {
            cleanup();
            reject(new Error(errorMessage));
        };
        const aborted = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = window.setTimeout(failed, timeoutMs);
        target.addEventListener(eventName, done, { once: true });
        target.addEventListener("error", failed, { once: true });
        signal?.addEventListener("abort", aborted, { once: true });
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
