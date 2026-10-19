import { hostname, networkInterfaces } from "node:os";
import type { IncomingHttpHeaders } from "node:http";

export function createOriginGuard(
  bindHost: string,
  port: number,
  origins: Set<string>,
) {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    hosts.add(hostname().toLowerCase());
    for (const entries of Object.values(networkInterfaces()))
      for (const entry of entries ?? [])
        hosts.add(
          entry.family === "IPv6"
            ? `[${entry.address.toLowerCase()}]`
            : entry.address,
        );
  } else
    hosts.add(
      bindHost.includes(":") && !bindHost.startsWith("[")
        ? `[${bindHost}]`
        : bindHost.toLowerCase(),
    );
  const authorities = new Set(
    [...hosts].map((host) => new URL(`http://${host}:${port}`).host),
  );
  for (const origin of origins) {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol) || url.origin !== origin)
      throw new Error("ALLOWED_ORIGINS 必须是完整的 HTTP(S) 来源");
    authorities.add(url.host);
  }
  return (headers: IncomingHttpHeaders, requireOrigin = false) => {
    const host = headers.host?.toLowerCase();
    if (!host || !authorities.has(host)) return false;
    const origin = headers.origin;
    if (!origin) return !requireOrigin;
    if (origins.has(origin)) return true;
    try {
      const url = new URL(origin);
      return (
        /^https?:$/.test(url.protocol) &&
        url.origin === origin &&
        url.host === host
      );
    } catch {
      return false;
    }
  };
}
