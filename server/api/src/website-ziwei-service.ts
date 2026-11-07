import { createHash, createHmac } from "node:crypto";
import type { Redis } from "ioredis";
import { DomainError } from "./domain.js";

export const ZIWEI_WINDOW_MS = 24 * 60 * 60 * 1000;
export const ZIWEI_IP_CALLS = 2;
// Redis clock, reservation and idempotency are one transaction. Submitted failures
// remain counted because the provider may already have generated a paid response.
export const ZIWEI_RESERVE_SCRIPT = `
local clock=redis.call('TIME'); local now=clock[1]*1000+math.floor(clock[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-tonumber(ARGV[3]))
local old=redis.call('GET',KEYS[2]); if old then return {'existing',old} end
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[4]) then
 local first=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES')
 return {'limited',tostring(math.max(1,math.ceil((tonumber(first[2])+tonumber(ARGV[3])-now)/1000)))}
end
redis.call('ZADD',KEYS[1],now,ARGV[1]); redis.call('PEXPIRE',KEYS[1],ARGV[3])
redis.call('SET',KEYS[2],ARGV[2],'PX',ARGV[3])
return {'reserved',tostring(tonumber(ARGV[4])-redis.call('ZCARD',KEYS[1]))}`;

export type WebsiteZiweiRequest = { schemaVersion: 1; requestId: string; chartFingerprint: string; knowledgeVersion: string; chart: Record<string, unknown> };
export type WebsiteZiweiResult = { schemaVersion: 1; requestId: string; chartFingerprint: string; text: string; remainingCalls: number; model: string };
type Stored = { fingerprint: string; status: "pending" | "completed" | "failed"; result?: WebsiteZiweiResult };

export class WebsiteZiweiService {
  constructor(private readonly redis: Redis, private readonly hashSecret: string,
    private readonly model: string,
    private readonly generate: (request: WebsiteZiweiRequest) => Promise<string>) {}

  async interpret(request: WebsiteZiweiRequest, ip: string) {
    if (ip === "unknown") throw new DomainError("ZIWEI_IP_UNAVAILABLE", "无法核验访问地址，请稍后重试", 503);
    const hash = createHash("sha256").update(JSON.stringify(request.chart)).digest("hex");
    if (hash !== request.chartFingerprint) throw new DomainError("ZIWEI_CHART_MISMATCH", "命盘标识不一致，请重新排盘", 422);
    const owner = createHmac("sha256", this.hashSecret).update(ip).digest("hex");
    const quotaKey = `website-ziwei:quota:${owner}`, recordKey = `website-ziwei:request:${owner}:${request.requestId}`;
    const fingerprint = createHash("sha256").update(hash + ':' + request.knowledgeVersion).digest("hex");
    const stored: Stored = { fingerprint, status: "pending" };
    let reservation: string[];
    try {
      reservation = await this.redis.eval(ZIWEI_RESERVE_SCRIPT, 2, quotaKey, recordKey,
        request.requestId, JSON.stringify(stored), ZIWEI_WINDOW_MS, ZIWEI_IP_CALLS) as string[];
    } catch { throw new DomainError("ZIWEI_QUOTA_UNAVAILABLE", "次数校验服务暂不可用，未调用模型", 503); }
    if (reservation[0] === "limited") throw new DomainError("ZIWEI_RATE_LIMITED", "同一 IP 在滚动 24 小时内最多解读 2 次，请稍后再试", 429, true, {details:{retryAfterSeconds:Number(reservation[1])}});
    if (reservation[0] === "existing") {
      const previous: Stored = JSON.parse(reservation[1]);
      if (previous.fingerprint !== fingerprint) throw new DomainError("ZIWEI_REQUEST_CONFLICT", "请求编号已用于其他命盘，请重新生成请求", 409);
      if (previous.status === "completed" && previous.result) return previous.result;
      throw new DomainError(previous.status === "pending" ? "ZIWEI_PENDING" : "ZIWEI_PREVIOUS_FAILED",
        previous.status === "pending" ? "该解读仍在处理中，请勿重复提交" : "此请求未成功返回，已计入调用次数；重试需要使用剩余次数", 409);
    }
    if (reservation[0] !== "reserved") throw new DomainError("ZIWEI_QUOTA_UNAVAILABLE", "次数校验服务暂不可用，未调用模型", 503);
    try {
      const text = await this.generate(request);
      if (!text.trim()) throw new Error("Empty interpretation");
      const result: WebsiteZiweiResult = {schemaVersion:1,requestId:request.requestId,chartFingerprint:hash,text,remainingCalls:Number(reservation[1]),model:this.model};
      await this.redis.set(recordKey, JSON.stringify({...stored,status:"completed",result}), "KEEPTTL");
      return result;
    } catch {
      await this.redis.set(recordKey, JSON.stringify({...stored,status:"failed"}), "KEEPTTL").catch(() => undefined);
      throw new DomainError("ZIWEI_MODEL_FAILED", "解读暂未成功返回。请求已提交并计入次数，请勿连续点击；可稍后使用剩余次数重试", 503);
    }
  }
}
