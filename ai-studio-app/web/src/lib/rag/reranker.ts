import { rerankText as providerRerank, type RerankConfig } from "@ais/provider-bridge";
import type { Reranker } from "@ais/rag-engine";

let builtinReranker: { tokenizer: Function; model: Function } | null = null;

async function rerankBuiltin(query: string, documents: string[], topN: number): Promise<Array<{ index: number; score: number }>> {
  if (!builtinReranker) {
    const transformers = await import(/* webpackIgnore: true */ "@huggingface/transformers");
    const AutoTokenizer = transformers.AutoTokenizer as { from_pretrained: Function };
    const AutoModelForSequenceClassification = transformers.AutoModelForSequenceClassification as { from_pretrained: Function };
    const tokenizer = await AutoTokenizer.from_pretrained("Xenova/ms-marco-MiniLM-L-6-v2");
    const model = await AutoModelForSequenceClassification.from_pretrained("Xenova/ms-marco-MiniLM-L-6-v2");
    builtinReranker = { tokenizer: tokenizer as Function, model: model as Function };
  }

  const scores: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < documents.length; i++) {
    const inputs = (builtinReranker.tokenizer as Function)(query, { text_pair: documents[i], padding: true, truncation: true });
    const output = await (builtinReranker.model as Function)(inputs);
    scores.push({ index: i, score: (output.logits?.data?.[0] ?? 0) as number });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topN);
}

export function createReranker(config: RerankConfig): Reranker {
  return {
    async rerank(query: string, documents: string[], topN?: number) {
      if (config.source === "builtin") {
        return rerankBuiltin(query, documents, topN || documents.length);
      }
      return providerRerank(config, query, documents, topN);
    },
  };
}
