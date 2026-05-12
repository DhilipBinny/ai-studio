/**
 * Audit, usage tracking, and tool call recording types.
 *
 * These types support the tamper-evident audit log, per-request
 * usage metering, and tool execution history.
 */

/** Actions that generate audit log entries. */
export type AuditAction =
  | 'auth.login'
  | 'auth.failed'
  | 'tool.execute'
  | 'tool.denied'
  | 'config.change'
  | 'mcp.install'
  | 'mcp.tool_change'
  | 'session.create'
  | 'session.delete';

/**
 * A single entry in the tamper-evident audit log.
 *
 * Each entry is hash-chained to the previous one, making
 * retroactive modification detectable.
 */
export interface AuditEntry {
  /** Unique entry identifier (UUID). */
  id: string;
  /** Tenant identifier (reserved for multi-tenant mode). */
  tenantId: string;
  /** User who performed the action. */
  userId: string;
  /** The audited action. */
  action: AuditAction;
  /** Resource the action was performed on (e.g. tool name, config key). */
  resource: string;
  /** Freeform details about the action. */
  details: Record<string, unknown>;
  /** IP address of the request origin. */
  ipAddress: string;
  /** Hash of the previous audit entry (chain link). */
  prevHash: string;
  /** Hash of this entry (computed over all fields + prevHash). */
  entryHash: string;
  /** ISO 8601 timestamp of the event. */
  createdAt: string;
}

/**
 * A usage record for billing and cost tracking.
 *
 * One record is created per LLM request (agent turn).
 */
export interface UsageRecord {
  /** Unique record identifier (UUID). */
  id: string;
  /** Tenant identifier. */
  tenantId: string;
  /** User who initiated the request. */
  userId: string;
  /** Session this request belongs to. */
  sessionId: string;
  /** Model ID used for the request. */
  model: string;
  /** Provider that served the request. */
  provider: string;
  /** Input tokens consumed. */
  inputTokens: number;
  /** Output tokens consumed. */
  outputTokens: number;
  /** Estimated cost in USD. */
  costUsd: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * A record of a single tool invocation.
 *
 * Captures the tool name, arguments, result, and timing for
 * debugging and compliance purposes.
 */
export interface ToolCallRecord {
  /** Unique record identifier (UUID). */
  id: string;
  /** Session in which the tool was called. */
  sessionId: string;
  /** Tenant identifier. */
  tenantId: string;
  /** User who triggered the tool call (via their message). */
  userId: string;
  /** Name of the tool that was executed. */
  toolName: string;
  /** Arguments passed to the tool. */
  arguments: Record<string, unknown>;
  /** Tool result (serialised). */
  result: string | Record<string, unknown>;
  /** Execution status. */
  status: 'success' | 'error' | 'denied' | 'timeout';
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** User or system that approved the tool call (if confirmation was required). */
  approvedBy?: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}
