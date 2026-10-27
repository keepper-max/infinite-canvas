// Protocol/lifecycle fixture only; these transcripts are NOT real ASR quality evidence.
import { createInterface } from "node:readline";
console.log(
  "AUTOCUT_ASR_READY=" + JSON.stringify({ pid: process.pid, loadMs: 1 }),
);
for await (const line of createInterface({ input: process.stdin })) {
  const { id, path } = JSON.parse(line);
  if (path === "crash") process.exit(7);
  await new Promise((r) => setTimeout(r, path === "slow" ? 300 : 10));
  console.log(
    "AUTOCUT_TRANSCRIPT=" +
      JSON.stringify({
        id,
        transcript: {
          segments: [
            { start: 0, end: 1000, text: "protocol fixture", confidence: null },
          ],
        },
        recognitionMs: 1,
      }),
  );
}
