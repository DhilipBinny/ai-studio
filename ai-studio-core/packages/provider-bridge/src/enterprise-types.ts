/**
 * Types for @kairo/enterprise — mirrors KairoClaw's provider interface
 * so the enterprise package can be used standalone without importing KairoClaw types.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessageContentPart[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  thinking_blocks?: ThinkingBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface StructuredSystemPrompt {
  cached: string;
  dynamic: string;
}

/** Extended thinking configuration. */
export interface ThinkingConfig {
  enabled: boolean;
  mode: 'enabled' | 'adaptive';
  budgetTokens?: number;
}

export interface ProviderResponse {
  text: string | null;
  toolCalls: ToolCall[] | null;
  usage: TokenUsage;
  thinkingText?: string | null;
  thinkingBlocks?: ThinkingBlock[];
}

export interface ChatArgs {
  messages: Message[];
  tools?: ToolDefinition[];
  model: string;
  systemPrompt: string | StructuredSystemPrompt;
  onDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  /** Extended thinking configuration. */
  thinkingConfig?: ThinkingConfig;
  signal?: AbortSignal;
  /**
   * Tool executor function — called by SDK provider to execute KairoClaw tools.
   * Only used in SDK/CLI mode. In OAuth mode, tool calls are returned to the
   * agent loop which handles execution.
   */
  _executeTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Maximum tool rounds — passed from KairoClaw's config. SDK mode uses this for maxTurns. */
  _maxToolRounds?: number;
}

export interface EnterpriseProvider {
  name: string;
  chat(args: ChatArgs): Promise<ProviderResponse>;
}

/** Configuration passed when initializing the enterprise module. */
export interface EnterpriseConfig {
  /** OAuth auth token (for OAuth mode, optional for SDK mode). */
  authToken?: string;
  /** Mode: 'oauth' (direct API with subscription auth) or 'sdk' (Claude CLI proxy). */
  mode: 'oauth' | 'sdk';
  /** Default model short name: sonnet, opus, haiku. */
  defaultModel?: string;
}

/** Result from a connection test. */
export interface TestResult {
  success: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
  note?: string;
}
