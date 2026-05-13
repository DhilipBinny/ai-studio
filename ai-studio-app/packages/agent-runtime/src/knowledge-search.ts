import { getDb } from "@ais-app/database";
import { agentKnowledgeBases, knowledgeBases, providers } from "@ais-app/database";
import { eq, and, sql } from "drizzle-orm";
import { embedSingle as providerEmbedSingle, type EmbeddingConfig } from "@ais/provider-bridge";
import { rrfFuse, type RankedItem } from "@ais/rag-engine";

type BuiltinPipeline = (text: string, options: Record<string, unknown>) => Promise<{ data: Float32Array }>;
let builtinPipeline: BuiltinPipeline | null = null;

async function embedQueryBuiltin(text: string): Promise<number[]> {
  if (!builtinPipeline) {
    const transformers = await import(/* webpackIgnore: true */ "@huggingface/transformers");
    builtinPipeline = await (transformers.pipeline as Function)("feature-extraction", "Xenova/bge-small-en-v1.5", {
      dtype: "q8",
    }) as unknown as BuiltinPipeline;
  }
  const output = await builtinPipeline(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function embedQuery(config: EmbeddingConfig, text: string): Promise<number[]> {
  if (config.source === "builtin") {
    return embedQueryBuiltin(text);
  }
  return providerEmbedSingle(config, text, "query");
}

export interface SearchResult {
  content: string;
  score: number;
  documentName: string;
  knowledgeBaseName: string;
  chunkIndex: number;
  source: "vector" | "bm25" | "hybrid";
}

function buildEmbeddingConfig(kb: {
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  providerType: string | null;
  apiKeyRef: string | null;
  baseUrl: string | null;
}): EmbeddingConfig {
  if (kb.embeddingSource === "builtin") {
    return {
      source: "builtin",
      model: kb.embeddingModel || "Xenova/bge-small-en-v1.5",
      dimension: kb.embeddingDimension || 384,
    };
  }

  return {
    source: "provider",
    model: kb.embeddingModel,
    dimension: kb.embeddingDimension,
    providerType: kb.providerType || undefined,
    apiKey: kb.apiKeyRef || undefined,
    baseUrl: kb.baseUrl || undefined,
  };
}

export async function searchKnowledge(
  query: string,
  agentId: string,
  tenantId: string,
  options: { topK?: number; similarityThreshold?: number } = {},
): Promise<SearchResult[]> {
  const topK = options.topK || 5;
  const threshold = options.similarityThreshold || 0.3;
  const retrieveCount = topK * 4;

  const db = getDb();

  const agentKBs = await db
    .select({
      knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId,
      kbName: knowledgeBases.name,
      embeddingSource: knowledgeBases.embeddingSource,
      embeddingModel: knowledgeBases.embeddingModel,
      embeddingDimension: knowledgeBases.embeddingDimension,
      providerType: providers.providerType,
      apiKeyRef: providers.apiKeyRef,
      baseUrl: providers.baseUrl,
    })
    .from(agentKnowledgeBases)
    .innerJoin(knowledgeBases, eq(agentKnowledgeBases.knowledgeBaseId, knowledgeBases.id))
    .leftJoin(providers, eq(knowledgeBases.embeddingProviderId, providers.id))
    .where(and(
      eq(agentKnowledgeBases.agentId, agentId),
      eq(agentKnowledgeBases.tenantId, tenantId),
      eq(knowledgeBases.isActive, true),
    ));

  if (agentKBs.length === 0) return [];

  const kbIds = agentKBs.map((kb) => kb.knowledgeBaseId);
  const kbNameMap = new Map(agentKBs.map((kb) => [kb.knowledgeBaseId, kb.kbName]));

  const embeddingConfig = buildEmbeddingConfig(agentKBs[0]);
  const queryEmbedding = await embedQuery(embeddingConfig, query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const vectorResultsPromise = db.execute(sql`
    SELECT
      dc.id,
      dc.content,
      dc.chunk_index,
      d.file_name,
      d.knowledge_base_id,
      1 - (dc.embedding <=> ${embeddingStr}::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.tenant_id = ${tenantId}
      AND d.knowledge_base_id IN (${sql.join(kbIds.map((id) => sql`${id}`), sql`, `)})
      AND d.status = 'ready'
      AND dc.embedding IS NOT NULL
      AND 1 - (dc.embedding <=> ${embeddingStr}::vector) > ${threshold}
    ORDER BY dc.embedding <=> ${embeddingStr}::vector
    LIMIT ${retrieveCount}
  `);

  const tsQuery = query
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[^\w]/g, ""))
    .filter(Boolean)
    .join(" | ");

  const bm25ResultsPromise = tsQuery ? db.execute(sql`
    SELECT
      dc.id,
      dc.content,
      dc.chunk_index,
      d.file_name,
      d.knowledge_base_id,
      ts_rank(dc.search_vector, to_tsquery('english', ${tsQuery})) AS bm25_score
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.tenant_id = ${tenantId}
      AND d.knowledge_base_id IN (${sql.join(kbIds.map((id) => sql`${id}`), sql`, `)})
      AND d.status = 'ready'
      AND dc.search_vector IS NOT NULL
      AND dc.search_vector @@ to_tsquery('english', ${tsQuery})
    ORDER BY ts_rank(dc.search_vector, to_tsquery('english', ${tsQuery})) DESC
    LIMIT ${retrieveCount}
  `) : Promise.resolve([]);

  const [vectorRaw, bm25Raw] = await Promise.all([vectorResultsPromise, bm25ResultsPromise]);

  type RawRow = {
    id: number;
    content: string;
    chunk_index: number;
    file_name: string;
    knowledge_base_id: string;
    similarity?: number;
    bm25_score?: number;
  };

  const vectorRows = [...vectorRaw] as RawRow[];
  const bm25Rows = [...bm25Raw] as RawRow[];

  const vectorItems: RankedItem[] = vectorRows.map((r) => ({
    id: r.id,
    content: r.content,
    score: parseFloat(String(r.similarity || 0)),
    source: "vector" as const,
    metadata: { fileName: r.file_name, kbId: r.knowledge_base_id, chunkIndex: r.chunk_index },
  }));

  const bm25Items: RankedItem[] = bm25Rows.map((r) => ({
    id: r.id,
    content: r.content,
    score: parseFloat(String(r.bm25_score || 0)),
    source: "bm25" as const,
    metadata: { fileName: r.file_name, kbId: r.knowledge_base_id, chunkIndex: r.chunk_index },
  }));

  if (vectorItems.length === 0 && bm25Items.length === 0) return [];

  const fused = rrfFuse(vectorItems, bm25Items);

  return fused.slice(0, topK).map((item) => {
    const meta = item.metadata as { fileName: string; kbId: string; chunkIndex: number };
    let source: "vector" | "bm25" | "hybrid" = "hybrid";
    if (item.vectorRank !== null && item.bm25Rank === null) source = "vector";
    if (item.vectorRank === null && item.bm25Rank !== null) source = "bm25";

    return {
      content: item.content,
      score: item.rrfScore,
      documentName: meta.fileName,
      knowledgeBaseName: kbNameMap.get(meta.kbId) || "Unknown",
      chunkIndex: meta.chunkIndex,
      source,
    };
  });
}
