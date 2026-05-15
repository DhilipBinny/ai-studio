/**
 * Late Chunking — Embed-then-split strategy
 *
 * Instead of splitting a document into chunks and embedding each independently,
 * late chunking embeds the FULL document first (so every token attends to the
 * full context), then segments the per-token embedding output into chunk-level
 * embeddings via mean pooling.
 *
 * Requirements:
 * - Embedding model with long context window (>= 4096 tokens)
 * - Model must support returning per-token embeddings (e.g. Jina v3 API)
 *
 * When a document exceeds the model's context window, it is split into sections
 * first, and each section is late-chunked independently.
 */

import { chunkText } from "./chunker";
import type { ChunkConfig, ChunkContext } from "./types";

export interface LateChunkEmbedder {
  embedWithTokens(text: string): Promise<{
    tokenEmbeddings: number[][];
    tokenBoundaries: number[];
  }>;
}

export interface LateChunkResult {
  index: number;
  content: string;
  tokenCount: number;
  embedding: number[];
}

/**
 * Mean-pool a set of token embeddings into a single vector.
 * Returns empty array if no embeddings are provided.
 */
export function meanPool(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const result = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] += emb[i];
    }
  }
  return result.map((v) => v / embeddings.length);
}

/**
 * Find the token index whose character boundary is closest to (but not past)
 * the given character offset. Uses binary search for efficiency.
 */
function findTokenIndex(tokenBoundaries: number[], charOffset: number): number {
  let lo = 0;
  let hi = tokenBoundaries.length - 1;
  let best = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tokenBoundaries[mid] <= charOffset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

/**
 * Maximum character count we assume fits in a single model context window.
 * Jina v3 supports 8192 tokens; at ~4 chars/token that's roughly 32K chars.
 * We use a conservative estimate.
 */
const DEFAULT_MAX_SECTION_CHARS = 30000;

/**
 * Late-chunk a document:
 * 1. Embed full document with per-token output (full attention)
 * 2. Determine chunk boundaries using standard recursive splitting
 * 3. For each chunk, mean-pool the corresponding token embeddings
 *
 * If the document exceeds the model context window, it is split into sections
 * first and each section is late-chunked independently.
 */
export async function lateChunkText(
  text: string,
  config: ChunkConfig,
  embedder: LateChunkEmbedder,
  context?: ChunkContext,
): Promise<LateChunkResult[]> {
  if (!text || !text.trim()) {
    return [];
  }

  const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // If document is very long, split into sections first and late-chunk each
  const maxSectionChars = DEFAULT_MAX_SECTION_CHARS;
  if (cleaned.length > maxSectionChars) {
    return lateChunkLongDocument(cleaned, config, embedder, context, maxSectionChars);
  }

  return lateChunkSection(cleaned, config, embedder, context, 0);
}

/**
 * Late-chunk a single section of text that fits within the model context window.
 * @param indexOffset - global chunk index offset (for multi-section documents)
 */
async function lateChunkSection(
  text: string,
  config: ChunkConfig,
  embedder: LateChunkEmbedder,
  context: ChunkContext | undefined,
  indexOffset: number,
): Promise<LateChunkResult[]> {
  // Step 1: Get per-token embeddings for the full section
  const { tokenEmbeddings, tokenBoundaries } = await embedder.embedWithTokens(text);

  if (tokenEmbeddings.length === 0 || tokenBoundaries.length === 0) {
    return [];
  }

  // Step 2: Determine chunk boundaries using recursive splitting
  const chunks = chunkText(text, { ...config, method: "recursive" });

  if (chunks.length === 0) {
    return [];
  }

  // Step 3: For each chunk, find token range and mean-pool
  const results: LateChunkResult[] = [];

  for (const chunk of chunks) {
    // Calculate approximate character offsets for this chunk
    const chunkStart = text.indexOf(chunk.content);
    const chunkEnd = chunkStart >= 0 ? chunkStart + chunk.content.length : text.length;
    const effectiveStart = Math.max(chunkStart, 0);

    // Map character offsets to token indices
    const startToken = findTokenIndex(tokenBoundaries, effectiveStart);
    const endToken = Math.min(
      findTokenIndex(tokenBoundaries, chunkEnd) + 1,
      tokenEmbeddings.length,
    );

    // Extract the token embeddings for this chunk's range
    const chunkTokenEmbeddings = tokenEmbeddings.slice(startToken, endToken);

    // Mean-pool to get a single chunk embedding
    const embedding = meanPool(chunkTokenEmbeddings);

    // If mean-pooling produced an empty vector (no tokens in range), skip
    if (embedding.length === 0) {
      continue;
    }

    const content = context
      ? `[Document: ${context.fileName}] ${chunk.content}`
      : chunk.content;

    results.push({
      index: indexOffset + chunk.index,
      content,
      tokenCount: chunk.tokenCount,
      embedding,
    });
  }

  return results;
}

/**
 * Handle documents that exceed the model context window by splitting into
 * large sections, then late-chunking each section independently.
 */
async function lateChunkLongDocument(
  text: string,
  config: ChunkConfig,
  embedder: LateChunkEmbedder,
  context: ChunkContext | undefined,
  maxSectionChars: number,
): Promise<LateChunkResult[]> {
  // Split into sections at paragraph boundaries
  const sectionOverlap = 500;
  const sections: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + maxSectionChars, text.length);

    // Try to break at a paragraph boundary
    if (end < text.length) {
      const breakPoint = text.lastIndexOf("\n\n", end);
      if (breakPoint > pos + maxSectionChars * 0.5) {
        end = breakPoint + 2; // include the newlines
      }
    }

    sections.push(text.slice(pos, end));
    // Advance with overlap to avoid losing context at section boundaries
    pos = Math.max(end - sectionOverlap, pos + 1);

    // Safety: ensure we always advance
    if (pos >= text.length) break;
  }

  // Late-chunk each section and concatenate results
  const allResults: LateChunkResult[] = [];
  let indexOffset = 0;

  for (const section of sections) {
    const sectionResults = await lateChunkSection(
      section,
      config,
      embedder,
      context,
      indexOffset,
    );
    allResults.push(...sectionResults);
    indexOffset += sectionResults.length;
  }

  return allResults;
}
