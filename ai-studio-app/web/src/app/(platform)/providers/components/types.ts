export interface ProviderModel {
  id: string;
  modelId: string;
  displayName: string;
  capabilities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface Provider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyRef: string | null;
  config: Record<string, unknown>;
  status: string;
  modelCount: number;
  models: ProviderModel[];
}

export const PROVIDER_TYPES = [
  { id: "anthropic", name: "Anthropic", description: "Claude Sonnet, Opus, Haiku (chat only, no embeddings)" },
  { id: "openai", name: "OpenAI", description: "GPT-4o, o1, o3 + embedding models" },
  { id: "ollama", name: "Ollama", description: "Local chat + embedding models via Ollama" },
  { id: "openai_compatible", name: "OpenAI Compatible", description: "Voyage AI, Cohere, NVIDIA, Groq, vLLM — chat, embedding, or reranking" },
];
