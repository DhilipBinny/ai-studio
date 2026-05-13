export interface ChunkConfig {
  method?: "recursive" | "fixed" | "parent_child";
  chunk_size?: number;
  chunk_overlap?: number;
  parent_chunk_size?: number;
  child_chunk_size?: number;
}

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

export interface ChunkContext {
  fileName: string;
  sectionHeading?: string;
}

export interface ParentChildChunk extends Chunk {
  chunkType: "parent" | "child";
  parentIndex?: number;
}

export interface RankedItem {
  id: string | number;
  content: string;
  score: number;
  source: "vector" | "bm25" | "hybrid";
  metadata?: Record<string, unknown>;
}

export interface RRFResult {
  id: string | number;
  content: string;
  rrfScore: number;
  vectorRank: number | null;
  bm25Rank: number | null;
  metadata?: Record<string, unknown>;
}
