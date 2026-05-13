import { getDb } from "@ais-app/database";
import { agentKnowledgeBases, knowledgeBases, documentChunks, providers } from "@ais-app/database";
import { eq, and, sql, inArray } from "drizzle-orm";
import { embedSingle as providerEmbedSingle, type EmbeddingConfig } from "@ais/provider-bridge";
import { rerankText as providerRerank, type RerankConfig } from "@ais/provider-bridge";
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
    return { source: "builtin", model: kb.embeddingModel || "Xenova/bge-small-en-v1.5", dimension: kb.embeddingDimension || 384 };
  }
  return {
    source: "provider", model: kb.embeddingModel, dimension: kb.embeddingDimension,
    providerType: kb.providerType || undefined, apiKey: kb.apiKeyRef || undefined, baseUrl: kb.baseUrl || undefined,
  };
}

function buildRerankConfig(kb: {
  rerankSource: string | null;
  rerankModel: string | null;
  rerankProviderType: string | null;
  rerankApiKey: string | null;
  rerankBaseUrl: string | null;
}): RerankConfig | null {
  if (!kb.rerankSource) return null;
  if (kb.rerankSource === "builtin") {
    return { source: "builtin", model: "Xenova/ms-marco-MiniLM-L-6-v2" };
  }
  return {
    source: "provider", model: kb.rerankModel || undefined,
    providerType: kb.rerankProviderType || undefined, apiKey: kb.rerankApiKey || undefined, baseUrl: kb.rerankBaseUrl || undefined,
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

  const rerankProviders = db.$with("rerank_providers").as(
    db.select({ id: providers.id, providerType: providers.providerType, apiKeyRef: providers.apiKeyRef, baseUrl: providers.baseUrl }).from(providers)
  );

  const agentKBs = await db
    .select({
      knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId,
      kbName: knowledgeBases.name,
      embeddingSource: knowledgeBases.embeddingSource,
      embeddingModel: knowledgeBases.embeddingModel,
      embeddingDimension: knowledgeBases.embeddingDimension,
      rerankSource: knowledgeBases.rerankSource,
      rerankModel: knowledgeBases.rerankModel,
      rerankProviderId: knowledgeBases.rerankProviderId,
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

  const kbIdsSql = sql.join(kbIds.map((id) => sql`${id}`), sql`, `);

  const vectorResultsPromise = db.execute(sql`
    SELECT dc.id, dc.content, dc.chunk_index, dc.chunk_type, dc.parent_chunk_id,
           d.file_name, d.knowledge_base_id,
           1 - (dc.embedding <=> ${embeddingStr}::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.tenant_id = ${tenantId}
      AND d.knowledge_base_id IN (${kbIdsSql})
      AND d.status = 'ready'
      AND dc.embedding IS NOT NULL
      AND dc.chunk_type != 'parent'
      AND 1 - (dc.embedding <=> ${embeddingStr}::vector) > ${threshold}
    ORDER BY dc.embedding <=> ${embeddingStr}::vector
    LIMIT ${retrieveCount}
  `);

  const tsQuery = query.split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[^\w]/g, "")).filter(Boolean).join(" | ");

  const bm25ResultsPromise = tsQuery ? db.execute(sql`
    SELECT dc.id, dc.content, dc.chunk_index, dc.chunk_type, dc.parent_chunk_id,
           d.file_name, d.knowledge_base_id,
           ts_rank(dc.search_vector, to_tsquery('english', ${tsQuery})) AS bm25_score
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE dc.tenant_id = ${tenantId}
      AND d.knowledge_base_id IN (${kbIdsSql})
      AND d.status = 'ready'
      AND dc.search_vector IS NOT NULL
      AND dc.chunk_type != 'parent'
      AND dc.search_vector @@ to_tsquery('english', ${tsQuery})
    ORDER BY ts_rank(dc.search_vector, to_tsquery('english', ${tsQuery})) DESC
    LIMIT ${retrieveCount}
  `) : Promise.resolve([]);

  const [vectorRaw, bm25Raw] = await Promise.all([vectorResultsPromise, bm25ResultsPromise]);

  type RawRow = {
    id: number; content: string; chunk_index: number; chunk_type: string;
    parent_chunk_id: number | null; file_name: string; knowledge_base_id: string;
    similarity?: number; bm25_score?: number;
  };

  const vectorRows = [...vectorRaw] as RawRow[];
  const bm25Rows = [...bm25Raw] as RawRow[];

  const toRankedItem = (r: RawRow, source: "vector" | "bm25", scoreField: "similarity" | "bm25_score"): RankedItem => ({
    id: r.id,
    content: r.content,
    score: parseFloat(String(r[scoreField] || 0)),
    source,
    metadata: { fileName: r.file_name, kbId: r.knowledge_base_id, chunkIndex: r.chunk_index, chunkType: r.chunk_type, parentChunkId: r.parent_chunk_id },
  });

  const vectorItems = vectorRows.map((r) => toRankedItem(r, "vector", "similarity"));
  const bm25Items = bm25Rows.map((r) => toRankedItem(r, "bm25", "bm25_score"));

  if (vectorItems.length === 0 && bm25Items.length === 0) return [];

  let candidates = rrfFuse(vectorItems, bm25Items);

  // Re-ranking (if configured)
  const firstKB = agentKBs[0];
  let rerankConfig: RerankConfig | null = null;
  if (firstKB.rerankSource) {
    if (firstKB.rerankSource === "builtin") {
      rerankConfig = { source: "builtin", model: "Xenova/ms-marco-MiniLM-L-6-v2" };
    } else if (firstKB.rerankProviderId) {
      const [rerankProv] = await db.select({ providerType: providers.providerType, apiKeyRef: providers.apiKeyRef, baseUrl: providers.baseUrl })
        .from(providers).where(eq(providers.id, firstKB.rerankProviderId)).limit(1);
      if (rerankProv) {
        rerankConfig = {
          source: "provider", model: firstKB.rerankModel || undefined,
          providerType: rerankProv.providerType, apiKey: rerankProv.apiKeyRef || undefined, baseUrl: rerankProv.baseUrl || undefined,
        };
      }
    }
  }

  if (rerankConfig) {
    const rerankCandidates = candidates.slice(0, topK * 3);
    const docs = rerankCandidates.map((c) => c.content);

    let rerankResults: Array<{ index: number; score: number }>;
    if (rerankConfig.source === "builtin") {
      rerankResults = await rerankBuiltin(query, docs, topK);
    } else {
      rerankResults = await providerRerank(rerankConfig, query, docs, topK);
    }

    candidates = rerankResults.map((rr) => ({
      ...rerankCandidates[rr.index],
      rrfScore: rr.score,
    }));
  }

  // Parent-child: if a child chunk matched, return the parent's content instead
  const finalCandidates = candidates.slice(0, topK);
  const parentIds = finalCandidates
    .map((c) => (c.metadata as Record<string, unknown>)?.parentChunkId as number | null)
    .filter((id): id is number => id !== null);

  let parentContentMap = new Map<number, string>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: documentChunks.id, content: documentChunks.content })
      .from(documentChunks)
      .where(inArray(documentChunks.id, parentIds));
    parentContentMap = new Map(parents.map((p) => [p.id, p.content]));
  }

  return finalCandidates.map((item) => {
    const meta = item.metadata as { fileName: string; kbId: string; chunkIndex: number; chunkType: string; parentChunkId: number | null };
    let source: "vector" | "bm25" | "hybrid" = "hybrid";
    if (item.vectorRank !== null && item.bm25Rank === null) source = "vector";
    if (item.vectorRank === null && item.bm25Rank !== null) source = "bm25";

    const content = meta.parentChunkId && parentContentMap.has(meta.parentChunkId)
      ? parentContentMap.get(meta.parentChunkId)!
      : item.content;

    return {
      content,
      score: item.rrfScore,
      documentName: meta.fileName,
      knowledgeBaseName: kbNameMap.get(meta.kbId) || "Unknown",
      chunkIndex: meta.chunkIndex,
      source,
    };
  });
}
