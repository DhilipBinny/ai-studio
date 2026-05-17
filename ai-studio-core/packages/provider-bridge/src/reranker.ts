export interface RerankConfig {
  source: "builtin" | "provider";
  model?: string;
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface RerankResult {
  index: number;
  score: number;
}

async function rerankProvider(
  config: RerankConfig,
  query: string,
  documents: string[],
  topN?: number,
): Promise<RerankResult[]> {
  if (!config.apiKey) {
    throw new Error("API key required for re-ranking provider");
  }

  const baseUrl = config.baseUrl?.replace(/\/+$/, "") || "";
  const url = `${baseUrl}/v1/rerank`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || "rerank-v3.5",
      query,
      documents,
      top_n: topN || documents.length,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Rerank API error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    results: Array<{ index: number; relevance_score: number }>;
  };

  return data.results.map((r) => ({
    index: r.index,
    score: r.relevance_score,
  }));
}

export async function rerankText(
  config: RerankConfig,
  query: string,
  documents: string[],
  topN?: number,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  if (config.source === "builtin") {
    throw new Error("Built-in re-ranking must be handled by the application layer, not provider-bridge.");
  }

  return rerankProvider(config, query, documents, topN);
}
