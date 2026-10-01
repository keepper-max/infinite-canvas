import { RawImage, env, pipeline, type ProgressInfo } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/depth-anything-v2-small";
const MODEL_REVISION = "4472b7362082ad9968fee890ca0f1e5aca36b93d";

type InitMessage = { type: "init"; requestId: number };
type ProcessMessage = { type: "process"; requestId: number; pixels: ArrayBuffer; width: number; height: number; smoothing: number };
type WorkerRequest = InitMessage | ProcessMessage;

type DepthPipeline = (input: RawImage) => Promise<{ depth: { data: Uint8Array | Uint8ClampedArray; width: number; height: number } } | Array<{ depth: { data: Uint8Array | Uint8ClampedArray; width: number; height: number } }>>;

let depthPipeline: DepthPipeline | null = null;
let previousDepth: Uint8Array | null = null;
let previousWidth = 0;
let previousHeight = 0;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    void handleRequest(event.data);
};

async function handleRequest(message: WorkerRequest) {
    try {
        if (message.type === "init") {
            const backend = await ensurePipeline(message.requestId);
            self.postMessage({ type: "ready", requestId: message.requestId, backend });
            return;
        }

        const model = await ensurePipeline(message.requestId);
        const input = new RawImage(new Uint8ClampedArray(message.pixels), message.width, message.height, 4);
        const output = await depthPipeline!(input);
        const result = Array.isArray(output) ? output[0] : output;
        const rawDepth = result.depth;
        const depth = new Uint8Array(rawDepth.data);
        const alpha = Math.min(1, Math.max(0, message.smoothing));

        if (alpha < 1 && previousDepth && previousWidth === rawDepth.width && previousHeight === rawDepth.height) {
            for (let index = 0; index < depth.length; index += 1) {
                depth[index] = Math.round(depth[index] * alpha + previousDepth[index] * (1 - alpha));
            }
        }

        previousDepth = depth.slice();
        previousWidth = rawDepth.width;
        previousHeight = rawDepth.height;
        workerPostMessage({ type: "frame", requestId: message.requestId, backend: model, depth: depth.buffer, width: rawDepth.width, height: rawDepth.height }, [depth.buffer]);
    } catch (error) {
        self.postMessage({ type: "error", requestId: message.requestId, message: error instanceof Error ? error.message : String(error) });
    }
}

async function ensurePipeline(requestId: number) {
    if (depthPipeline) return "cached";

    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const configuredHost = import.meta.env.VITE_DEPTH_MODEL_HOST?.trim();
    const hosts = configuredHost ? [configuredHost] : ["https://hf-mirror.com", "https://huggingface.co"];
    const attempts: Array<{ device: "webgpu" | "wasm"; dtype: "fp16" | "fp32" }> = [];
    if ("gpu" in navigator) attempts.push({ device: "webgpu", dtype: "fp16" }, { device: "webgpu", dtype: "fp32" });
    attempts.push({ device: "wasm", dtype: "fp32" });
    let lastError: unknown;

    for (const host of hosts) {
        env.remoteHost = host;
        for (const attempt of attempts) {
            try {
                const createDepthPipeline = pipeline as unknown as (
                    task: "depth-estimation",
                    model: string,
                    options: { revision: string; device: "webgpu" | "wasm"; dtype: "fp16" | "fp32"; progress_callback: (progress: ProgressInfo) => void },
                ) => Promise<DepthPipeline>;
                depthPipeline = await createDepthPipeline("depth-estimation", MODEL_ID, {
                    revision: MODEL_REVISION,
                    device: attempt.device,
                    dtype: attempt.dtype,
                    progress_callback: (progress: ProgressInfo) => self.postMessage({ type: "model-progress", requestId, progress }),
                });
                return `${attempt.device}/${attempt.dtype}`;
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error("深度模型加载失败");
}

function workerPostMessage(message: unknown, transfer: Transferable[]) {
    (self as unknown as { postMessage: (message: unknown, transfer: Transferable[]) => void }).postMessage(message, transfer);
}
