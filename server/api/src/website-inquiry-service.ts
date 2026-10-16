import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { DomainError } from "./domain.js";

// Dedicated quota: never consumes login or verification-code attempts.
const reserveScript = `
local clock=redis.call('TIME'); local now=clock[1]*1000+math.floor(clock[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-300000)
if redis.call('ZCARD',KEYS[1])>=5 then
 local first=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES')
 return math.max(1,math.ceil((tonumber(first[2])+300000-now)/1000))
end
redis.call('ZADD',KEYS[1],now,ARGV[1]); redis.call('EXPIRE',KEYS[1],300)
return 0`;

export class WebsiteInquiryService {
  constructor(private readonly pool: Pool, private readonly redis: Redis) {}

  async submit(input: { id: string; content: string; contact: string }, ip: string) {
    let wait: number;
    try {
      wait = Number(await this.redis.eval(reserveScript, 1,
        `website-inquiry:${createHash("sha256").update(ip).digest("hex")}`, randomUUID()));
    } catch {
      throw new DomainError("INQUIRY_UNAVAILABLE", "咨询服务暂时不可用，请直接邮件联系", 503, true);
    }
    if (!Number.isFinite(wait) || wait < 0)
      throw new DomainError("INQUIRY_UNAVAILABLE", "咨询服务暂时不可用，请直接邮件联系", 503, true);
    if (wait > 0)
      throw new DomainError("INQUIRY_RATE_LIMITED", `提交过于频繁，请在 ${Math.ceil(wait / 60)} 分钟后重试`, 429, true, { details: { retryAfterSeconds: wait } });
    // A retried request must not replace an existing inquiry or disclose its contents.
    const result = await this.pool.query(
      `insert into website_inquiries(id,content,contact) values($1,$2,$3)
       on conflict(id) do nothing returning id`, [input.id, input.content, input.contact]);
    if (!result.rowCount) {
      const same = await this.pool.query(
        `select id from website_inquiries where id=$1 and content=$2 and contact=$3`,
        [input.id, input.content, input.contact]);
      if (!same.rowCount) throw new DomainError("INQUIRY_CONFLICT", "提交标识冲突，请重新填写提交", 409);
    }
    return { id: input.id };
  }

  async list(page: number, pageSize: number) {
    const count = await this.pool.query("select count(*)::int total from website_inquiries");
    const rows = await this.pool.query(
      `select id,content,contact,status,note,created_at as "createdAt",updated_at as "updatedAt"
       from website_inquiries order by created_at desc,id desc limit $1 offset $2`,
      [pageSize, (page - 1) * pageSize]);
    return { items: rows.rows, total: count.rows[0].total, page, pageSize };
  }

  async update(id: string, input: { status: "open" | "closed"; note: string }, actor: string, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query(
        "update website_inquiries set status=$2,note=$3,updated_at=now() where id=$1 returning id",
        [id, input.status, input.note]);
      if (!result.rowCount) throw new DomainError("INQUIRY_NOT_FOUND", "咨询记录不存在", 404);
      await client.query(
        `insert into admin_audit_logs(actor_user_id,action,target_type,target_id,request_id,metadata)
         values($1,'website_inquiry.update','website_inquiry',$2,$3,$4)`,
        [actor, id, requestId, { status: input.status }]);
      await client.query("commit");
      return { id };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }
}
