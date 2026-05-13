import type { ChunkConfig, Chunk } from "./types";

const DEFAULT_CHUNK_SIZE = 2048;
const DEFAULT_CHUNK_OVERLAP = 200;
const MIN_CHUNK_LENGTH = 10;

const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

export function chunkText(text: string, config: ChunkConfig = {}): Chunk[] {
  const chunkSize = config.chunk_size || DEFAULT_CHUNK_SIZE;
  const overlap = config.chunk_overlap || DEFAULT_CHUNK_OVERLAP;
  const method = config.method || "recursive";

  const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const segments = method === "recursive"
    ? recursiveSplit(cleaned, chunkSize, SEPARATORS)
    : fixedSplit(cleaned, chunkSize);

  const chunks = mergeWithOverlap(segments, chunkSize, overlap);

  return chunks
    .filter((c) => c.trim().length > MIN_CHUNK_LENGTH)
    .map((content, index) => ({
      index,
      content: content.trim(),
      tokenCount: estimateTokens(content),
    }));
}

function recursiveSplit(text: string, maxSize: number, separators: string[]): string[] {
  if (text.length <= maxSize) return [text];

  const sep = separators.find((s) => s.length === 0 || text.includes(s));
  if (sep === undefined) return [text];

  const parts = sep === "" ? splitByChar(text, maxSize) : text.split(sep);

  const result: string[] = [];
  for (const part of parts) {
    if (part.length <= maxSize) {
      result.push(part);
    } else {
      const nextSeps = separators.slice(separators.indexOf(sep) + 1);
      result.push(...recursiveSplit(part, maxSize, nextSeps));
    }
  }

  return result;
}

function fixedSplit(text: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

function splitByChar(text: string, maxSize: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxSize) {
    parts.push(text.slice(i, i + maxSize));
  }
  return parts;
}

function mergeWithOverlap(segments: string[], maxSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const segment of segments) {
    if (current.length + segment.length <= maxSize) {
      current += (current ? " " : "") + segment;
    } else {
      if (current) {
        chunks.push(current);
        const overlapText = current.slice(-overlap);
        current = overlapText + " " + segment;
      } else {
        current = segment;
      }
    }
  }

  if (current.trim()) chunks.push(current);
  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
