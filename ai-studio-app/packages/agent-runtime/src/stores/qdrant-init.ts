import { getQdrantClient, CHUNKS_COLLECTION, ENTITIES_COLLECTION } from "./qdrant-client";

/**
 * Supported embedding dimensions across common providers:
 * - 384:  bge-small, all-MiniLM-L6 (builtin / HuggingFace)
 * - 768:  bge-base, nomic-embed-text (Ollama)
 * - 1024: bge-large, Cohere embed-v3
 * - 1536: text-embedding-ada-002, text-embedding-3-small (OpenAI)
 * - 3072: text-embedding-3-large (OpenAI)
 *
 * We use named vectors so a single collection supports KBs with different
 * embedding providers/dimensions simultaneously.
 */
const VECTOR_DIMENSIONS = [384, 768, 1024, 1536, 3072] as const;

function buildNamedVectors(): Record<string, { size: number; distance: "Cosine" }> {
  const vectors: Record<string, { size: number; distance: "Cosine" }> = {};
  for (const dim of VECTOR_DIMENSIONS) {
    vectors[`dim_${dim}`] = { size: dim, distance: "Cosine" };
  }
  return vectors;
}

async function ensureCollection(
  collectionName: string,
): Promise<void> {
  const qdrant = getQdrantClient();

  const { exists } = await qdrant.collectionExists(collectionName);
  if (exists) return;

  await qdrant.createCollection(collectionName, {
    vectors: buildNamedVectors(),
    hnsw_config: { payload_m: 16, m: 0 },
  });

  // Create payload indexes for tenant isolation and filtering
  await qdrant.createPayloadIndex(collectionName, {
    field_name: "tenant_id",
    field_schema: { type: "keyword", is_tenant: true },
  });

  await qdrant.createPayloadIndex(collectionName, {
    field_name: "knowledge_base_id",
    field_schema: "keyword",
  });

  await qdrant.createPayloadIndex(collectionName, {
    field_name: "document_id",
    field_schema: "keyword",
  });
}

/**
 * Ensure both Qdrant collections exist with the correct schema.
 * Idempotent — safe to call on every startup.
 */
export async function ensureQdrantCollections(): Promise<void> {
  await ensureCollection(CHUNKS_COLLECTION);
  await ensureCollection(ENTITIES_COLLECTION);
}
