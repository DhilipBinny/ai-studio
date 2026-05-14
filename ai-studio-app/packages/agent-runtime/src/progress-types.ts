export type SpanKind = "workflow" | "node" | "agent" | "llm" | "tool" | "approval";
export type SpanPhase = "start" | "progress" | "complete" | "error";

export interface ProgressSpan {
  id: string;
  seq: number;
  traceId: string;
  parentId: string | null;
  tenantId: string;

  spanKind: SpanKind;
  phase: SpanPhase;

  timestamp: number;
  durationMs?: number;

  name: string;
  message?: string;

  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;

  argsPreview?: string;
  argsLen?: number;
  resultPreview?: string;
  resultLen?: number;

  agentId?: string;
  agentName?: string;
  sessionId?: string;
  nodeId?: string;
  modelId?: string;
  toolName?: string;
}

export interface EmitSpanOptions {
  traceId: string;
  parentId?: string | null;
  tenantId: string;
  spanKind: SpanKind;
  phase: SpanPhase;
  name: string;
  message?: string;
  durationMs?: number;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  argsPreview?: string;
  argsLen?: number;
  resultPreview?: string;
  resultLen?: number;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  nodeId?: string;
  modelId?: string;
  toolName?: string;
}

export type ProgressSubscriber = (span: ProgressSpan) => void;

export interface ProgressBusStats {
  activeTraces: number;
  totalSubscribers: number;
  totalSpansEmitted: number;
}
