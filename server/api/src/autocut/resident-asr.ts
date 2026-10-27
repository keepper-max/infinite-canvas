import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { transcriptSchema, type Analysis } from "./contract.js";
import type { AsrProvider } from "./media.js";

type Transcript = Analysis["transcript"];
type Daemon = {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  exited: Promise<void>;
  pending?: {
    id: string;
    resolve: (t: Transcript) => void;
    reject: (e: Error) => void;
  };
  stopping?: Promise<void>;
};

/** One CPU model process, serialized requests. No inference is retried automatically. */
export class ResidentFunAsrProvider implements AsrProvider {
  private daemon?: Daemon;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private loads = 0;
  private loadMs?: number;
  private recognitionMs?: number;
  constructor(
    private python: string,
    private script: string,
    private model: string,
    private vad: string,
    private punctuation: string,
  ) {}

  get diagnostics() {
    return {
      pid: this.daemon?.child.pid,
      busy: Boolean(this.daemon?.pending),
      loads: this.loads,
      loadMs: this.loadMs,
      recognitionMs: this.recognitionMs,
    };
  }
  async transcribe(path: string, signal: AbortSignal): Promise<Transcript> {
    signal.throwIfAborted();
    if (this.closed) throw new Error("AUTOCUT_ASR_CLOSED");
    const operation = this.tail.then(() => this.run(path, signal));
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([operation, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  private async run(path: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.closed) throw new Error("AUTOCUT_ASR_CLOSED");
    await Promise.all(
      [this.model, this.vad, this.punctuation].map((p) => access(p)),
    );
    signal.throwIfAborted();
    if (this.closed) throw new Error("AUTOCUT_ASR_CLOSED");
    const daemon = this.daemon ?? this.start();
    const cancel = () => {
      void this.stop(daemon);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await daemon.ready;
      signal.throwIfAborted();
      return await new Promise<Transcript>((resolve, reject) => {
        const id = randomUUID();
        daemon.pending = { id, resolve, reject };
        daemon.child.stdin.write(
          JSON.stringify({ id, path }) + "\n",
          (error) => {
            if (error) {
              reject(error);
              void this.stop(daemon);
            }
          },
        );
      });
    } finally {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted || daemon.stopping) await this.stop(daemon);
    }
  }
  private start() {
    let ready!: () => void, failReady!: (e: Error) => void, exited!: () => void;
    const child = spawn(
      this.python,
      [
        this.script,
        "--daemon",
        "--model",
        this.model,
        "--vad",
        this.vad,
        "--punctuation",
        this.punctuation,
      ],
      { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const daemon: Daemon = {
      child,
      ready: new Promise((r, j) => {
        ready = r;
        failReady = j;
      }),
      exited: new Promise((r) => {
        exited = r;
      }),
    };
    this.daemon = daemon;
    this.loads++;
    const lines = createInterface({ input: child.stdout });
    child.stderr.on("data", () => {}); // Always drain FunASR progress; do not retain audio paths or unbounded logs.
    lines.on("line", (line) => {
      try {
        if (line.startsWith("AUTOCUT_ASR_READY=")) {
          this.loadMs = JSON.parse(
            line.slice("AUTOCUT_ASR_READY=".length),
          ).loadMs;
          ready();
        } else if (line.startsWith("AUTOCUT_TRANSCRIPT=")) {
          const result = JSON.parse(line.slice("AUTOCUT_TRANSCRIPT=".length));
          if (!daemon.pending || result.id !== daemon.pending.id)
            throw new Error("AUTOCUT_ASR_PROTOCOL_INVALID");
          const transcript = transcriptSchema.parse(result.transcript);
          this.recognitionMs = result.recognitionMs;
          const pending = daemon.pending;
          daemon.pending = undefined;
          pending.resolve(transcript);
        } else if (line.startsWith("AUTOCUT_ASR_ERROR=")) {
          throw new Error("AUTOCUT_ASR_RECOGNITION_FAILED");
        }
      } catch (e) {
        const error =
          e instanceof Error ? e : new Error("AUTOCUT_ASR_PROTOCOL_INVALID");
        failReady(error);
        daemon.pending?.reject(error);
        void this.stop(daemon);
      }
    });
    child.once("error", (error) => {
      failReady(error);
      daemon.pending?.reject(error);
    });
    child.once("close", () => {
      const error = new Error("AUTOCUT_ASR_PROCESS_EXITED");
      failReady(error);
      daemon.pending?.reject(error);
      daemon.pending = undefined;
      lines.close();
      if (this.daemon === daemon) this.daemon = undefined;
      exited();
    });
    return daemon;
  }
  private stop(daemon: Daemon): Promise<void> {
    if (!daemon.stopping)
      daemon.stopping = (async () => {
        if (
          daemon.child.exitCode === null &&
          daemon.child.signalCode === null
        ) {
          if (process.platform === "win32" && daemon.child.pid) {
            // venv Python may have a launcher child; terminate the whole owned tree.
            const killer = spawn(
              "taskkill",
              ["/PID", String(daemon.child.pid), "/T", "/F"],
              { shell: false, windowsHide: true, stdio: "ignore" },
            );
            killer.once("error", () => daemon.child.kill("SIGKILL"));
          } else daemon.child.kill("SIGKILL");
        }
        await daemon.exited;
      })();
    return daemon.stopping;
  }
  async close() {
    this.closed = true;
    if (this.daemon) await this.stop(this.daemon);
    await this.tail;
  }
}
