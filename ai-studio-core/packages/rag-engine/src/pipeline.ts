import { contextualChunkText, parentChildChunkText } from "./chunker";
import type { ChunkConfig } from "./types";
import type { DocumentStore, TextExtractor, Embedder, KBConfig, ChunkRecord, DocumentInfo } from "./interfaces";

export async function processDocument(
  doc: DocumentInfo,
  config: KBConfig,
  store: DocumentStore,
  extractor: TextExtractor,
  embedder: Embedder,
): Promise<{ chunkCount: number }> {
  await store.updateDocumentStatus(doc.id, "processing", 0);

  try {
    const text = await extractor.extract(doc.storagePath, doc.fileType);
    if (!text.trim()) throw new Error("No text could be extracted from the document");

    const chunkConfig = config.chunkConfig;
    const context = { fileName: doc.fileName };
    const isParentChild = chunkConfig.method === "parent_child";

    await store.deleteChunks(doc.id);

    if (isParentChild) {
      const pcChunks = parentChildChunkText(text, chunkConfig, context);
      const childChunks = pcChunks.filter((c) => c.chunkType === "child");
      const parentChunks = pcChunks.filter((c) => c.chunkType === "parent");

      const childTexts = childChunks.map((c) => c.content);
      const embeddings = await embedder.embed(childTexts, "document");

      const parentRecords: ChunkRecord[] = parentChunks.map((p) => ({
        documentId: doc.id,
        chunkIndex: p.index,
        content: p.content,
        embedding: null,
        chunkType: "parent" as const,
        tokenCount: p.tokenCount,
        metadata: { fileName: doc.fileName, fileType: doc.fileType },
      }));

      const parentIds = await store.insertChunks("", parentRecords);
      const parentIdMap = new Map(parentChunks.map((p, i) => [p.index, parentIds[i]]));

      const childRecords: ChunkRecord[] = childChunks.map((c, i) => ({
        documentId: doc.id,
        chunkIndex: c.index,
        content: c.content,
        embedding: embeddings[i],
        chunkType: "child" as const,
        parentChunkId: c.parentIndex !== undefined ? parentIdMap.get(c.parentIndex) ?? null : null,
        tokenCount: c.tokenCount,
        metadata: { fileName: doc.fileName, fileType: doc.fileType },
      }));

      await store.insertChunks("", childRecords);
      await store.updateDocumentStatus(doc.id, "ready", pcChunks.length);
      await store.updateKBChunkCount(doc.knowledgeBaseId);
      return { chunkCount: pcChunks.length };
    }

    const chunks = contextualChunkText(text, chunkConfig, context);
    if (chunks.length === 0) throw new Error("Document produced no chunks after processing");

    const chunkTexts = chunks.map((c) => c.content);
    const embeddings = await embedder.embed(chunkTexts, "document");

    const records: ChunkRecord[] = chunks.map((c, i) => ({
      documentId: doc.id,
      chunkIndex: c.index,
      content: c.content,
      embedding: embeddings[i],
      chunkType: "standard" as const,
      tokenCount: c.tokenCount,
      metadata: { fileName: doc.fileName, fileType: doc.fileType, chunkSize: chunkConfig.chunk_size || 2048 },
    }));

    await store.insertChunks("", records);
    await store.updateDocumentStatus(doc.id, "ready", chunks.length);
    await store.updateKBChunkCount(doc.knowledgeBaseId);
    return { chunkCount: chunks.length };
  } catch (e) {
    const errorMsg = (e as Error).message || "Unknown processing error";
    await store.updateDocumentStatus(doc.id, "error", 0);
    throw new Error(errorMsg);
  }
}
