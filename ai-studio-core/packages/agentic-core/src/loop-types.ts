/**
 * Agent loop types — exported so that external consumers (e.g. the
 * enterprise product) can build their own agent loop without importing
 * from the monolith `@ais/core`.
 *
 * These mirror the canonical interfaces in `packages/core/src/agent/loop.ts`.
 * When the core loop changes, these should be updated to match.
 */

import type {
  AgentCallbacks,
  ChatArgs,
  DatabaseAdapter,
  GatewayConfig,
  ProviderResponse,
  ToolDefinition,
} from '@ais/types';

// ─── SessionRow (minimal) ────────────────────────────────────
// The full SessionRow lives in `@ais/core`'s DB layer. The agent loop
// only needs `id` and `turns`, but we expose the full shape so
// consumers can pass their own session objects without casting.

/**
 * Minimal session shape required by the agent loop context.
 *
 * Consumers that use a different persistence layer can satisfy this
 * interface without pulling in `@ais/core`'s `SessionRepository`.
 */
export interface AgentSessionRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  channel: string;
  chat_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  turns: number;
  metadata: string; // JSON
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

// ─── AgentContext ────────────────────────────────────────────

/**
 * Everything the agent loop needs to execute a turn.
 *
 * Product-specific features (sub-agent registry, media store, etc.)
 * stay in `@ais/core` and are injected separately; this interface
 * covers the portable, provider-agnostic surface.
 */
export interface AgentContext {
  db: DatabaseAdapter;
  config: GatewayConfig;
  session: AgentSessionRow;
  tenantId: string;
  userId?: string;
  /** User info for permission checks (role + elevated toggle). */
  user?: { id: string; role: string; elevated: boolean };
  /** Generic LLM call function — decoupled from specific providers. */
  callLLM: (args: ChatArgs) => Promise<ProviderResponse>;
  /** Tool definitions available for this turn. */
  tools?: ToolDefinition[];
  /**
   * Optional callback to re-fetch the session's current tool surface.
   * When deferred tool loading is enabled, `tool_search` can add more
   * tools to the session's loaded set mid-turn; the agent loop calls
   * this at the start of each LLM round so newly loaded tools are
   * visible on the next provider call.
   *
   * When omitted (deferred loading disabled or ephemeral sub-agent),
   * the loop uses the initial `tools` list for all rounds.
   */
  refreshTools?: () => Promise<ToolDefinition[]>;
  /** Tool executor function. */
  executeTool?: (
    name: string,
    args: Record<string, unknown>,
    ctx: { session: AgentSessionRow },
  ) => Promise<unknown>;
  /** Check if a tool is safe to run concurrently with other tools. */
  isToolConcurrencySafe?: (name: string) => boolean;
  /** Check if a provider prefix (e.g. "anthropic") is configured and available. */
  isProviderAvailable?: (providerPrefix: string) => boolean;
  /** Model ID override (defaults to config.model.primary). */
  model?: string;
  /** Sub-agent nesting depth (0 = top-level). */
  subagentDepth?: number;
  /** Scope key for per-user memory isolation (e.g., "telegram:8606526093"). */
  scopeKey?: string | null;
  /** Ephemeral mode — skip all DB persistence (for sub-agents). */
  ephemeral?: boolean;
}

// ─── AgentRoundCallbacks ────────────────────────────────────

/** Observability callbacks fired around each round. */
export interface AgentRoundCallbacks extends AgentCallbacks {
  onRoundStart?: (round: number, maxRounds: number) => void;
  onRoundEnd?: (round: number, maxRounds: number) => void;
}
