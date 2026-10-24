import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
export type Conversion = {
  markdown: string;
  converter: string;
  warnings: string[];
  pages: unknown[];
  assets: { id: string; mimeType: string; body: string }[];
  metrics: Record<string, unknown>;
};
// This trusted runner is an OS host process. Never mount a Docker socket into the API.
// Image must be locally built and pinned by digest; document content travels over stdin.
export async function sandboxConvert(
  body: Uint8Array,
  extension: string,
  image: string,
): Promise<Conversion> {
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("转换沙箱必须配置已核验的本地镜像 SHA256");
  const name = "knowledge-convert-" + randomUUID();
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--pull=never",
        "--name",
        name,
        "-i",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--cpus=1",
        "--memory=512m",
        "--memory-swap=512m",
        "--tmpfs=/tmp:rw,noexec,nosuid,size=32m",
        image,
      ],
      {
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          USERPROFILE: process.env.USERPROFILE,
          DOCKER_HOST: process.env.DOCKER_HOST,
        },
      },
    );
    let output = "",
      diagnostic = "",
      size = 0,
      settled = false;
    const finish = (error?: Error, result?: Conversion) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result!);
    };
    const stop = (error: Error) => {
      spawn("docker", ["kill", name], { windowsHide: true, stdio: "ignore" });
      child.kill();
      finish(error);
    };
    const timer = setTimeout(
      () => stop(new Error("解析超过90秒，请减少文档大小后重试；原件已保留")),
      90_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > 100 * 1024 * 1024) stop(new Error("转换结果超出安全容量"));
      else output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      if (diagnostic.length < 2000) diagnostic += chunk.toString();
    });
    child.on("error", (e) => finish(e));
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      try {
        if (!output)
          throw new Error(
            `转换沙箱不可用（退出码${code}）：${diagnostic.trim().slice(0, 600)}`,
          );
        const result = JSON.parse(output);
        if (code !== 0 || result.error)
          throw new Error(result.error || "转换沙箱执行失败");
        if (
          typeof result.markdown !== "string" ||
          !Array.isArray(result.assets)
        )
          throw new Error("转换结果协议无效");
        finish(undefined, result);
      } catch (e) {
        finish(e as Error);
      }
    });
    child.stdin.end(
      JSON.stringify({ extension, body: Buffer.from(body).toString("base64") }),
    );
  });
}
