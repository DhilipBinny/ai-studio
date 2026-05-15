import { createProvider } from "./provider-factory";
import type { ProviderConfig } from "./types";
import type { ToolDefinition } from "./tool-executor";

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

interface Message {
  role: string;
  content: string | unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

type MessageRole = "user" | "assistant" | "system" | "tool";

export async function callLLM(
  providerCfg: ProviderConfig,
  systemPrompt: string,
  messages: Message[],
  options?: { temperature?: number; maxTokens?: number; tools?: ToolDefinition[] },
): Promise<LLMCallResult> {
  const provider = createProvider(providerCfg);

  const chatMessages = messages.map((m) => ({
    role: m.role as MessageRole,
    content: typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? "" : JSON.stringify(m.content)),
    tool_call_id: m.tool_call_id,
    tool_calls: m.tool_calls,
  }));

  const response = await provider.chat({
    messages: chatMessages,
    model: providerCfg.modelId,
    systemPrompt: { cached: systemPrompt, dynamic: "" },
    tools: options?.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    })) as import("@ais/types").ToolDefinition[] | undefined,
  });

  return {
    text: response.text || "",
    toolCalls: (response.toolCalls || []).map((tc) => {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = {};
      }
      return { id: tc.id, name: tc.function.name, input };
    }),
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    stopReason: response.toolCalls?.length ? "tool_use" : "end_turn",
  };
}
