/**
 * Tool system types.
 *
 * Tools are functions the agent can invoke during a conversation turn.
 * Each tool has a JSON Schema definition, an executor, and optional
 * permission controls.
 *
 * Phase 6 introduces a content-block envelope for tool results alongside
 * the legacy string/object shapes. Tools may return any of the three;
 * the registry auto-wraps legacy shapes into the envelope downstream.
 */

import type { Session } from './session.js';

/**
 * JSON Schema object describing a tool's parameters.
 *
 * Uses a subset of JSON Schema sufficient for LLM tool-calling.
 */
export interface JSONSchemaObject {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/** A single property within a JSON Schema object. */
export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, JSONSchemaProperty>;
  items?: JSONSchemaProperty;
}

/**
 * A tool definition exposed to the LLM.
 *
 * The `parameters` field is a JSON Schema object that the LLM uses
 * to generate valid arguments.
 */
export interface ToolDefinition {
  /** Unique tool name (e.g. `read_file`, `exec`, `mcp__github__list_issues`). */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** JSON Schema describing the tool's input parameters. */
  parameters: JSONSchemaObject;
  /**
   * Short 3-10 word hint indexed by the Phase 8 `tool_search` tool.
   * Used for deferred-loading discovery; not shown to the LLM in the
   * main tool definitions.
   */
  searchHint?: string;
  /**
   * If true, this tool is always inlined in the main system prompt even
   * when Phase 8 deferred-loading is enabled. Core tools like read_file,
   * write_file, exec, grep should set this.
   */
  alwaysLoad?: boolean;
  /** MCP server ID if this tool comes from an MCP server. */
  _mcpServer?: string;
  /** Original MCP tool name (without namespace prefix). */
  _mcpToolName?: string;
}

// ═══════════════════════════════════════════════════════════════
// Content blocks (Phase 6 envelope shape)
// ═══════════════════════════════════════════════════════════════

/**
 * A single content block in a tool result envelope.
 *
 * Modelled on Anthropic's `ToolResultBlockParam` content block union.
 * The agent loop can render each block type natively into the LLM
 * conversation without an intermediate string conversion.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        /** 'base64' = inline data, 'url' = remote fetch, 'path' = filesystem path relative to workspace. */
        kind: 'base64' | 'url' | 'path';
        media_type: string;
        /** Base64 data, URL, or path depending on `kind`. */
        data: string;
      };
    }
  | {
      type: 'resource_link';
      uri: string;
      title?: string;
      description?: string;
    }
  | {
      type: 'persisted_reference';
      /**
       * Workspace-relative path to the persisted file (e.g.
       * `scopes/<scopeKey>/tool-results/<sessionId>/<callId>.json`).
       * Server's absolute filesystem layout is never exposed.
       */
      path: string;
      /** First ~1 KB of text content so the LLM sees a preview. */
      preview: string;
      /** Total size of the persisted content in bytes. */
      sizeBytes: number;
    };

/**
 * A tool-result envelope — the Phase 6 return shape for tool executors.
 *
 * Tools that have been migrated return this directly. Legacy tools still
 * return `string` or `Record<string, unknown>` (and the registry wraps
 * those into an envelope on the way out).
 */
export interface ToolResultEnvelope {
  /** Content blocks the LLM will see as the tool's output. */
  content: ContentBlock[];
  /**
   * Optional messages the tool wants to inject into the conversation.
   * Used by specialised tools like `memory_search --pin` that need to
   * add a synthetic user turn to the context.
   */
  newMessages?: Array<{ role: 'user' | 'system'; content: ContentBlock[] }>;
  /** Passthrough for MCP structured content. */
  mcpMeta?: Record<string, unknown>;
  /**
   * True if the persistence layer offloaded the full content to disk and
   * swapped in a `persisted_reference` block. Set by the result-storage
   * layer, not by tool authors.
   */
  persisted?: boolean;
  /**
   * Bytes this result contributed to the session's running result budget
   * (post-persistence). Set by the registry, not by tool authors.
   */
  bytesBudget?: number;
}

/**
 * The result returned by a tool executor.
 *
 * Can be a plain string (legacy), a plain object (legacy — typically
 * `{ error }` for failures or structured data), or a content-block
 * envelope (Phase 6+). The registry auto-wraps legacy shapes into an
 * envelope for downstream consumers.
 */
export type ToolResult = string | Record<string, unknown> | ToolResultEnvelope;

/**
 * Runtime check: does this value look like a content-block envelope?
 *
 * Used by the registry to decide whether to wrap a legacy return value
 * or pass an envelope through unchanged.
 */
