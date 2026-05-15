import { contextualChunkText, parentChildChunkText } from "./chunker";
import type { ChunkConfig, Chunk } from "./types";
import type { DocumentStore, TextExtractor, Embedder, KBConfig, ChunkRecord, DocumentInfo } from "./interfaces";
import { enrichChunks, type EnrichmentConfig } from "./contextual-enrichment";
import { extractEntitiesFromChunk, type ExtractionResult } from "./graph-extraction";
import type { LLMCaller } from "./hyde";
import { lateChunkText, type LateChunkEmbedder } from "./late-chunking";

export interface GraphExtractionOutput {
  chunkId: number;
  chunkIndex: number;
  entities: ExtractionResult["entities"];
  relationships: ExtractionResult["relationships"];
}

export interface ProcessDocumentResult {
  chunkCount: number;
  graphExtractions?: GraphExtractionOutput[];
}

export async function processDocument(
  doc: DocumentInfo,
  config: KBConfig,
  store: DocumentStore,
  extractor: TextExtractor,
  embedder: Embedder,
  llmCaller?: LLMCaller,
  lateChunkEmbedder?: LateChunkEmbedder,
  graphLLMCaller?: LLMCaller,
  tenantId?: string,
): Promise<ProcessDocumentResult> {
  await store.updateDocumentStatus(doc.id, "processing", 0);

  try {
    const text = await extractor.extract(doc.storagePath, doc.fileType);
    if (!text.trim()) throw new Error("No text could be extracted from the document");

    const chunkConfig = config.chunkConfig;
    const context = { fileName: doc.fileName };
    const isParentChild = chunkConfig.method === "parent_child";

    await store.deleteChunks(doc.id);

    const effectiveTenantId = tenantId ?? "";
    const effectiveGraphLLM = graphLLMCaller ?? llmCaller;

    const enrichmentMode = config.contextualEnrichment ?? "static";
    const enrichmentConfig: EnrichmentConfig = {
      mode: enrichmentMode,
      model: config.contextualModel ?? undefined,
    };

    // Late chunking path: embed full document first, then segment
    if (chunkConfig.method === "late_chunking") {
      if (!lateChunkEmbedder) {
        throw new Error("Late chunking requires a LateChunkEmbedder (model with per-token embedding support)");
      }

      const context = { fileName: doc.fileName };
      const lateChunks = await lateChunkText(text, chunkConfig, lateChunkEmbedder, context);

      if (lateChunks.length === 0) {
        throw new Error("Document produced no chunks after late chunking");
      }

      const records: ChunkRecord[] = lateChunks.map((c) => ({
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
        embedding: c.embedding, // pre-computed by lateChunkText
        chunkType: "standard" as const,
        tokenCount: c.tokenCount,
        metadata: { fileName: doc.fileName, fileType: doc.fileType, knowledgeBaseId: doc.knowledgeBaseId },
      }));

      const lateChunkIds = await store.insertChunks(effectiveTenantId,records);

      // Graph extraction for late chunking path
      let graphExtractions: GraphExtractionOutput[] | undefined;
      if (config.graphExtraction && effectiveGraphLLM) {
        graphExtractions = await runGraphExtraction(
          lateChunks, lateChunkIds, doc.fileName, effectiveGraphLLM,
        );
      }

      await store.updateDocumentStatus(doc.id, "ready", lateChunks.length);
      await store.updateKBChunkCount(doc.knowledgeBaseId);
      return { chunkCount: lateChunks.length, graphExtractions };
    }

    if (isParentChild) {
      const pcChunks = parentChildChunkText(text, chunkConfig, context);
      const childChunks = pcChunks.filter((c) => c.chunkType === "child");
      const parentChunks = pcChunks.filter((c) => c.chunkType === "parent");

      // Enrich child chunks if enrichment is enabled
      let childTextsForEmbedding: string[];
      let childDescriptions: (string | null)[];

      if (enrichmentMode === "llm") {
        // For LLM enrichment, enrich child chunks
        const enrichResult = await enrichChunks(
          childChunks,
          text,
          doc.fileName,
          undefined,
          enrichmentConfig,
          llmCaller,
        );
        childTextsForEmbedding = enrichResult.enrichedTexts;
        childDescriptions = enrichResult.descriptions;
      } else if (enrichmentMode === "static") {
        // Static enrichment: add [Document: fileName | Section: heading] prefix via enrichChunks
        // parentChildChunkText only adds [Document: fileName], missing the section heading
        const enrichResult = await enrichChunks(
          childChunks,
          text,
          doc.fileName,
          undefined,
          { mode: "static" },
        );
        childTextsForEmbedding = enrichResult.enrichedTexts;
        childDescriptions = enrichResult.descriptions;
      } else {
        // "none" — child chunks use their raw content
        childTextsForEmbedding = childChunks.map((c) => c.content);
        childDescriptions = childChunks.map(() => null);
      }

      const embeddings = await embedder.embed(childTextsForEmbedding, "document");

      const parentRecords: ChunkRecord[] = parentChunks.map((p) => ({
        documentId: doc.id,
        chunkIndex: p.index,
        content: p.content,
        embedding: null,
        chunkType: "parent" as const,
        tokenCount: p.tokenCount,
        metadata: { fileName: doc.fileName, fileType: doc.fileType, knowledgeBaseId: doc.knowledgeBaseId },
      }));

      const parentIds = await store.insertChunks(effectiveTenantId,parentRecords);
      const parentIdMap = new Map(parentChunks.map((p, i) => [p.index, parentIds[i]]));

      const childRecords: ChunkRecord[] = childChunks.map((c, i) => ({
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
        embedding: embeddings[i],
        chunkType: "child" as const,
        parentChunkId: c.parentIndex !== undefined ? parentIdMap.get(c.parentIndex) ?? null : null,
        tokenCount: c.tokenCount,
        metadata: { fileName: doc.fileName, fileType: doc.fileType, knowledgeBaseId: doc.knowledgeBaseId },
        contextualDescription: childDescriptions[i],
      }));

      const childIds = await store.insertChunks(effectiveTenantId,childRecords);

      // Graph extraction for parent-child chunking path (extract from child chunks only)
      let graphExtractions: GraphExtractionOutput[] | undefined;
      if (config.graphExtraction && effectiveGraphLLM) {
        graphExtractions = await runGraphExtraction(
          childChunks, childIds, doc.fileName, effectiveGraphLLM,
        );
      }

      await store.updateDocumentStatus(doc.id, "ready", pcChunks.length);
      await store.updateKBChunkCount(doc.knowledgeBaseId);
      return { chunkCount: pcChunks.length, graphExtractions };
    }

    // For standard/fixed chunking, use "static" prefix from contextualChunkText
    // then optionally enrich further with LLM
    const chunks = contextualChunkText(text, chunkConfig, context);
    if (chunks.length === 0) throw new Error("Document produced no chunks after processing");

    let textsForEmbedding: string[];
    let descriptions: (string | null)[];

    if (enrichmentMode === "llm") {
      // LLM enrichment: generate contextual descriptions and use them for embedding
      const enrichResult = await enrichChunks(
        chunks,
        text,
        doc.fileName,
        undefined,
        enrichmentConfig,
        llmCaller,
      );
      textsForEmbedding = enrichResult.enrichedTexts;
      descriptions = enrichResult.descriptions;
    } else {
      // "none" or "static" — chunks already have the right prefix from contextualChunkText
      textsForEmbedding = chunks.map((c) => c.content);
      descriptions = chunks.map(() => null);
    }

    const embeddings = await embedder.embed(textsForEmbedding, "document");

    const records: ChunkRecord[] = chunks.map((c, i) => ({
      documentId: doc.id,
      chunkIndex: c.index,
      content: c.content,
      embedding: embeddings[i],
      chunkType: "standard" as const,
      tokenCount: c.tokenCount,
      metadata: { fileName: doc.fileName, fileType: doc.fileType, knowledgeBaseId: doc.knowledgeBaseId, chunkSize: chunkConfig.chunk_size || 2048 },
      contextualDescription: descriptions[i],
    }));

    const chunkIds = await store.insertChunks(effectiveTenantId,records);

    // Graph extraction for standard/fixed chunking path
    let graphExtractions: GraphExtractionOutput[] | undefined;
    if (config.graphExtraction && effectiveGraphLLM) {
      graphExtractions = await runGraphExtraction(
        chunks, chunkIds, doc.fileName, effectiveGraphLLM,
      );
    }

    await store.updateDocumentStatus(doc.id, "ready", chunks.length);
    await store.updateKBChunkCount(doc.knowledgeBaseId);
    return { chunkCount: chunks.length, graphExtractions };
  } catch (e) {
    const errorMsg = (e as Error).message || "Unknown processing error";
    await store.updateDocumentStatus(doc.id, "error", 0);
    throw new Error(errorMsg);
  }
}

/**
 * Run graph entity extraction on a set of chunks.
 * For each chunk, calls the LLM to extract entities and relationships.
 * Returns the extraction results paired with their persisted chunk IDs.
 */
async function runGraphExtraction(
  chunks: Array<{ index: number; content: string }>,
  chunkIds: number[],
  documentName: string,
  llmCaller: LLMCaller,
): Promise<GraphExtractionOutput[]> {
  const results: GraphExtractionOutput[] = [];
  const concurrency = 5;

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((chunk) =>
        extractEntitiesFromChunk(chunk.content, documentName, llmCaller),
      ),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const extraction = batchResults[j];
      if (extraction.entities.length > 0 || extraction.relationships.length > 0) {
        results.push({
          chunkId: chunkIds[i + j],
          chunkIndex: batch[j].index,
          entities: extraction.entities,
          relationships: extraction.relationships,
        });
      }
    }
  }

  return results;
}
