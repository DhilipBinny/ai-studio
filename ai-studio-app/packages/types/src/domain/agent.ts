export interface Persona {
  identity?: string;
  instructions?: string;
  tone?: string;
  context?: string;
}

export interface AgentRule {
  rule: string;
  priority?: number;
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  persona: Persona;
  rules: AgentRule[];
  status: string;
  version: number;
  tags: string[];
  providerModelId: string | null;
  temperature: string;
  maxTurns: number;
  maxTokensPerTurn: number;
  createdAt: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  slug: string;
}
