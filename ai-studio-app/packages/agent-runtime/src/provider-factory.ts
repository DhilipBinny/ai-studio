import { AnthropicProvider, OpenAIProvider } from "@ais/provider-bridge";
import type { ProviderInterface } from "@ais/provider-bridge";
import { decryptSecret, isEncrypted } from "@ais-app/auth";
import type { ProviderConfig } from "./types";

function resolveSecret(value: string | null): string | null {
  if (!value) return null;
  if (isEncrypted(value)) return decryptSecret(value);
  return value;
}

export function createProvider(config: ProviderConfig): ProviderInterface {
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
