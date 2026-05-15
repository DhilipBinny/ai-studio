import { AnthropicProvider, OpenAIProvider } from "@ais/provider-bridge";
import type { ProviderInterface } from "@ais/provider-bridge";
import { decryptSecret, isEncrypted } from "@ais-app/auth";
import type { ProviderConfig } from "./types";

function resolveSecret(value: string | null): string | null {
  if (!value) return null;
  if (isEncrypted(value)) return decryptSecret(value);
  return value;
}

function validateBaseUrl(url: string | null | undefined): void {
  if (!url) return;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Invalid provider base URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https allowed for provider URL");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    throw new Error("Blocked: loopback address not allowed for provider URL");
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [, aS, bS] = v4;
    const a = Number(aS), b = Number(bS);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        || (a === 169 && b === 254) || a === 127 || a === 0 || (a === 100 && b >= 64 && b <= 127) || a >= 240) {
      throw new Error("Blocked: private/reserved IP not allowed for provider URL");
    }
  }
  const blocked = ["metadata.google.internal", "metadata.google.com", "instance-data"];
  if (blocked.some((h) => host === h || host.endsWith("." + h))) {
    throw new Error("Blocked: cloud metadata endpoint not allowed for provider URL");
  }
}

export function createProvider(config: ProviderConfig): ProviderInterface {
  validateBaseUrl(config.baseUrl);

  const providerCfg = config.config as Record<string, unknown> || {};
  const isOAuth = providerCfg.authMethod === "oauth_token";
  const apiKey = resolveSecret(config.apiKeyRef);

  switch (config.providerType) {
    case "anthropic": {
      if (isOAuth) {
        const betaFlags = (providerCfg.betaFlags as string) || "";
        const defaultHeaders = (providerCfg.defaultHeaders as Record<string, string>) || {};
        const systemPromptPrefix = (providerCfg.systemPromptPrefix as string) || "";

        return new AnthropicProvider(
          {
            authToken: apiKey || "",
            defaultModel: config.modelId,
            baseUrl: config.baseUrl || undefined,
          },
          {
            defaultHeaders: {
              ...defaultHeaders,
              ...(betaFlags ? { "anthropic-beta": betaFlags } : {}),
            },
            systemPromptPrefix,
          },
        );
      }
      return new AnthropicProvider({
        apiKey: apiKey || "",
        baseUrl: config.baseUrl || undefined,
        defaultModel: config.modelId,
      });
    }

    case "openai":
      return new OpenAIProvider({
        apiKey: apiKey || "",
        defaultModel: config.modelId,
      });

    case "ollama":
      return new OpenAIProvider({
        apiKey: "ollama",
        baseUrl: (config.baseUrl || "http://localhost:11434") + "/v1",
        defaultModel: config.modelId,
        name: "ollama",
      });

    case "openai_compatible":
      return new OpenAIProvider({
        apiKey: apiKey || "",
        baseUrl: config.baseUrl || undefined,
        defaultModel: config.modelId,
      });

    default:
      throw new Error(`Unsupported provider type: ${config.providerType}`);
  }
}
