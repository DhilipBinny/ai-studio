export interface Persona {
  identity?: string;
  instructions?: string;
  tone?: string;
  context?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  persona: Persona;
  rules: Array<{ rule: string; priority?: number }>;
  providerModelId: string | null;
  temperature: string;
  maxTurns: number;
  maxTokensPerTurn: number;
}

export interface ProviderConfig {
  providerType: string;
  apiKeyRef: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
  modelId: string;
  displayName: string;
}

export interface SessionInput {
  agentId: string;
  tenantId: string;
  userId: string;
  message: string;
  sessionId?: string;
  channel?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionResult {
  sessionId: string;
  response: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  status: string;
  error?: string;
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
