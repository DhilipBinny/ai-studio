export interface AuditLogger {
  log(opts: {
    tenantId: string;
    userId?: string;
    action: string;
    resource?: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

export interface ToolCallRecorder {
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
