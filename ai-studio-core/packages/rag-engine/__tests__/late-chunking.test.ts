import { describe, it, expect } from "vitest";
import { lateChunkText, meanPool } from "../src/late-chunking";
import type { LateChunkEmbedder } from "../src/late-chunking";
import type { ChunkConfig, ChunkContext } from "../src/types";

// ── Helpers ──

/**
 * Creates a mock LateChunkEmbedder that produces predictable per-token embeddings.
 * Each token gets a 3-dimensional embedding based on its index.
 */
function mockEmbedder(): LateChunkEmbedder {
  return {
    embedWithTokens: async (text: string) => {
      // Simulate one "token" per word (split by spaces)
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        return { tokenEmbeddings: [], tokenBoundaries: [] };
      }

      const tokenEmbeddings: number[][] = [];
      const tokenBoundaries: number[] = [];
      let offset = 0;

      for (let i = 0; i < words.length; i++) {
        const wordStart = text.indexOf(words[i], offset);
        tokenBoundaries.push(wordStart);
        // Predictable embedding: [i+1, (i+1)*0.1, (i+1)*0.01]
        tokenEmbeddings.push([i + 1, (i + 1) * 0.1, (i + 1) * 0.01]);
        offset = wordStart + words[i].length;
      }

      return { tokenEmbeddings, tokenBoundaries };
    },
  };
}

const DEFAULT_CONFIG: ChunkConfig = {
  method: "recursive",
  chunk_size: 200,
  chunk_overlap: 20,
};

// ── Tests: meanPool() ──

describe("meanPool()", () => {
  describe("happy path", () => {
    it("should compute the average of two embeddings", () => {
      const embeddings = [
        [2, 4, 6],
        [4, 8, 10],
      ];

      const result = meanPool(embeddings);

      expect(result).toEqual([3, 6, 8]);
    });
  });

  describe("edge cases", () => {
    it("should return the same embedding when given a single embedding", () => {
      const embeddings = [[1.5, 2.5, 3.5]];

      const result = meanPool(embeddings);

      expect(result).toEqual([1.5, 2.5, 3.5]);
    });

    it("should return empty array when given empty input", () => {
      const result = meanPool([]);

      expect(result).toEqual([]);
    });

    it("should handle empty inner arrays gracefully by returning zeroes", () => {
      // When inner arrays are empty (0-dimensional embeddings), meanPool
      // should return an empty array since dim = 0
      const embeddings: number[][] = [[], []];

      const result = meanPool(embeddings);

      expect(result).toEqual([]);
    });
  });
});

// ── Tests: lateChunkText() ──

describe("lateChunkText()", () => {
  describe("happy path", () => {
    it("should produce chunks with pre-computed embeddings for multi-paragraph text", async () => {
      const text = "First paragraph about middleware and routing in Next.js.\n\nSecond paragraph about database connections and Drizzle ORM configuration.";
      const embedder = mockEmbedder();

      const result = await lateChunkText(text, DEFAULT_CONFIG, embedder);

      expect(result.length).toBeGreaterThan(0);
      for (const chunk of result) {
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.embedding.length).toBeGreaterThan(0);
        expect(chunk.tokenCount).toBeGreaterThan(0);
        expect(typeof chunk.index).toBe("number");
      }
    });

    it("should produce non-empty embedding arrays for each chunk", async () => {
      const text = "Authentication uses JWT tokens with Argon2id hashing for secure password storage.";
      const embedder = mockEmbedder();

      const result = await lateChunkText(text, DEFAULT_CONFIG, embedder);

      expect(result.length).toBeGreaterThan(0);
      for (const chunk of result) {
        expect(Array.isArray(chunk.embedding)).toBe(true);
        expect(chunk.embedding.length).toBe(3); // 3-dim embeddings from mock
        chunk.embedding.forEach((v) => expect(typeof v).toBe("number"));
      }
    });

    it("should have chunk content that matches input text segments", async () => {
      const text = "Vector search uses cosine similarity to find relevant documents.";
      const embedder = mockEmbedder();

      const result = await lateChunkText(text, DEFAULT_CONFIG, embedder);

      expect(result.length).toBeGreaterThan(0);
      // Each chunk content should be a substring of the original text
      for (const chunk of result) {
        expect(text).toContain(chunk.content);
      }
    });
  });

  describe("edge cases", () => {
    it("should return empty array for empty text", async () => {
      const embedder = mockEmbedder();

      const result = await lateChunkText("", DEFAULT_CONFIG, embedder);

      expect(result).toEqual([]);
    });

    it("should return empty array for whitespace-only text", async () => {
      const embedder = mockEmbedder();

      const result = await lateChunkText("   \n\t  ", DEFAULT_CONFIG, embedder);

      expect(result).toEqual([]);
    });

    it("should produce a single chunk when text is shorter than chunk_size", async () => {
      const shortText = "Short text about APIs.";
      const embedder = mockEmbedder();

      const result = await lateChunkText(shortText, { ...DEFAULT_CONFIG, chunk_size: 5000 }, embedder);

      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("Short text about APIs");
      expect(result[0].embedding.length).toBeGreaterThan(0);
    });

    it("should produce multiple sections and index all chunks correctly for document >30K chars", async () => {
      // Generate a document longer than DEFAULT_MAX_SECTION_CHARS (30000)
      const paragraphs = Array.from({ length: 200 }, (_, i) =>
        `Paragraph ${i + 1}. ${"This is content about middleware and routing in production systems. ".repeat(5)}`
      );
      const longText = paragraphs.join("\n\n");
      expect(longText.length).toBeGreaterThan(30000);

      const embedder = mockEmbedder();
      const config: ChunkConfig = { method: "recursive", chunk_size: 500, chunk_overlap: 50 };

      const result = await lateChunkText(longText, config, embedder);

      // Should produce multiple chunks across multiple sections
      expect(result.length).toBeGreaterThan(1);

      // All chunks should have valid indices and non-empty content and embeddings
      for (const chunk of result) {
        expect(typeof chunk.index).toBe("number");
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.embedding.length).toBeGreaterThan(0);
        expect(chunk.tokenCount).toBeGreaterThan(0);
      }
    });

    it("should add context prefix when ChunkContext is provided", async () => {
      const text = "Some documentation about agent configuration.";
      const embedder = mockEmbedder();
      const context: ChunkContext = { fileName: "agents.md" };

      const result = await lateChunkText(text, DEFAULT_CONFIG, embedder, context);

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].content).toContain("[Document: agents.md]");
    });
  });
});
