import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ProviderConfig, LLMResponse } from "./types";
import type { ToolDefinition } from "./tool-executor";

interface Message {
  role: "user" | "assistant" | "tool";
  content: string | Anthropic.ContentBlock[];
  tool_call_id?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMCallResult {
  text: string;
  toolCalls: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export async function callLLM(
  provider: ProviderConfig,
  systemPrompt: string,
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number; tools?: ToolDefinition[] },
): Promise<LLMCallResult> {
  if (provider.providerType === "anthropic") {
    return callAnthropic(provider, systemPrompt, messages, options);
  }
  return callOpenAI(provider, systemPrompt, messages, options);
}

function buildAnthropicClient(provider: ProviderConfig): Anthropic {
  const isOAuth = provider.config?.authMethod === "oauth_token";
  const opts: Record<string, unknown> = {};

  if (isOAuth) {
    opts.apiKey = "";
    opts.authToken = provider.apiKeyRef;
    const betaFlags = (provider.config?.betaFlags as string) || "";
    const headers = (provider.config?.defaultHeaders as Record<string, string>) || {};
    if (betaFlags || Object.keys(headers).length > 0) {
      opts.defaultHeaders = { ...headers, ...(betaFlags ? { "anthropic-beta": betaFlags } : {}) };
    }
  } else {
    opts.apiKey = provider.apiKeyRef || "";
  }

  if (provider.baseUrl) opts.baseURL = provider.baseUrl;
  return new Anthropic(opts as ConstructorParameters<typeof Anthropic>[0]);
}

async function callAnthropic(
  provider: ProviderConfig,
  systemPrompt: string,
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number; tools?: ToolDefinition[] },
): Promise<LLMCallResult> {
  const client = buildAnthropicClient(provider);
  const isOAuth = provider.config?.authMethod === "oauth_token";

  const system: Anthropic.TextBlockParam[] = [];
  if (isOAuth) {
    const prefix = (provider.config?.systemPromptPrefix as string) || "";
    if (prefix) system.push({ type: "text", text: prefix });
  }
  system.push({ type: "text", text: systemPrompt });

  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user" as const,
        content: [{
          type: "tool_result" as const,
          tool_use_id: m.tool_call_id || "",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }],
      };
    }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      return { role: "assistant" as const, content: m.content as Anthropic.ContentBlock[] };
    }
    return {
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    };
  });

  const params: Anthropic.MessageCreateParams = {
    model: provider.modelId,
    max_tokens: options?.maxTokens || 4096,
    temperature: options?.temperature,
    system,
    messages: anthropicMessages,
  };

  if (options?.tools && options.tools.length > 0) {
    params.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool["input_schema"],
    }));
  }

  const res = await client.messages.create(params);

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const toolCalls = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

  return {
    text,
    toolCalls,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    stopReason: res.stop_reason || "end_turn",
  };
}

async function callOpenAI(
  provider: ProviderConfig,
  systemPrompt: string,
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number; tools?: ToolDefinition[] },
): Promise<LLMCallResult> {
  const isOllama = provider.providerType === "ollama";
  const client = new OpenAI({
    apiKey: provider.apiKeyRef || (isOllama ? "ollama" : ""),
    ...(isOllama
      ? { baseURL: (provider.baseUrl || "http://localhost:11434") + "/v1" }
      : provider.baseUrl
        ? { baseURL: provider.baseUrl }
        : {}),
  });

  const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content), tool_call_id: m.tool_call_id || "" };
      }
      return { role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) };
    }),
  ];

  const params: OpenAI.ChatCompletionCreateParams = {
    model: provider.modelId,
    max_tokens: options?.maxTokens || 4096,
    temperature: options?.temperature,
    messages: openaiMessages,
  };

  if (options?.tools && options.tools.length > 0) {
    params.tools = options.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  const res = await client.chat.completions.create(params);
  const choice = res.choices[0];

  const toolCalls = (choice?.message?.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
  }));

  return {
    text: choice?.message?.content || "",
    toolCalls,
    inputTokens: res.usage?.prompt_tokens || 0,
    outputTokens: res.usage?.completion_tokens || 0,
    stopReason: choice?.finish_reason || "stop",
  };
}
