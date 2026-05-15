/**
 * Lightweight LLM caller for RAG features (HyDE, RAGAS evaluation, contextual enrichment).
 *
 * Creates an LLMCaller interface implementation backed by the provider-bridge.
 * This keeps the core rag-engine package provider-agnostic while allowing
 * app-layer features to call any configured LLM.
 */

import { OpenAIProvider } from "@ais/provider-bridge";
import { AnthropicProvider } from "@ais/provider-bridge";
import type { LLMCaller } from "@ais/rag-engine";

export interface LLMCallerConfig {
  providerType: string;       // "openai" | "anthropic" | "ollama" | "openai_compatible"
  model: string;              // e.g. "gpt-4o-mini", "claude-haiku-4-20250514"
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Create an LLMCaller from a provider configuration.
 * The returned caller translates simple prompt strings into provider chat calls.
 */
export function createLLMCaller(config: LLMCallerConfig): LLMCaller {
  const { providerType, model, apiKey, baseUrl } = config;

  if (providerType === "anthropic") {
    const provider = new AnthropicProvider({
      apiKey: apiKey || "",
      baseUrl: baseUrl || undefined,
      defaultModel: model,
    });

    return {
      async call(prompt: string, options?: { maxTokens?: number; temperature?: number; systemMessage?: string }): Promise<string> {
        const response = await provider.chat({
          model,
          messages: [{ role: "user", content: prompt }],
          systemPrompt: options?.systemMessage || "",
          maxTokens: options?.maxTokens,
          temperature: options?.temperature,
        });
        return response.text || "";
      },
    };
  }

  // OpenAI, Ollama, and OpenAI-compatible providers all use the OpenAI provider class
  const provider = new OpenAIProvider({
    apiKey: apiKey || "ollama",
    baseUrl: providerType === "ollama" ? (baseUrl ? `${baseUrl}/v1` : undefined) : baseUrl,
    defaultModel: model,
    name: providerType,
  });

  return {
    async call(prompt: string, options?: { maxTokens?: number; temperature?: number; systemMessage?: string }): Promise<string> {
      const response = await provider.chat({
        model,
        messages: [{ role: "user", content: prompt }],
        systemPrompt: options?.systemMessage || "",
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      });
      return response.text || "";
    },
  };
}
