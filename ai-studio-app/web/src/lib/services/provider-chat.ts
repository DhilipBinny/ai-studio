/**
 * Quick Chat — instantiates provider from DB config and calls chat().
 * Uses the same AnthropicProvider/OpenAIProvider from KairoClaw provider-bridge.
 * No tools, no thinking — just a simple message and response.
 *
 * TODO: Import from @ais/provider-bridge once core workspace is linked.
 * For now, we create SDK clients directly since the core types aren't resolved yet.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

interface QuickChatConfig {
  providerType: string;
  apiKeyRef: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
  modelId: string;
  message: string;
}

interface QuickChatResult {
  success: boolean;
  response: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export async function quickChat(cfg: QuickChatConfig): Promise<QuickChatResult> {
  const start = Date.now();

  try {
    if (cfg.providerType === "anthropic") {
      return await chatAnthropic(cfg, start);
    }
    return await chatOpenAI(cfg, start);
  } catch (e) {
    return { success: false, response: null, latencyMs: Date.now() - start, inputTokens: 0, outputTokens: 0, error: (e as Error).message };
  }
}

function buildAnthropicClient(cfg: QuickChatConfig): Anthropic {
  const isOAuth = cfg.config?.authMethod === "oauth_token";
  const opts: Record<string, unknown> = {};

  if (isOAuth) {
    opts.apiKey = "";
    opts.authToken = cfg.apiKeyRef;
    const betaFlags = (cfg.config?.betaFlags as string) || "";
    const headers = (cfg.config?.defaultHeaders as Record<string, string>) || {};
    if (betaFlags || Object.keys(headers).length > 0) {
      opts.defaultHeaders = { ...headers, ...(betaFlags ? { "anthropic-beta": betaFlags } : {}) };
    }
  } else {
    opts.apiKey = cfg.apiKeyRef || "";
  }

  if (cfg.baseUrl) opts.baseURL = cfg.baseUrl;
  return new Anthropic(opts as ConstructorParameters<typeof Anthropic>[0]);
}

async function chatAnthropic(cfg: QuickChatConfig, start: number): Promise<QuickChatResult> {
  const client = buildAnthropicClient(cfg);
  const isOAuth = cfg.config?.authMethod === "oauth_token";

  const system: Anthropic.TextBlockParam[] = [];
  if (isOAuth) {
    system.push({ type: "text", text: (cfg.config?.systemPromptPrefix as string) || "You are Claude Code, Anthropic's official CLI for Claude." });
  }

  const res = await client.messages.create({
    model: cfg.modelId,
    max_tokens: 1024,
    system: system.length > 0 ? system : undefined,
    messages: [{ role: "user", content: cfg.message }],
  });

  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  return { success: true, response: text, latencyMs: Date.now() - start, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
}

async function chatOpenAI(cfg: QuickChatConfig, start: number): Promise<QuickChatResult> {
  const isOllama = cfg.providerType === "ollama";
  const client = new OpenAI({
    apiKey: cfg.apiKeyRef || (isOllama ? "ollama" : ""),
    ...(isOllama ? { baseURL: (cfg.baseUrl || "http://localhost:11434") + "/v1" } : cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
  });

  const res = await client.chat.completions.create({
    model: cfg.modelId,
    max_tokens: 1024,
    messages: [{ role: "user", content: cfg.message }],
  });

  return {
    success: true,
    response: res.choices[0]?.message?.content || null,
    latencyMs: Date.now() - start,
    inputTokens: res.usage?.prompt_tokens || 0,
    outputTokens: res.usage?.completion_tokens || 0,
  };
}
