export interface Session {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  channel: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
  totalTurns: number;
  totalToolCalls: number;
  modelUsed: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface SessionDetail extends Session {
  agentSlug: string;
  providerUsed: string | null;
  errorMessage: string | null;
  triggerType: string;
  messages: SessionMessage[];
  toolCalls: SessionToolCall[];
}

export interface SessionMessage {
  id: number;
  role: string;
  content: string;
  toolCalls: unknown;
  toolCallId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface SessionToolCall {
  id: number;
  toolName: string;
  arguments: Record<string, unknown>;
  result: string | null;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  requiresApproval: boolean;
  approvalStatus: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}
