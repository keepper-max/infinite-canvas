import test from "node:test";
import assert from "node:assert/strict";
import { integrationStatus, integrationStatuses } from "@/lib/external-services";

test("外部服务接口默认安全为未配置", () => {
  const statuses = integrationStatuses();
  assert.deepEqual(statuses.map((item) => item.name), ["credits", "payment", "sms"]);
  assert.equal(integrationStatus("payment").configured, false);
});
