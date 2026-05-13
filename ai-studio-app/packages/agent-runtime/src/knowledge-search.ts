import { searchKnowledge as ragSearchKnowledge, type SearchResult, type SearchOptions } from "@ais/rag-engine";
import { type EmbeddingConfig } from "@ais/provider-bridge";
import { type RerankConfig } from "@ais/provider-bridge";
import { DrizzleSearchStore } from "./stores/drizzle-search-store";
import type { AgentKBInfo } from "@ais/rag-engine";

export type { SearchResult } from "@ais/rag-engine";

function buildEmbeddingConfig(kb: AgentKBInfo & { providerType?: string | null; apiKeyRef?: string | null; baseUrl?: string | null }): EmbeddingConfig {
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

  const firstKB = kbs[0] as AgentKBInfo & { providerType?: string | null; apiKeyRef?: string | null; baseUrl?: string | null };
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

  return ragSearchKnowledge(query, agentId, tenantId, store, embedder, reranker, options);
}
