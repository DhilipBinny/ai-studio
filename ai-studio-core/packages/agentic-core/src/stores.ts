/**
 * Injectable store interfaces for the agent loop.
 *
 * Enterprise consumers implement these with their own persistence layer
 * (Postgres, DynamoDB, Redis, etc.) instead of importing @ais/core's repositories.
 */

/** Persistence for conversation messages. */
export interface AgentMessageStore {
  create(msg: {
    sessionId: string;
    tenantId: string;
    role: string;
    content: string;
    metadata?: string;
  }): Promise<{ id: number } | null>;

  listBySession(sessionId: string): Promise<Array<{
    role: string;
    content: string;
    tool_calls: string | null;
    tool_call_id: string | null;
  }>>;

  deleteById(id: number): Promise<void>;
}

/** Session usage tracking. */
export interface AgentSessionUpdater {
  addUsage(sessionId: string, inputTokens: number, outputTokens: number): Promise<void>;
  incrementTurns(sessionId: string): Promise<void>;
}

/** Token usage recording for billing/analytics. */
export interface AgentUsageRecorder {
  record(entry: {
    tenantId: string;
    userId?: string;
    sessionId: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }): Promise<void>;
}

/** Tool call audit recording. */
export interface AgentToolCallRecorder {
  record(entry: {
    id: string;
    sessionId: string;
    tenantId: string;
    userId?: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result: unknown;
    status: string;
    durationMs: number;
  }): Promise<void>;
}
