import { lookup as dnsLookup } from "node:dns";
import { Agent, RetryAgent, buildConnector } from "undici";

// DNS remains authoritative. Remember only addresses observed during this
// process; a preferred address must still appear in each fresh DNS response.
export function createPinhaozhanTransport(
  lookup: typeof dnsLookup = dnsLookup,
) {
  const preferred = new Map<string, string>();
  const failed = new Map<string, Set<string>>();
  const agent = new Agent({
    connect(options, callback) {
      let address: string | undefined;
      const connect = buildConnector({
        family: 4,
        lookup(hostname, _options, callback) {
          lookup(hostname, { all: true, family: 4 }, (error, addresses) => {
            if (error) return callback(error, "", 4);
            const good = addresses.filter(
              (a) => !failed.get(hostname)?.has(a.address),
            );
            const candidates = good.length ? good : addresses;
            const selected =
              candidates.find((a) => a.address === preferred.get(hostname)) ??
              candidates[0];
            if (!selected)
              return callback(
                Object.assign(new Error("No IPv4 address"), {
                  code: "ENOTFOUND",
                }),
                "",
                4,
              );
            // buildConnector requests one address (family:4), keeping hostname/SNI
            // and certificate verification intact.
            address = selected.address;
            callback(null, selected.address, 4);
          });
        },
      });
      connect(options, (error, connected) => {
        if (address) {
          if (error) {
            const rejected = failed.get(options.hostname) ?? new Set<string>();
            rejected.add(address);
            failed.set(options.hostname, rejected);
            if (preferred.get(options.hostname) === address)
              preferred.delete(options.hostname);
          } else {
            preferred.set(options.hostname, address);
            failed.get(options.hostname)?.delete(address);
          }
        }
        if (error) callback(error, null);
        else callback(null, connected);
      });
    },
  });
  const readonly = new RetryAgent(agent, {
    maxRetries: 1,
    methods: ["GET"],
    statusCodes: [],
    retryAfter: false,
    errorCodes: [
      "UND_ERR_CONNECT_TIMEOUT",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ],
  });
  return { agent, readonly };
}