export function isToolResultEnvelope(value: unknown): value is ToolResultEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const maybe = value as { content?: unknown };
  if (!Array.isArray(maybe.content)) return false;
  // Every entry must be a block with a known type tag
  for (const block of maybe.content) {
    if (typeof block !== 'object' || block === null) return false;
    const type = (block as { type?: unknown }).type;
    if (
      type !== 'text' &&
      type !== 'image' &&
      type !== 'resource_link' &&
      type !== 'persisted_reference'
    ) return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Phase 6 per-session services (injected via ToolExecutionContext)
// ═══════════════════════════════════════════════════════════════

/**
 * Read-before-edit enforcement tracker.
 *
 * Records every successful `read_file` in a session and rejects
 * `edit_file` / `write_file` on paths that haven't been read yet,
 * or whose on-disk hash has changed since the tracked read.
 *
 * Concrete implementation lives in
 * `packages/core/src/agent/file-state.ts`.
 */
export interface FileStateTracker {
  /** Record a successful read. Hash is computed from `content`. */
  recordRead(absolutePath: string, content: Uint8Array | string): void;
  /**
   * Verify that `absolutePath` was previously read AND the on-disk
   * contents still match the recorded hash. Returns `{ok:true}` with
   * the hash if safe to edit, or `{ok:false, error}` if not.
   */
  requireRead(absolutePath: string): { ok: true; hash: string } | { ok: false; error: string };
  /** Record a successful write/edit. Updates the hash to match new content. */
  recordWrite(absolutePath: string, content: Uint8Array | string): void;
  /** Forget a path — useful when the file is deleted. */
  forget(absolutePath: string): void;
  /** Clear all entries — called at session end. */
  clear(): void;
  /** Number of tracked files. */
  readonly size: number;
}

/**
 * Per-turn tool-result byte budget.
 *
 * Every tool result contributes to this running total; when the cap is
 * exceeded, the registry asks the result-storage layer to persist
 * further results (even if they'd normally fit under a per-tool
 * threshold) and emits a `compaction_pressure` signal so the agent loop
 * can trigger an early hard compaction.
 *
 * Concrete implementation lives in
 * `packages/core/src/tools/result-budget.ts`.
 */
export interface ResultBudget {
  /** Add bytes to the running total. Returns `true` if still under cap. */
  add(bytes: number): boolean;
  /** Current accumulated bytes. */
  current(): number;
  /** Remaining bytes before the cap. */
  remaining(): number;
  /** True if the running total exceeds the cap. */
  isOverBudget(): boolean;
  /** Reset the counter (called at turn boundaries). */
  reset(): void;
}

/**
 * A typed progress event a long-running tool can emit while executing.
 *
 * The agent loop receives these via `ToolExecutionContext.progress` and
 * can stream them to the channel layer (webchat WS, SSE admin endpoint)
 * for live progress display. Phase 6 plumbs the callback; individual
 * tools opt in by calling `context.progress(...)` during execution.
 */
export interface ToolProgress {
  /** Event tag, e.g. `'navigate'`, `'download'`, `'compile'`. */
  type: string;
  /** Optional structured payload. */
  data?: unknown;
  /** Optional 0-1 completion fraction. */
  fraction?: number;
  /** Optional human-readable status line. */
  message?: string;
}

/**
 * Context passed to tool executors.
 *
 * Provides access to the current session and other runtime state the
 * tool may need. Phase 6 adds optional per-session services (signal,
 * progress, fileState, resultBudget); every new field is optional so
 * existing tools compile unchanged and the multi-user fields stay.
 */
export interface ToolExecutionContext {
  /** The active session for this conversation. */
  session?: Session;
  /** Database handle (used by tools that persist state). */
  db?: unknown;
  /** User identity information. */
  user?: {
    id?: string;
    name?: string;
    role?: string;
    elevated?: boolean;
  };
  /** Tenant identifier (reserved for multi-tenant mode). */
  tenant?: string;
  /** Scope key for per-user isolation (e.g. "telegram:12345"). null = unscoped. */
  scopeKey?: string | null;

  // ── Phase 6 additions (all optional) ─────────────────────
  /**
   * Abort signal fired when the parent turn is cancelled or the user
   * interrupts. Tools that do long-running work should respect it.
   */
  signal?: AbortSignal;
  /**
   * Callback to emit a typed progress event back to the channel layer.
   * No-op if the tool never calls it.
   */
  progress?: (event: ToolProgress) => void;
  /** Per-session read-before-edit tracker (see `FileStateTracker`). */
  fileState?: FileStateTracker;
  /** Per-turn tool-result byte budget (see `ResultBudget`). */
  resultBudget?: ResultBudget;
}

/** Permission level for a tool. */
export type ToolPermissionLevel = 'allow' | 'deny' | 'confirm' | 'power_user' | 'no_rule';

/**
 * A permission rule controlling tool access.
 *
 * Tool patterns support glob matching (e.g. `mcp__*`, `exec`).
 */
export interface ToolPermission {
  /** Glob pattern matching tool names. */
  toolPattern: string;
  /** Role this permission applies to. */
  role: string;
  /** The permission level. */
  permission: ToolPermissionLevel;
}
