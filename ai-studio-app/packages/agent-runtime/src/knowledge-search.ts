import { searchKnowledge as ragSearchKnowledge, type SearchResult, type SearchOptions, type HyDEConfig, type DecompositionOptions } from "@ais/rag-engine";
import { type EmbeddingConfig } from "@ais/provider-bridge";
import { type RerankConfig } from "@ais/provider-bridge";
import { DrizzleSearchStore } from "./stores/drizzle-search-store";
import type { AgentKBInfo } from "@ais/rag-engine";

export type { SearchResult } from "@ais/rag-engine";

type ExtendedKBInfo = AgentKBInfo & {
  providerType?: string | null;
  apiKeyRef?: string | null;
  baseUrl?: string | null;
};

function buildEmbeddingConfig(kb: ExtendedKBInfo): EmbeddingConfig {
  if (kb.embeddingSource === "builtin") {
    return { source: "builtin", model: kb.embeddingModel || "Xenova/bge-small-en-v1.5", dimension: kb.embeddingDimension || 384 };
  }
  return {
    source: "provider", model: kb.embeddingModel, dimension: kb.embeddingDimension,
    providerType: kb.providerType || undefined, apiKey: kb.apiKeyRef || undefined, baseUrl: kb.baseUrl || undefined,
  };
}

export async function searchKnowledge(
  query: string,
  agentId: string,
  tenantId: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const store = new DrizzleSearchStore();
  const kbs = await store.getAgentKBs(agentId, tenantId);
  if (kbs.length === 0) return [];

  const firstKB = kbs[0] as ExtendedKBInfo;
  const embeddingConfig = buildEmbeddingConfig(firstKB);

  const { createEmbedder } = await import("@/lib/rag/embedder");
  const embedder = createEmbedder(embeddingConfig);

  let reranker;
  if (firstKB.rerankSource) {
    const { createReranker } = await import("@/lib/rag/reranker");
    const rerankConfig: RerankConfig = firstKB.rerankSource === "builtin"
      ? { source: "builtin", model: "Xenova/ms-marco-MiniLM-L-6-v2" }
      : { source: "provider", model: firstKB.rerankModel || undefined };
    reranker = createReranker(rerankConfig);
  }

  // Build HyDE config from KB settings
  let hydeConfig: HyDEConfig | undefined;
  let llmCaller;

  const needsLLM = (firstKB.queryExpansion === "hyde" && firstKB.queryExpansionModel) || firstKB.queryDecomposition;

  if (needsLLM) {
    // Create an LLM caller using the KB's configured provider
    const { createLLMCaller } = await import("@/lib/rag/llm-caller");
    const providerType = firstKB.providerType || "openai";
    // Use query expansion model if set; otherwise pick a default chat model per provider
    // (embedding models cannot generate text, so never fall back to embeddingModel)
    const defaultChatModels: Record<string, string> = {
      anthropic: "claude-haiku-4-5-20251001",
      openai: "gpt-4o-mini",
      openai_compatible: "gpt-4o-mini",
      ollama: "llama3.2",
    };
    const model = firstKB.queryExpansionModel || defaultChatModels[providerType] || "gpt-4o-mini";
    llmCaller = createLLMCaller({
      providerType,
      model,
      apiKey: firstKB.apiKeyRef || undefined,
      baseUrl: firstKB.baseUrl || undefined,
    });
  }

  if (firstKB.queryExpansion === "hyde" && firstKB.queryExpansionModel) {
    hydeConfig = { enabled: true, model: firstKB.queryExpansionModel };
  }

  // Build decomposition options from KB settings
  let decompositionOptions: DecompositionOptions | undefined;
  if (firstKB.queryDecomposition && llmCaller) {
    decompositionOptions = { decompositionEnabled: true };
  }

  return ragSearchKnowledge(query, agentId, tenantId, store, embedder, reranker, options, hydeConfig, llmCaller, decompositionOptions);
}
