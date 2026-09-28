import assert from "node:assert/strict";
import test from "node:test";

import { ChannelAttributionService } from "../src/channel-attribution-service.js";
import { createDatabase } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import { DomainError } from "../src/domain.js";
import { PostgresPlatformRepository } from "../src/repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "invite attribution is atomic, permanent, permission checked, and rate limited",
  { skip: !databaseUrl },
  async () => {
    const { db, pool } = createDatabase(databaseUrl!);
    try {
      await applyMigrations(pool);
      const repository = new PostgresPlatformRepository(db);
      const suffix = crypto.randomUUID();
      const admin = await repository.createUserWithWorkspace(
        `channel-admin-${suffix}@example.com`,
        "hash",
      );
      await pool.query("update users set is_admin=true where id=$1", [
        admin.user.id,
      ]);
      const service = new ChannelAttributionService(pool, { adminEmails: [] });
      const channel = await service.createChannel(
        admin.user.id,
        {
          channelType: "school",
          channelName: `测试高校-${suffix}`,
          codePrefix: "TST",
          remark: "",
          status: "active",
        },
        "test-request",
        "127.0.0.31",
      );
      const invite = await service.createInvite(
        admin.user.id,
        {
          channelId: channel.id,
          name: "并发名额",
          description: "",
          maxUses: 1,
          status: "active",
        },
        "test-request",
        "127.0.0.31",
      );

      const registrations = await Promise.allSettled([
        repository.createUserWithWorkspace(
          `invite-a-${suffix}@example.com`,
          "hash",
          { inviteCode: invite.code, registrationIp: "127.0.0.32" },
        ),
        repository.createUserWithWorkspace(
          `invite-b-${suffix}@example.com`,
          "hash",
          { inviteCode: invite.code, registrationIp: "127.0.0.33" },
        ),
      ]);
      assert.equal(
        registrations.filter((item) => item.status === "fulfilled").length,
        1,
      );
      const rejected = registrations.find(
        (item): item is PromiseRejectedResult => item.status === "rejected",
      );
      assert.ok(rejected?.reason instanceof DomainError);
      assert.equal(rejected.reason.code, "INVITE_CODE_FULL");
      const counts = await pool.query(
        "select used_count,(select count(*) from users where invite_code_id=$1)::int users from invite_codes where id=$1",
        [invite.id],
      );
      assert.equal(counts.rows[0].used_count, 1);
      assert.equal(counts.rows[0].users, 1);

      await assert.rejects(
        () =>
          repository.createUserWithWorkspace(
            `unknown-${suffix}@example.com`,
            "hash",
            { inviteCode: "UNKNOWN-CODE" },
          ),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === "INVITE_CODE_NOT_FOUND",
      );
      const disabledInvite = await service.createInvite(
        admin.user.id,
        {
          channelId: channel.id,
          name: "停用邀请码",
          description: "",
          status: "disabled",
        },
        "test-request",
        "127.0.0.31",
      );
      await assert.rejects(
        () =>
          repository.createUserWithWorkspace(
            `disabled-${suffix}@example.com`,
            "hash",
            { inviteCode: disabledInvite.code },
          ),
        (error: unknown) =>
          error instanceof DomainError && error.code === "INVITE_CODE_DISABLED",
      );
      const expiredInvite = await service.createInvite(
        admin.user.id,
        {
          channelId: channel.id,
          name: "过期邀请码",
          description: "",
          expireAt: new Date(Date.now() - 60_000).toISOString(),
          status: "active",
        },
        "test-request",
        "127.0.0.31",
      );
      await assert.rejects(
        () =>
          repository.createUserWithWorkspace(
            `expired-${suffix}@example.com`,
            "hash",
            { inviteCode: expiredInvite.code },
          ),
        (error: unknown) =>
          error instanceof DomainError && error.code === "INVITE_CODE_EXPIRED",
      );

      const organic = await repository.createUserWithWorkspace(
        `organic-${suffix}@example.com`,
        "hash",
      );
      const source = await pool.query(
        "select c.system_key from users u join channels c on c.id=u.channel_id where u.id=$1",
        [organic.user.id],
      );
      assert.equal(source.rows[0].system_key, "organic");
      await service.setInviteMode(
        admin.user.id,
        "required",
        "test-request",
        "127.0.0.31",
      );
      await assert.rejects(
        () =>
          repository.createUserWithWorkspace(
            `required-${suffix}@example.com`,
            "hash",
          ),
        (error: unknown) =>
          error instanceof DomainError && error.code === "INVITE_CODE_REQUIRED",
      );
      await service.setInviteMode(
        admin.user.id,
        "optional",
        "test-request",
        "127.0.0.31",
      );
      await assert.rejects(
        () => service.listChannels(organic.user.id, { page: 1, pageSize: 20 }),
        (error: unknown) =>
          error instanceof DomainError && error.code === "ADMIN_FORBIDDEN",
      );
      await assert.rejects(
        () =>
          service.deleteUnused(
            admin.user.id,
            "invite",
            invite.id,
            "test-request",
            "127.0.0.31",
          ),
        (error: unknown) =>
          error instanceof DomainError && error.code === "ATTRIBUTION_IN_USE",
      );

      const riskIp = "127.0.0.34";
      for (let index = 0; index < 5; index++)
        await service.beginRegistration(riskIp, `device-${suffix}`);
      await assert.rejects(
        () => service.beginRegistration(riskIp, `device-${suffix}`),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === "REGISTRATION_RATE_LIMITED",
      );
    } finally {
      await pool.end();
    }
  },
);
