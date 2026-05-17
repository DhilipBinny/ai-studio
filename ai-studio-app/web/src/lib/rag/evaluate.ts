/**
 * RAG evaluation orchestrator.
 *
 * Bridges the core rag-engine evaluator with the app-layer services
 * (search, embedding, LLM caller) to run RAGAS-style evaluations
 * on a knowledge base.
 */

import { searchKnowledge, type SearchResult } from "@ais-app/agent-runtime";
import { evaluateRAG as coreEvaluateRAG, type EvaluationQuestion, type EvaluationResult, type EvaluationSummary } from "@ais/rag-engine";
import { createEmbedder, buildEmbeddingConfig, type EmbeddingKBConfig } from "./embedder";
import { createLLMCaller, type LLMCallerConfig } from "./llm-caller";

export type { EvaluationQuestion, EvaluationResult, EvaluationSummary };

export interface EvaluateRAGOptions {
  agentId: string;
  tenantId: string;
  questions: EvaluationQuestion[];
  /** LLM configuration for the judge model */
  llmConfig: LLMCallerConfig;
  /** Embedding configuration for answer relevancy scoring */
  embeddingConfig: EmbeddingKBConfig;
  /** Number of results to retrieve per question */
  topK?: number;
}

/**
 * Run a full RAGAS evaluation against a knowledge base via an agent.
 *
 * For each question:
 *   1. Searches the KB to retrieve chunks
 *   2. Generates an answer from the retrieved context
 *   3. Scores the result on 4 RAGAS metrics (context precision, context recall,
 *      faithfulness, answer relevancy)
 *
 * Returns per-question results and an aggregate summary.
 */
export async function evaluateRAG(
  options: EvaluateRAGOptions,
): Promise<{ results: EvaluationResult[]; summary: EvaluationSummary }> {
  const { agentId, tenantId, questions, llmConfig, embeddingConfig, topK = 5 } = options;

  const llmCaller = createLLMCaller(llmConfig);
  const embedder = createEmbedder(buildEmbeddingConfig(embeddingConfig));

  const searchFn = async (query: string): Promise<SearchResult[]> => {
    return searchKnowledge(query, agentId, tenantId, { topK });
  };

  return coreEvaluateRAG(questions, searchFn, llmCaller, embedder);
}
