import { lookup } from "node:dns";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, buildConnector } from "undici";
import { DomainError } from "./domain.js";

export function assertPublicMediaAddress(address: string) {
  if (!ipaddr.isValid(address) || ipaddr.process(address).range() !== "unicast")
    throw new DomainError("UNSAFE_MEDIA_URL", "参考素材地址不允许访问内网或保留地址", 422);
}

// Validate the addresses actually used by the socket, not a separate DNS preflight.
// The connector runs again for redirect destinations and new pooled connections.
export function createPublicMediaConnector(resolve = lookup) {
  const connector = buildConnector({
    lookup(hostname, options, callback) {
      resolve(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        try {
          if (!addresses.length) throw new Error("No media address");
          addresses.forEach(({ address }) => assertPublicMediaAddress(address));
          if (typeof options === "object" && options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        } catch (error) { callback(error as Error, "", 4); }
      });
    },
  });
  const connect: typeof connector = (options, callback) => {
    try {
      const host = options.hostname.replace(/^\[|\]$/g, "");
      if (isIP(host)) assertPublicMediaAddress(host);
      if (!["http:", "https:"].includes(options.protocol) || options.socketPath || options.httpSocket)
        throw new DomainError("UNSAFE_MEDIA_URL", "参考素材地址无效", 422);
      connector(options, callback);
    } catch (error) { callback(error as Error, null); }
  };
  return connect;
}

const dispatcher = new Agent({ connect: createPublicMediaConnector() });

export async function fetchRemoteMedia(source: string, init: RequestInit = {}) {
  const url = new URL(source);
  if (url.protocol === "data:") return fetch(source, init);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new DomainError("UNSAFE_MEDIA_URL", "参考素材仅支持公开 HTTP 或 HTTPS 地址", 422);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) assertPublicMediaAddress(host);
  try { return await fetch(url, { ...init, dispatcher } as RequestInit); }
  catch (error) {
    let cause: unknown = error;
    while (cause instanceof Error) {
      if (cause instanceof DomainError && cause.code === "UNSAFE_MEDIA_URL") throw cause;
      cause = cause.cause;
    }
    throw error;
  }
}
