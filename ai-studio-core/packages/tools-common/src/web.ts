import dns from "node:dns";
import type { ToolRegistration } from "@ais/tool-platform";
import { textEnvelope } from "@ais/tool-platform";
import type { BuiltinToolContext } from "./types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
  const lines: string[] = [
    `Query: ${query}`,
    `${results.length} result${results.length === 1 ? "" : "s"}:`,
    "",
  ];
  for (const [i, r] of results.entries()) {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    lines.push(`   ${r.snippet}`);
    lines.push("");
  }
  return lines.join("\n");
}

function isPrivateIP(ip: string): boolean {
  const v4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4Match) {
    const [, aStr, bStr] = v4Match;
    const a = Number(aStr);
    const b = Number(bStr);
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

  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIP(v4Mapped[1]);

  return false;
}

export function validateFetchUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme: ${parsed.protocol} — only http/https allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname)) {
    throw new Error("Blocked: localhost/loopback URLs not allowed");
  }

  if (isPrivateIP(hostname)) {
    throw new Error("Blocked: private/reserved IP address");
  }

  const blockedHosts = ["metadata.google.internal", "metadata.google.com", "instance-data"];
  if (blockedHosts.some((h) => hostname === h || hostname.endsWith("." + h))) {
    throw new Error("Blocked: cloud metadata endpoint");
  }

  return parsed;
}

async function validateResolvedIP(hostname: string): Promise<void> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) return;

  try {
    const { address } = await dns.promises.lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(`Blocked: hostname "${hostname}" resolves to private IP ${address}`);
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message.startsWith("Blocked:")) throw e;
  }
}

function getCtx(context: Record<string, unknown>): BuiltinToolContext {
  return context as unknown as BuiltinToolContext;
}

export const webTools: ToolRegistration[] = [
  {
    definition: {
      name: "web_fetch",
      description: "Fetch a URL and extract readable content as text. Strips HTML tags, scripts, and styles.",
      alwaysLoad: true,
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
          maxChars: { type: "number", description: "Maximum characters to return (default: 50000)" },
        },
        required: ["url"],
      },
    },
    executor: async (args) => {
      const url = args.url as string;
      if (!url || typeof url !== "string") {
        return { error: "url is required" };
      }

      try {
        const parsed = validateFetchUrl(url);
        await validateResolvedIP(parsed.hostname);
      } catch (e: unknown) {
        return { error: `SSRF protection: ${e instanceof Error ? e.message : String(e)}` };
      }

      const maxChars = (args.maxChars as number) || 50000;

      try {
        let currentUrl = url;
        let res: Response;
        const maxRedirects = 5;
        for (let i = 0; ; i++) {
          res = await fetch(currentUrl, {
            headers: { "User-Agent": "EcholAIStudio/1.0" },
            signal: AbortSignal.timeout(30000),
            redirect: "manual",
          });
          if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
            if (i >= maxRedirects) return { error: "Too many redirects" };
            const nextUrl = new URL(res.headers.get("location")!, currentUrl);
            try {
              validateFetchUrl(nextUrl.href);
              await validateResolvedIP(nextUrl.hostname);
            } catch (e: unknown) {
              return { error: `SSRF protection on redirect: ${e instanceof Error ? e.message : String(e)}` };
            }
            currentUrl = nextUrl.href;
            continue;
          }
          break;
        }

        const reader = res!.body?.getReader();
        let text = "";
        if (reader) {
          const decoder = new TextDecoder();
          const byteLimit = maxChars * 4;
          let bytesRead = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            text += decoder.decode(value, { stream: true });
            if (bytesRead >= byteLimit) break;
          }
          reader.cancel().catch(() => {});
        } else {
          text = await res!.text();
        }

        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, maxChars);

        const hint = text.length < 200
          ? "\nHint: Content appears very short — this site may require JavaScript rendering."
          : "";
        return textEnvelope(`URL: ${url}\nChars: ${text.length}${hint}\n\n${text}`);
      } catch (e: unknown) {
        return { error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
    maxResultSizeChars: 96 * 1024,
  },
  {
    definition: {
      name: "web_search",
      description: "Search the web using Brave Search API. Returns titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "number", description: "Number of results (1-10, default 5)" },
        },
        required: ["query"],
      },
    },
    executor: async (args, context) => {
      const ctx = getCtx(context as Record<string, unknown>);
      const apiKey = ctx.braveApiKey;
      if (!apiKey) return { error: "Brave Search API key not configured. Ask your admin to add one in Settings." };

      const query = args.query as string;
      if (!query) return { error: "query is required" };

      const count = Math.min((args.count as number) || 5, 10);

      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
        const res = await fetch(url, {
          headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });

        if (!res.ok) {
          return { error: `Brave Search API returned ${res.status}: ${res.statusText}` };
        }

        const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
        const results = (data.web?.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));

        return textEnvelope(formatSearchResults(query, results));
      } catch (e: unknown) {
        return { error: `Search failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    source: "builtin",
    category: "read",
    concurrencySafe: true,
    isReadOnly: true,
  },
];
