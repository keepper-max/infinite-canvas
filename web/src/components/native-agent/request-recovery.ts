// These start errors are returned only after checking the operation's persisted identity.
// Do not clear an unknown network result or idempotency conflict using HTTP status alone.
export const rejectedAgentStart = (code: string) => ["AGENT_RUN_ACTIVE", "AGENT_SESSION_CLOSED"].includes(code);
export const agentStartError = (code: string) =>
    code === "AGENT_RUN_ACTIVE" ? "你还有一个未结束的任务，本次请求尚未受理。输入草稿已保留，请先查看未结束任务。" : code === "AGENT_SESSION_CLOSED" ? "原会话已归档，本次请求尚未受理。输入草稿已保留，请新建会话后确认发送。" : null;
