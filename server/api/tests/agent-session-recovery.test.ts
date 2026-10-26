import test from "node:test";
import assert from "node:assert/strict";
import {
  rejectedAgentStart,
  agentStartError,
} from "../../../web/src/components/native-agent/request-recovery.js";
test("only explicit pre-admission rejections release the pending UI lock", () => {
  for (const code of ["AGENT_RUN_ACTIVE", "AGENT_SESSION_CLOSED"])
    assert.equal(rejectedAgentStart(code), true);
  for (const code of [
    "NETWORK_ERROR",
    "AGENT_OPERATION_MISMATCH",
    "AGENT_EXECUTION_UNCONFIRMED",
    "AGENT_RECEIPT_NOT_READY",
    "CONFLICT",
    "UNAUTHENTICATED",
  ])
    assert.equal(rejectedAgentStart(code), false);
  assert.match(
    agentStartError("AGENT_RUN_ACTIVE")!,
    /本次请求尚未受理.*草稿已保留/,
  );
  assert.match(agentStartError("AGENT_SESSION_CLOSED")!, /原会话已归档/);
  assert.equal(agentStartError("OTHER_409"), null);
});
