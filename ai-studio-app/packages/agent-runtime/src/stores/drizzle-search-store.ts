import { getDb } from "@ais-app/database";
import { agentKnowledgeBases, knowledgeBases, documentChunks, providers } from "@ais-app/database";
import { eq, and, sql, inArray } from "drizzle-orm";
import { decryptSecret, isEncrypted } from "@ais-app/auth";
import type { SearchStore, SearchHit, AgentKBInfo } from "@ais/rag-engine";

export class DrizzleSearchStore implements SearchStore {
  async getAgentKBs(agentId: string, tenantId: string): Promise<AgentKBInfo[]> {
    const db = getDb();
    const rows = await db
      .select({
        knowledgeBaseId: agentKnowledgeBases.knowledgeBaseId,
        kbName: knowledgeBases.name,
        embeddingSource: knowledgeBases.embeddingSource,
        embeddingModel: knowledgeBases.embeddingModel,
        embeddingDimension: knowledgeBases.embeddingDimension,
        rerankSource: knowledgeBases.rerankSource,
        rerankModel: knowledgeBases.rerankModel,
        rerankProviderId: knowledgeBases.rerankProviderId,
        queryExpansion: knowledgeBases.queryExpansion,
        queryExpansionModel: knowledgeBases.queryExpansionModel,
        queryDecomposition: knowledgeBases.queryDecomposition,
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

    return rows.map((r) => ({
      knowledgeBaseId: r.knowledgeBaseId,
      kbName: r.kbName,
      embeddingSource: r.embeddingSource,
      embeddingModel: r.embeddingModel,
      embeddingDimension: r.embeddingDimension,
      rerankSource: r.rerankSource,
      rerankModel: r.rerankModel,
      providerType: r.providerType,
      apiKeyRef: r.apiKeyRef && isEncrypted(r.apiKeyRef) ? decryptSecret(r.apiKeyRef) : r.apiKeyRef,
      baseUrl: r.baseUrl,
      rerankProviderId: r.rerankProviderId,
      queryExpansion: r.queryExpansion,
      queryExpansionModel: r.queryExpansionModel,
      queryDecomposition: r.queryDecomposition,
    }));
  }

  async vectorSearch(
    embedding: number[],
    tenantId: string,
    kbIds: string[],
    limit: number,
    threshold: number,
  ): Promise<SearchHit[]> {
    const db = getDb();
    const embeddingStr = `[${embedding.join(",")}]`;
    const kbIdsSql = sql.join(kbIds.map((id) => sql`${id}`), sql`, `);

    const results = await db.execute(sql`
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
      LIMIT ${limit}
    `);

    return ([...results] as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as number,
      content: r.content as string,
      chunkIndex: r.chunk_index as number,
      chunkType: r.chunk_type as string,
      parentChunkId: r.parent_chunk_id as number | null,
      fileName: r.file_name as string,
      knowledgeBaseId: r.knowledge_base_id as string,
      score: parseFloat(String(r.similarity || 0)),
    }));
  }

  async bm25Search(
    query: string,
    tenantId: string,
    kbIds: string[],
    limit: number,
  ): Promise<SearchHit[]> {
    const tsQuery = query
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => w.replace(/[^\w]/g, ""))
      .filter(Boolean)
      .join(" | ");

    if (!tsQuery) return [];

    const db = getDb();
    const kbIdsSql = sql.join(kbIds.map((id) => sql`${id}`), sql`, `);

    const results = await db.execute(sql`
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
      LIMIT ${limit}
    `);

    return ([...results] as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as number,
      content: r.content as string,
      chunkIndex: r.chunk_index as number,
      chunkType: r.chunk_type as string,
      parentChunkId: r.parent_chunk_id as number | null,
      fileName: r.file_name as string,
      knowledgeBaseId: r.knowledge_base_id as string,
      score: parseFloat(String(r.bm25_score || 0)),
    }));
  }

  async getParentChunks(ids: number[], tenantId: string): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const db = getDb();
    const parents = await db
      .select({ id: documentChunks.id, content: documentChunks.content })
      .from(documentChunks)
      .where(and(inArray(documentChunks.id, ids), eq(documentChunks.tenantId, tenantId)));
    return new Map(parents.map((p) => [p.id, p.content]));
  }
}
