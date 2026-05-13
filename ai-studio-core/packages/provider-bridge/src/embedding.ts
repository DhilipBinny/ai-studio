import OpenAI from "openai";

export interface EmbeddingConfig {
  source: "builtin" | "provider";
  model: string;
  dimension: number;
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
}

const BATCH_SIZE = 100;

async function embedProvider(
  config: EmbeddingConfig,
  texts: string[],
): Promise<number[][]> {
  if (!config.apiKey && config.providerType !== "ollama") {
    throw new Error(`API key required for ${config.providerType} embedding provider`);
  }

  const client = new OpenAI({
    apiKey: config.apiKey || "ollama",
    baseURL: config.baseUrl ? `${config.baseUrl.replace(/\/+$/, "")}/v1` : undefined,
  });

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await client.embeddings.create({
      model: config.model,
      input: batch,
    });

    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

export async function embedText(
  config: EmbeddingConfig,
  texts: string[],
  inputType?: "query" | "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (config.source === "builtin") {
    throw new Error("Built-in embedding must be handled by the application layer, not provider-bridge. Use the app embedder.");
  }

  if (config.providerType === "anthropic") {
    throw new Error("Anthropic does not support embeddings. Use OpenAI, Ollama, or a compatible provider.");
  }

  return embedProvider(config, texts);
}

export async function embedSingle(
  config: EmbeddingConfig,
  text: string,
  inputType?: "query" | "document",
): Promise<number[]> {
  const [embedding] = await embedText(config, [text], inputType);
  return embedding;
}
