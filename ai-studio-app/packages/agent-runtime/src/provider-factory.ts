import { AnthropicProvider, OpenAIProvider } from "@ais/provider-bridge";
import type { ProviderInterface } from "@ais/provider-bridge";
import type { ProviderConfig } from "./types";

export function createProvider(config: ProviderConfig): ProviderInterface {
  const providerCfg = config.config as Record<string, unknown> || {};
  const isOAuth = providerCfg.authMethod === "oauth_token";

  switch (config.providerType) {
    case "anthropic": {
      if (isOAuth) {
        const betaFlags = (providerCfg.betaFlags as string) || "";
        const defaultHeaders = (providerCfg.defaultHeaders as Record<string, string>) || {};
        const systemPromptPrefix = (providerCfg.systemPromptPrefix as string) || "";

        return new AnthropicProvider(
          {
            authToken: config.apiKeyRef || "",
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
        apiKey: config.apiKeyRef || "",
        baseUrl: config.baseUrl || undefined,
        defaultModel: config.modelId,
      });
    }

    case "openai":
      return new OpenAIProvider({
        apiKey: config.apiKeyRef || "",
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
        apiKey: config.apiKeyRef || "",
        baseUrl: config.baseUrl || undefined,
        defaultModel: config.modelId,
      });

    default:
      throw new Error(`Unsupported provider type: ${config.providerType}`);
  }
}
