import { QdrantClient } from "@qdrant/js-client-rest";

const globalForQdrant = globalThis as typeof globalThis & { __qdrantClient?: QdrantClient };

export function getQdrantClient(): QdrantClient {
  if (!globalForQdrant.__qdrantClient) {
    const url = process.env.QDRANT_URL || "http://localhost:6333";
    const apiKey = process.env.QDRANT_API_KEY || undefined;
    globalForQdrant.__qdrantClient = new QdrantClient({ url, apiKey });
  }
  return globalForQdrant.__qdrantClient;
}

export const CHUNKS_COLLECTION = "knowledge_chunks";
export const ENTITIES_COLLECTION = "graph_entities";
