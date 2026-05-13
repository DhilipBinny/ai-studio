import { searchKnowledge, type SearchResult } from "@ais-app/agent-runtime";

export interface EvalQuestion {
  query: string;
  expectedAnswer: string;
  relevantDocNames?: string[];
}

export interface EvalResult {
  query: string;
  retrievedChunks: number;
  topChunkRelevant: boolean;
  contextPrecision: number;
  sources: Array<{ documentName: string; score: number; source: string }>;
}

export async function evaluateRAG(
  agentId: string,
  tenantId: string,
  questions: EvalQuestion[],
): Promise<{ results: EvalResult[]; summary: { avgPrecision: number; avgChunks: number; topRelevantRate: number } }> {
  const results: EvalResult[] = [];

  for (const q of questions) {
    const searchResults = await searchKnowledge(q.query, agentId, tenantId, { topK: 5 });

    const keywords = q.expectedAnswer
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    let relevantCount = 0;
    for (const chunk of searchResults) {
      const lower = chunk.content.toLowerCase();
      const matchedKeywords = keywords.filter((kw) => lower.includes(kw));
      if (matchedKeywords.length >= Math.min(2, keywords.length)) {
        relevantCount++;
      }
    }

    const topContent = searchResults[0]?.content?.toLowerCase() || "";
    const topRelevant = keywords.filter((kw) => topContent.includes(kw)).length >= Math.min(2, keywords.length);

    results.push({
      query: q.query,
      retrievedChunks: searchResults.length,
      topChunkRelevant: topRelevant,
      contextPrecision: searchResults.length > 0 ? relevantCount / searchResults.length : 0,
      sources: searchResults.map((r) => ({
        documentName: r.documentName,
        score: r.score,
        source: r.source,
      })),
    });
  }

  const avgPrecision = results.length > 0
    ? results.reduce((sum, r) => sum + r.contextPrecision, 0) / results.length
    : 0;
  const avgChunks = results.length > 0
    ? results.reduce((sum, r) => sum + r.retrievedChunks, 0) / results.length
    : 0;
  const topRelevantRate = results.length > 0
    ? results.filter((r) => r.topChunkRelevant).length / results.length
    : 0;

  return {
    results,
    summary: { avgPrecision, avgChunks, topRelevantRate },
  };
}
