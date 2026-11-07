import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Redis } from "ioredis";
import { forwardedClientIp } from "./auth-rate-limit.js";
import { DomainError } from "./domain.js";
import { Token360Provider } from "./provider.js";
import { WebsiteZiweiService, type WebsiteZiweiRequest } from "./website-ziwei-service.js";
export { z } from "zod";

export function createWebsiteZiweiApp(service: Pick<WebsiteZiweiService, "interpret">,
  parse: (body: unknown) => WebsiteZiweiRequest, origin = "https://shoumiren.online") {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.get('/healthz', c => c.json({ok:true}));
  app.post('/api/website/ziwei/interpret', async c => {
    if (c.req.header('Origin') !== origin) throw new DomainError('UNTRUSTED_ORIGIN', '请求来源不受信任', 403);
    let request: WebsiteZiweiRequest;
    try { request = parse(await c.req.json()); }
    catch { throw new DomainError('ZIWEI_INVALID_CHART', '命盘资料无效或版本已更新，请刷新后重新排盘', 422); }
    let peer: string | undefined;
    try { peer = getConnInfo(c).remote.address; } catch { /* Fail closed without socket identity. */ }
    return c.json({data:await service.interpret(request, forwardedClientIp(c.req.raw, peer))});
  });
  app.onError((error, c) => {
    if (error instanceof DomainError) {
      const retry = error.details?.retryAfterSeconds;
      if (typeof retry === 'number') c.header('Retry-After', String(retry));
      return c.json({error:{code:error.code,message:error.message,...(retry ? {retryAfterSeconds:retry} : {})}},error.status);
    }
    return c.json({error:{code:'ZIWEI_UNAVAILABLE',message:'解读服务暂不可用，请稍后重试'}},503);
  });
  return app;
}

export async function startWebsiteZiwei(parse: (body: unknown) => WebsiteZiweiRequest,
  prompt: (request: WebsiteZiweiRequest) => Array<{role:"system"|"user";content:string}>) {
  const apiKey = process.env.WEBSITE_ZIWEI_API_KEY?.trim();
  const hashSecret = process.env.WEBSITE_ZIWEI_IP_HASH_SECRET;
  const model = process.env.WEBSITE_ZIWEI_MODEL;
  const baseUrl = process.env.WEBSITE_ZIWEI_BASE_URL;
  if (!apiKey || !hashSecret || model !== 'deepseek-v4.1-flash-1017' || baseUrl !== 'https://pinhaozhan.vip') throw new Error('Website Ziwei configuration is incomplete');
  const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {maxRetriesPerRequest:1,enableOfflineQueue:false});
  await new Promise<void>((resolve,reject) => {redis.once('ready',resolve);redis.once('error',reject);});
  // Same server-side compatible text provider used by canvas jobs. The public
  // website is sponsor funded; it does not bypass or debit an account's balance.
  const provider = new Token360Provider({apiKey,baseUrl,catalogUrl:''}, Number(process.env.PROVIDER_SUBMIT_TIMEOUT_MS || 0));
  const service = new WebsiteZiweiService(redis,hashSecret,model,async request => {
    const result = await provider.create({modelId:model,upstreamModel:model,providerId:'pinhaozhan',capability:'text',mode:'chat',prompt:'单人紫微命盘解读',upstreamParameters:{messages:prompt(request)}},request.requestId);
    const text = result.artifacts?.find(a => a.kind === 'text')?.text;
    if (!text) throw new Error('No text result');
    return text;
  });
  serve({fetch:createWebsiteZiweiApp(service,parse).fetch,hostname:'0.0.0.0',port:3002});
  console.log('Website Ziwei service ready; fixed model and server-side quota enabled');
}
