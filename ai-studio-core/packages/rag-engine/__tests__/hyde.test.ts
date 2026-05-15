import { describe, it, expect, vi } from "vitest";
import { hydeExpand } from "../src/hyde";
import type { LLMCaller } from "../src/hyde";

// ── Helpers ──

function mockLLMCaller(response: string): LLMCaller {
  return {
    call: async () => response,
  };
}

function throwingLLMCaller(error: Error): LLMCaller {
  return {
    call: async () => {
      throw error;
    },
  };
}

// ── Tests ──

describe("hydeExpand()", () => {
  describe("happy path", () => {
    it("should return the LLM-generated hypothetical answer", async () => {
      const llm = mockLLMCaller(
        "Routing in AI systems involves directing requests to the appropriate model based on task type, cost, and latency requirements.",
      );

      const result = await hydeExpand("How does AI routing work?", llm);

      expect(result).toBe(
        "Routing in AI systems involves directing requests to the appropriate model based on task type, cost, and latency requirements.",
      );
    });

    it("should return a non-empty trimmed response", async () => {
      const llm = mockLLMCaller("  A hypothetical answer with whitespace.  ");

      const result = await hydeExpand("What is embeddings?", llm);

      expect(result).toBe("A hypothetical answer with whitespace.");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should generate a response for a short single-word query", async () => {
      const llm: LLMCaller = {
        call: async (prompt: string) => {
          // Verify the prompt contains the short query
          expect(prompt).toContain("routing");
          return "Routing is the process of directing network traffic between different nodes in a system.";
        },
      };

      const result = await hydeExpand("routing", llm);

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain("Routing");
    });

    it("should handle a long query (500+ chars) without issues", async () => {
      const longQuery = "How does the system handle " + "complex routing scenarios ".repeat(20);
      const llm = mockLLMCaller("The system handles complex routing by using a priority queue.");

      const result = await hydeExpand(longQuery, llm);

      expect(result).toBe("The system handles complex routing by using a priority queue.");
    });
  });

  describe("error cases", () => {
    it("should return the original query as fallback when LLM caller throws", async () => {
      const llm = throwingLLMCaller(new Error("API timeout"));

      // Suppress expected console.warn
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await hydeExpand("What is vector search?", llm);

      expect(result).toBe("What is vector search?");

      vi.restoreAllMocks();
    });

    it("should return the original query when LLM returns empty string", async () => {
      const llm = mockLLMCaller("");

      // Suppress expected console.warn
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await hydeExpand("What are embeddings?", llm);

      expect(result).toBe("What are embeddings?");

      vi.restoreAllMocks();
    });

    it("should return the original query when LLM returns whitespace-only string", async () => {
      const llm = mockLLMCaller("   \n\t  ");

      // Suppress expected console.warn
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await hydeExpand("What is RAG?", llm);

      expect(result).toBe("What is RAG?");

      vi.restoreAllMocks();
    });
  });

  describe("non-Error throws", () => {
    it("should still return original query when LLM caller throws a raw string (not Error)", async () => {
      const llm: LLMCaller = {
        call: async () => {
          // eslint-disable-next-line no-throw-literal
          throw "raw string error";
        },
      };

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await hydeExpand("What is vector search?", llm);

      // The catch block uses: e instanceof Error ? e.message : String(e)
      // For a raw string throw, String("raw string error") is used in the warn
      // and the original query is returned as fallback
      expect(result).toBe("What is vector search?");

      vi.restoreAllMocks();
    });
  });

  describe("security", () => {
    it("should not crash on a query containing injection-like content", async () => {
      const injectionQuery = '"; DROP TABLE chunks; --';
      const llm = mockLLMCaller("A hypothetical answer about SQL.");

      const result = await hydeExpand(injectionQuery, llm);

      expect(result).toBe("A hypothetical answer about SQL.");
    });
  });
});
