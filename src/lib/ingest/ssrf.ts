import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { IngestError } from "./errors";

export class UnsafeUrlError extends IngestError {}

/** True for any address that is not a normal, publicly routable unicast IP. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

function isPublicV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false; // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0) return false; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:abcd:efgh) — judge by the embedded IPv4 address.
  const mapped = lower.match(/^(?:0{0,4}:){0,5}ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (isIP(rest) === 4) return isPublicV4(rest);
    const hex = rest.split(":");
    if (hex.length === 2) {
      const n = (parseInt(hex[0], 16) << 16) | parseInt(hex[1], 16);
      return isPublicV4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
    return false;
  }
  if (lower === "::" || lower === "::1") return false; // unspecified, loopback
  if (/^f[cd]/.test(lower)) return false; // fc00::/7 unique local
  if (/^fe[89ab]/.test(lower)) return false; // fe80::/10 link-local
  if (/^ff/.test(lower)) return false; // multicast
  if (lower.startsWith("64:ff9b:")) return false; // NAT64 — could wrap a private v4
  if (lower.startsWith("2001:db8")) return false; // documentation
  return true;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa"];

/**
 * Validate that a URL is plain http(s) to a public host. Resolves DNS and rejects if ANY
 * returned address is private/loopback/link-local. Throws UnsafeUrlError otherwise.
 *
 * Known limit: DNS is resolved again when fetching, so a hostile DNS server could rebind
 * between check and use. Acceptable for a single-user app behind a login; callers also
 * re-validate every redirect hop.
 */
export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) links are supported");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials aren't allowed");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("That address points to a private network");
  }

  if (isIP(host)) {
    if (!isPublicIp(host)) throw new UnsafeUrlError("That address points to a private network");
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("Couldn't resolve that hostname");
  }
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address))) {
    throw new UnsafeUrlError("That address points to a private network");
  }
  return url;
}
