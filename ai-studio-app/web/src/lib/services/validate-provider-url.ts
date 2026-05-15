/**
 * SSRF validation for provider base URLs.
 *
 * Blocks private IPs, loopback, link-local, cloud metadata endpoints,
 * and non-HTTP(S) schemes before any outbound HTTP request to a
 * user-supplied provider URL.
 */

function isPrivateIP(ip: string): boolean {
  const v4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4Match) {
    const [, aStr, bStr] = v4Match;
    const a = Number(aStr);
    const b = Number(bStr);
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;             // 192.168.0.0/16
    if (a === 169 && b === 254) return true;             // link-local
    if (a === 127) return true;                          // loopback
    if (a === 0) return true;                            // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64.0.0/10
    if (a >= 240) return true;                           // reserved / broadcast
    return false;
  }

  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;            // IPv6 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // IPv6 ULA
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIP(v4Mapped[1]);

  // Handle hex-encoded IPv4-mapped IPv6 (e.g. ::ffff:c0a8:101 from URL parser)
  const v4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const high = parseInt(v4MappedHex[1], 16);
    const low = parseInt(v4MappedHex[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return isPrivateIP(`${a}.${b}.${c}.${d}`);
  }

  return false;
}

const BLOCKED_HOSTS = [
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
];

/**
 * Validates a provider base URL is safe for outbound requests.
 * Throws an Error if the URL targets a private/reserved address or cloud metadata endpoint.
 */
export function validateProviderUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("Invalid provider URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol} — only http/https allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname)) {
    throw new Error("Blocked: localhost/loopback URLs not allowed for provider base URL");
  }

  if (isPrivateIP(hostname)) {
    throw new Error("Blocked: private/reserved IP address not allowed for provider base URL");
  }

  if (BLOCKED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h))) {
    throw new Error("Blocked: cloud metadata endpoint not allowed for provider base URL");
  }

  return parsed;
}
