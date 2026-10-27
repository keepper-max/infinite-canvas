import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { runMedia, type AsrProvider } from "./media.js";
import { transcriptSchema } from "./contract.js";
import { ResidentFunAsrProvider } from "./resident-asr.js";

/** An explicitly provisioned CPU ASR runtime. No package/model downloads in a user task. */
export class LocalFunAsrProvider implements AsrProvider {
  constructor(
    private python: string,
    private script: string,
    private model: string,
    private vad: string,
    private punctuation: string,
  ) {}
  async transcribe(path: string, signal: AbortSignal) {
    await Promise.all(
      [this.model, this.vad, this.punctuation].map((p) => access(p)),
    );
    const output = await runMedia(
      this.python,
      [
        this.script,
        "--input",
        path,
        "--model",
        this.model,
        "--vad",
        this.vad,
        "--punctuation",
        this.punctuation,
      ],
      signal,
    );
    const line = output
      .split(/\r?\n/)
      .reverse()
      .find((l) => l.startsWith("AUTOCUT_TRANSCRIPT="));
    if (!line) throw new Error("AUTOCUT_ASR_INVALID_RESPONSE");
    return transcriptSchema.parse(
      JSON.parse(line.slice("AUTOCUT_TRANSCRIPT=".length)),
    );
  }
  async close() {}
}
export function configuredAsr() {
  const {
    AUTOCUT_ASR_PYTHON: python,
    AUTOCUT_ASR_MODEL: model,
    AUTOCUT_ASR_VAD: vad,
    AUTOCUT_ASR_PUNCTUATION: punctuation,
  } = process.env;
  const mode = process.env.AUTOCUT_ASR_MODE || "oneshot";
  if (!["oneshot", "resident"].includes(mode))
    throw new Error("AUTOCUT_ASR_MODE must be oneshot or resident");
  const Provider =
    mode === "resident" ? ResidentFunAsrProvider : LocalFunAsrProvider;
  return python && model && vad && punctuation
    ? new Provider(
        python,
        resolve("scripts/autocut-asr.py"),
        model,
        vad,
        punctuation,
      )
    : undefined;
}
