import type { Pool, PoolClient } from "pg";

import { DomainError } from "./domain.js";

export type StorageUsage = {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number | null;
  remainingBytes: number | null;
  unlimited: boolean;
};

export class StorageQuotaService {
  constructor(
    private readonly pool: Pool,
    private readonly quotaBytes: number,
    private readonly adminEmails: string[] = [],
  ) {}

  async getUsage(userId: string): Promise<StorageUsage> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const usage = await this.readUsage(client, userId, false);
      await client.query("commit");
      return usage;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async assertHasCapacity(userId: string) {
    const usage = await this.getUsage(userId);
    if (!usage.unlimited && (usage.remainingBytes || 0) <= 0)
      throw storageQuotaExceeded(usage);
  }

  async reserve(userId: string, bytes: number, reservationKey: string) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new DomainError("INVALID_STORAGE_SIZE", "文件大小无效", 422);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`storage-quota:${userId}`],
      );
      const existing = await client.query(
        "select 1 from user_storage_reservations where reservation_key=$1 and expires_at > now()",
        [reservationKey],
      );
      if (existing.rowCount) {
        await client.query("commit");
        return;
      }
      const usage = await this.readUsage(client, userId, true);
      if (!usage.unlimited && bytes > (usage.remainingBytes || 0))
        throw storageQuotaExceeded(usage, bytes);
      if (!usage.unlimited)
        await client.query(
          `insert into user_storage_reservations(user_id,reservation_key,bytes,expires_at)
           values($1,$2,$3,now() + interval '24 hours')
           on conflict(reservation_key) do nothing`,
          [userId, reservationKey, bytes],
        );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async release(reservationKey: string) {
    await this.pool.query(
      "delete from user_storage_reservations where reservation_key=$1",
      [reservationKey],
    );
  }

  private async readUsage(
    client: PoolClient,
    userId: string,
    cleanExpired: boolean,
  ): Promise<StorageUsage> {
    if (cleanExpired)
      await client.query(
        "delete from user_storage_reservations where expires_at <= now()",
      );
    const result = await client.query<{
      email: string;
      is_admin: boolean;
      used_bytes: string;
      reserved_bytes: string;
    }>(
      `select u.email,u.is_admin,
         coalesce((select sum(v.bytes + coalesce(v.thumbnail_bytes,0)) from asset_versions v where v.created_by=u.id),0)::text used_bytes,
         coalesce((select sum(r.bytes) from user_storage_reservations r where r.user_id=u.id and r.expires_at > now()),0)::text reserved_bytes
       from users u where u.id=$1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("USER_NOT_FOUND", "找不到用户", 404);
    const unlimited =
      row.is_admin || this.adminEmails.includes(row.email.toLowerCase());
    const usedBytes = Number(row.used_bytes);
    const reservedBytes = Number(row.reserved_bytes);
    return {
      usedBytes,
      reservedBytes,
      quotaBytes: unlimited ? null : this.quotaBytes,
      remainingBytes: unlimited
        ? null
        : Math.max(0, this.quotaBytes - usedBytes - reservedBytes),
      unlimited,
    };
  }
}

function storageQuotaExceeded(usage: StorageUsage, requestedBytes = 0) {
  return new DomainError(
    "STORAGE_QUOTA_EXCEEDED",
    "云端存储空间不足，请先删除不需要的素材并清空回收站",
    409,
    false,
    {
      details: {
        usedBytes: usage.usedBytes,
        reservedBytes: usage.reservedBytes,
        quotaBytes: usage.quotaBytes,
        requestedBytes,
      },
    },
  );
}
