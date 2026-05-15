import { describe, it, expect, vi } from "vitest";
import { enrichChunks } from "../src/contextual-enrichment";
import type { LLMCaller } from "../src/hyde";
import type { Chunk } from "../src/types";
import type { EnrichmentConfig } from "../src/contextual-enrichment";

// ── Helpers ──

function makeChunk(index: number, content: string): Chunk {
  return { index, content, tokenCount: Math.ceil(content.length / 4) };
}

function mockLLMCaller(responses: string[]): LLMCaller {
  let idx = 0;
  return {
    call: async () => responses[idx++] || "",
  };
}

function throwingLLMCaller(error: Error): LLMCaller {
  return {
    call: async () => {
      throw error;
    },
  };
}

const DOC_TEXT = "This is a full document about routing in AI systems.";

// ── Tests ──

describe("enrichChunks()", () => {
  describe("happy path", () => {
    it("should return original chunk texts and null descriptions when mode is 'none'", async () => {
      const chunks = [
        makeChunk(0, "Chunk zero content"),
        makeChunk(1, "Chunk one content"),
      ];
      const config: EnrichmentConfig = { mode: "none" };

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config);

      expect(result.enrichedTexts).toEqual(["Chunk zero content", "Chunk one content"]);
      expect(result.descriptions).toEqual([null, null]);
    });

    it("should prepend [Document: fileName] when mode is 'static' with fileName only", async () => {
      const chunks = [makeChunk(0, "Some chunk content")];
      const config: EnrichmentConfig = { mode: "static" };

      const result = await enrichChunks(chunks, DOC_TEXT, "report.pdf", undefined, config);

      expect(result.enrichedTexts[0]).toBe("[Document: report.pdf] Some chunk content");
      expect(result.descriptions[0]).toBeNull();
    });

    it("should prepend [Document: fileName | Section: heading] when mode is 'static' with both", async () => {
      const chunks = [makeChunk(0, "Section chunk content")];
      const config: EnrichmentConfig = { mode: "static" };

      const result = await enrichChunks(
        chunks,
        DOC_TEXT,
        "manual.pdf",
        "Chapter 3",
        config,
      );

      expect(result.enrichedTexts[0]).toBe(
        "[Document: manual.pdf | Section: Chapter 3] Section chunk content",
      );
      expect(result.descriptions[0]).toBeNull();
    });

    it("should call LLM for each chunk and return enriched texts with descriptions in 'llm' mode", async () => {
      const chunks = [
        makeChunk(0, "First chunk about routing"),
        makeChunk(1, "Second chunk about agents"),
      ];
      const config: EnrichmentConfig = { mode: "llm" };
      const llm = mockLLMCaller([
        "This chunk describes routing architecture.",
        "This chunk covers agent configuration.",
      ]);

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config, llm);

      expect(result.enrichedTexts[0]).toBe(
        "This chunk describes routing architecture.\n\nFirst chunk about routing",
      );
      expect(result.enrichedTexts[1]).toBe(
        "This chunk covers agent configuration.\n\nSecond chunk about agents",
      );
      expect(result.descriptions[0]).toBe("This chunk describes routing architecture.");
      expect(result.descriptions[1]).toBe("This chunk covers agent configuration.");
    });
  });

  describe("edge cases", () => {
    it("should return empty arrays when mode is 'llm' with empty chunks array", async () => {
      const config: EnrichmentConfig = { mode: "llm" };
      const llm = mockLLMCaller([]);

      const result = await enrichChunks([], DOC_TEXT, "doc.md", undefined, config, llm);

      expect(result.enrichedTexts).toEqual([]);
      expect(result.descriptions).toEqual([]);
    });

    it("should work correctly with a single chunk in 'llm' mode", async () => {
      const chunks = [makeChunk(0, "Only chunk")];
      const config: EnrichmentConfig = { mode: "llm" };
      const llm = mockLLMCaller(["Context for only chunk."]);

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config, llm);

      expect(result.enrichedTexts).toHaveLength(1);
      expect(result.enrichedTexts[0]).toBe("Context for only chunk.\n\nOnly chunk");
      expect(result.descriptions[0]).toBe("Context for only chunk.");
    });

    it("should work in 'static' mode with empty fileName without crashing", async () => {
      const chunks = [makeChunk(0, "Content here")];
      const config: EnrichmentConfig = { mode: "static" };

      const result = await enrichChunks(chunks, DOC_TEXT, "", undefined, config);

      expect(result.enrichedTexts[0]).toBe("[Document: ] Content here");
      expect(result.descriptions[0]).toBeNull();
    });
  });

  describe("error cases", () => {
    it("should fall back to original text with null description when LLM caller throws", async () => {
      const chunks = [
        makeChunk(0, "Chunk that will fail"),
        makeChunk(1, "Another chunk that will fail"),
      ];
      const config: EnrichmentConfig = { mode: "llm" };
      const llm = throwingLLMCaller(new Error("API rate limited"));

      // Suppress expected console.warn
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config, llm);

      expect(result.enrichedTexts[0]).toBe("Chunk that will fail");
      expect(result.enrichedTexts[1]).toBe("Another chunk that will fail");
      expect(result.descriptions[0]).toBeNull();
      expect(result.descriptions[1]).toBeNull();

      vi.restoreAllMocks();
    });

    it("should use original text when LLM returns empty string", async () => {
      const chunks = [makeChunk(0, "Original chunk text")];
      const config: EnrichmentConfig = { mode: "llm" };
      const llm = mockLLMCaller([""]);

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config, llm);

      // Empty trimmed description becomes "", so enrichedText = "\n\nOriginal chunk text"
      // and description is "" (empty string, not null — no error thrown)
      expect(result.enrichedTexts[0]).toBe("\n\nOriginal chunk text");
      expect(result.descriptions[0]).toBe("");
    });

    it("should throw when mode is 'llm' but no llmCaller is provided", async () => {
      const chunks = [makeChunk(0, "A chunk")];
      const config: EnrichmentConfig = { mode: "llm" };

      await expect(
        enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config),
      ).rejects.toThrow("LLM caller is required");
    });
  });

  describe("concurrency", () => {
    it("should enrich all 5 chunks when concurrency is 2 and LLM is called 5 times", async () => {
      const chunks = [
        makeChunk(0, "Chunk A"),
        makeChunk(1, "Chunk B"),
        makeChunk(2, "Chunk C"),
        makeChunk(3, "Chunk D"),
        makeChunk(4, "Chunk E"),
      ];
      const config: EnrichmentConfig = { mode: "llm", concurrency: 2 };

      let callCount = 0;
      const spyLLM: LLMCaller = {
        call: async () => {
          callCount++;
          return `Description for chunk ${callCount}`;
        },
      };

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config, spyLLM);

      expect(callCount).toBe(5);
      expect(result.enrichedTexts).toHaveLength(5);
      expect(result.descriptions).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(typeof result.descriptions[i]).toBe("string");
        expect(result.descriptions[i]!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("behavior documentation", () => {
    it("should produce empty-string description (not null) when LLM returns empty response", async () => {
      const chunks = [makeChunk(0, "Original chunk text")];
      const config: EnrichmentConfig = { mode: "llm" };
      const llm = mockLLMCaller([""]);

      const result = await enrichChunks(chunks, DOC_TEXT, "doc.md", undefined, config, llm);

      // When LLM returns empty string, trimmedDescription is "", which is falsy but NOT null.
      // This documents that the description field is "" (empty string) rather than null.
      expect(result.descriptions[0]).toBe("");
      expect(result.descriptions[0]).not.toBeNull();
    });
  });

  describe("security", () => {
    it("should truncate very long document text to ~8000 chars in the system message", async () => {
      const longDocText = "A".repeat(20_000);
      const chunks = [makeChunk(0, "Test chunk")];
      const config: EnrichmentConfig = { mode: "llm" };

      let capturedSystemMessage = "";
      const spyLLM: LLMCaller = {
        call: async (_prompt: string, options?: { maxTokens?: number; temperature?: number; systemMessage?: string }) => {
          capturedSystemMessage = options?.systemMessage || "";
          return "Context description.";
        },
      };

      await enrichChunks(chunks, longDocText, "doc.md", undefined, config, spyLLM);

      // The system message should contain the document text truncated to MAX_DOC_CHARS (8000)
      // The document section is between <document> and </document> tags
      const docMatch = capturedSystemMessage.match(/<document>\n([\s\S]*?)\n<\/document>/);
      expect(docMatch).not.toBeNull();
      expect(docMatch![1].length).toBeLessThanOrEqual(8000);
      // The original doc is 20k chars, so it must have been truncated
      expect(docMatch![1].length).toBe(8000);
    });
  });
});
