/**
 * Shared SSRF protection utilities.
 * Combines IP range checks from provider-factory and node-handlers.
 */

export function isPrivateIP(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "0.0.0.0" || ip === "::1" || ip === "::" || ip === "localhost") return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 240) return true;
  return false;
}

const BLOCKED_CLOUD_METADATA = ["metadata.google.internal", "metadata.google.com", "instance-data"];

export function validateBaseUrl(url: string | null | undefined): void {
  if (!url) return;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid provider base URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https allowed for provider URL");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    throw new Error("Blocked: loopback address not allowed for provider URL");
  }
  if (isPrivateIP(host)) {
    throw new Error("Blocked: private/reserved IP not allowed for provider URL");
  }
  if (BLOCKED_CLOUD_METADATA.some((h) => host === h || host.endsWith("." + h))) {
    throw new Error("Blocked: cloud metadata endpoint not allowed for provider URL");
  }
}
