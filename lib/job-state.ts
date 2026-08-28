export type PersistedJobStatus = "pending" | "running" | "completed" | "failed";

const transitions: Record<PersistedJobStatus, PersistedJobStatus[]> = {
  pending: ["running", "failed"],
  running: ["completed", "failed"],
  completed: [],
  failed: ["pending"],
};

export function canTransition(from: PersistedJobStatus, to: PersistedJobStatus) { return from === to || transitions[from].includes(to); }

export function assertTransition(from: PersistedJobStatus, to: PersistedJobStatus) {
  if (!canTransition(from, to)) throw new Error(`非法任务状态转换: ${from} -> ${to}`);
}
