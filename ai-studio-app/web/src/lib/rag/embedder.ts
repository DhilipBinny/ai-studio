import { embedText as providerEmbed, type EmbeddingConfig } from "@ais/provider-bridge";
import type { Embedder } from "@ais/rag-engine";

export type { EmbeddingConfig } from "@ais/provider-bridge";

export interface EmbeddingKBConfig {
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingProviderId: string | null;
  provider: {
    providerType: string;
    apiKeyRef: string | null;
    baseUrl: string | null;
  } | null;
}

export function buildEmbeddingConfig(kb: EmbeddingKBConfig): EmbeddingConfig {
  if (kb.embeddingSource === "builtin") {
    return {
      source: "builtin",
      model: kb.embeddingModel || "Xenova/bge-small-en-v1.5",
      dimension: kb.embeddingDimension || 384,
    };
  }

  if (!kb.provider) {
    throw new Error("Embedding provider not configured for this knowledge base");
  }

  return {
    source: "provider",
    model: kb.embeddingModel,
    dimension: kb.embeddingDimension,
    providerType: kb.provider.providerType,
    apiKey: kb.provider.apiKeyRef || undefined,
    baseUrl: kb.provider.baseUrl || undefined,
  };
}

type BuiltinPipeline = (text: string, options: Record<string, unknown>) => Promise<{ data: Float32Array }>;
let builtinPipeline: BuiltinPipeline | null = null;

async function getBuiltinPipeline(): Promise<BuiltinPipeline> {
  if (!builtinPipeline) {
    const transformers = await import(/* webpackIgnore: true */ "@huggingface/transformers");
    builtinPipeline = await (transformers.pipeline as Function)("feature-extraction", "Xenova/bge-small-en-v1.5", {
      dtype: "q8",
    }) as unknown as BuiltinPipeline;
  }
  return builtinPipeline;
}

async function embedBuiltin(texts: string[]): Promise<number[][]> {
  const pipe = await getBuiltinPipeline();
  const results: number[][] = [];
  for (const text of texts) {
    const output = await pipe(text, { pooling: "mean", normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

export function createEmbedder(config: EmbeddingConfig): Embedder {
  return {
    async embed(texts: string[], inputType?: "query" | "document") {
      if (texts.length === 0) return [];
      if (config.source === "builtin") return embedBuiltin(texts);
      return providerEmbed(config, texts, inputType);
    },
    async embedSingle(text: string, inputType?: "query" | "document") {
      if (config.source === "builtin") {
        const [embedding] = await embedBuiltin([text]);
        return embedding;
      }
      const [embedding] = await providerEmbed(config, [text], inputType);
      return embedding;
    },
  };
}

export async function generateEmbeddings(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  return createEmbedder(config).embed(texts, "document");
}

export async function generateSingleEmbedding(text: string, config: EmbeddingConfig): Promise<number[]> {
  return createEmbedder(config).embedSingle(text, "query");
}
