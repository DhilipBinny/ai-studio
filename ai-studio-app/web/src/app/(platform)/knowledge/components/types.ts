export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  chunkConfig: { method?: string; chunk_size?: number; chunk_overlap?: number };
  documentCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface EmbeddingProvider {
  id: string;
  name: string;
  providerType: string;
  models: Array<{ modelId: string; displayName: string }>;
}

export interface Document {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  status: "uploaded" | "processing" | "ready" | "error";
  chunkCount: number;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
}
