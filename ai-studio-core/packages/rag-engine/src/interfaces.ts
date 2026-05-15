import type { ChunkConfig } from "./types";

export interface ChunkRecord {
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[] | null;
  chunkType: "standard" | "child" | "parent";
  parentChunkId?: number | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
  contextualDescription?: string | null;
}

export interface KBConfig {
  chunkConfig: ChunkConfig;
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  rerankSource: string | null;
  rerankModel: string | null;
  contextualEnrichment?: "none" | "static" | "llm";
  contextualModel?: string | null;
  queryExpansion?: "none" | "hyde";
  queryExpansionModel?: string | null;
  queryDecomposition?: boolean;
  graphExtraction?: boolean;
  graphExtractionModel?: string | null;
  modalityType?: "text" | "multimodal";
}

export interface SearchHit {
  id: number;
  content: string;
  chunkIndex: number;
  chunkType: string;
  parentChunkId: number | null;
  fileName: string;
  knowledgeBaseId: string;
  score: number;
}

export interface AgentKBInfo {
  knowledgeBaseId: string;
  kbName: string;
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  rerankSource: string | null;
  rerankModel: string | null;
  queryExpansion?: string | null;
  queryExpansionModel?: string | null;
  queryDecomposition?: boolean;
}

export interface DocumentStore {
  deleteChunks(documentId: string): Promise<void>;
  insertChunks(tenantId: string, chunks: ChunkRecord[]): Promise<number[]>;
  updateDocumentStatus(documentId: string, status: string, chunkCount: number): Promise<void>;
  updateKBChunkCount(knowledgeBaseId: string): Promise<void>;
}

export interface SearchStore {
  getAgentKBs(agentId: string, tenantId: string): Promise<AgentKBInfo[]>;
  vectorSearch(embedding: number[], tenantId: string, kbIds: string[], limit: number, threshold: number): Promise<SearchHit[]>;
  bm25Search(query: string, tenantId: string, kbIds: string[], limit: number): Promise<SearchHit[]>;
  getParentChunks(ids: number[], tenantId: string): Promise<Map<number, string>>;
}

export interface TextExtractor {
  extract(storagePath: string, fileType: string): Promise<string>;
}

export interface Embedder {
  embed(texts: string[], inputType?: "query" | "document"): Promise<number[][]>;
  embedSingle(text: string, inputType?: "query" | "document"): Promise<number[]>;
}

export interface Reranker {
  rerank(query: string, documents: string[], topN?: number): Promise<Array<{ index: number; score: number }>>;
}

export interface SearchOptions {
  topK?: number;
  similarityThreshold?: number;
}

export interface SearchResult {
  content: string;
  score: number;
  documentName: string;
  knowledgeBaseName: string;
  chunkIndex: number;
  chunkId?: number;
  source: "vector" | "bm25" | "hybrid";
}

export interface DocumentInfo {
  id: string;
  fileName: string;
  fileType: string;
  storagePath: string;
  knowledgeBaseId: string;
}
