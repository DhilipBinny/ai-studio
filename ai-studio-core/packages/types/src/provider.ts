/**
 * LLM provider types.
 *
 * Providers wrap specific LLM APIs (Anthropic, OpenAI, Ollama) behind
 * a common interface. The agent loop calls `provider.chat()` and
 * receives a uniform `ProviderResponse`.
 */

import type { Message } from './message.js';
import type { ToolDefinition } from './tool.js';

/**
 * Token usage information returned by a provider.
 */
export interface TokenUsage {
  /** Number of input (prompt) tokens consumed. */
  inputTokens: number;
  /** Number of output (completion) tokens consumed. */
  outputTokens: number;
}

/**
 * Response from an LLM provider's `chat()` method.
 *
 * Contains the assistant's text, any tool calls it wants to make,
 * and token usage metrics.
 */
export interface ProviderResponse {
  /** The assistant's text reply, or `null` if the response is tool-only. */
  text: string | null;
  /** Tool calls the assistant wants to execute, or `null` if none. */
  toolCalls: import('./message.js').ToolCall[] | null;
  /** Token usage for this request. */
  usage: TokenUsage;
  /** Accumulated thinking text from extended thinking, if any. */
  thinkingText?: string | null;
  /** Structured thinking blocks with signatures (Anthropic only). */
  thinkingBlocks?: import('./message.js').ThinkingBlock[];
}

/**
 * Arguments passed to a provider's `chat()` method.
 */
/** Extended thinking configuration passed to providers. */
export interface ThinkingConfig {
  enabled: boolean;
  mode: 'enabled' | 'adaptive';
  budgetTokens?: number;
}

/**
 * Structured system prompt with cache boundary.
 *
 * Static content (persona, tool descriptions, safety rules) goes in `cached` —
 * Anthropic caches this prefix for 5 min, saving ~90% on input token costs.
 * Dynamic content (time, memory, session context) goes in `dynamic` —
 * changes every call, never cached.
 */
export interface StructuredSystemPrompt {
  cached: string;
  dynamic: string;
}

export interface ChatArgs {
  /** Conversation messages (history + current user message). */
  messages: Message[];
  /** Available tool definitions. */
  tools?: ToolDefinition[];
  /** Model ID to use (overrides provider default). */
  model: string;
  /**
   * System prompt prepended to the conversation.
   * Pass a string for backwards compatibility, or a StructuredSystemPrompt
   * to enable prompt caching on the static prefix (Anthropic only).
   */
  systemPrompt: string | StructuredSystemPrompt;
  /** Streaming callback — called with each text delta. */
  onDelta?: (delta: string) => void;
  /** Streaming callback — called with each thinking delta. */
  onThinkingDelta?: (delta: string) => void;
  /** Extended thinking configuration. */
  thinkingConfig?: ThinkingConfig;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /**
   * Tool executor function — used by SDK/CLI providers to execute tools in-process.
   * OAuth providers ignore this (tool calls are returned to the agent loop).
   */
  _executeTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Maximum tool rounds — passed to SDK provider for maxTurns. */
  _maxToolRounds?: number;
}

/**
 * Common interface for all LLM providers.
 *
 * Implementations: `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider`.
 */
export interface ProviderInterface {
  /** Provider identifier (e.g. `'anthropic'`, `'openai'`, `'ollama'`). */
  name: string;
  /** Send a chat request and return the response. */
  chat(args: ChatArgs): Promise<ProviderResponse>;
}

/**
 * Known capabilities and cost information for a specific model.
 *
 * Used for timeout management, compaction thresholds, and cost estimation.
 */
export interface ModelCapabilities {
  /** Maximum context window size in tokens. */
  contextWindow: number;
  /** Maximum output tokens the model can generate. */
  maxOutputTokens: number;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** Cost per 1M tokens, or `null` if unknown. */
  costPer1M: { input: number; output: number } | null;
  /** Provider that serves this model. */
  provider: string;
  /** Whether the model can process images in messages. */
  supportsVision: boolean;
  /** Whether the model can call tools/functions. */
  supportsToolCalling: boolean;
  /** Whether the model can stream responses. */
  supportsStreaming: boolean;
  /** Whether the model supports extended thinking / chain-of-thought. */
  supportsThinking: boolean;
  /** Human-readable display name (e.g. "Claude Opus 4.7"). */
  displayName?: string;
  /** How this entry was created: 'auto' (fetched from API) or 'manual' (admin edit). */
  source?: 'auto' | 'manual';
}

/**
 * Cost estimate for a given token usage on a specific model.
 *
 * Returned by `estimateCost()` in the model registry.
 */
export interface CostEstimate {
  /** Input token cost in USD. */
  input: number;
  /** Output token cost in USD. */
  output: number;
  /** Total cost in USD (`input + output`). */
  total: number;
}
