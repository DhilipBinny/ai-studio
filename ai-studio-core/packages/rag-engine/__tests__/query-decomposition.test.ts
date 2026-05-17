import { describe, it, expect, vi } from "vitest";
import { decomposeQuery } from "../src/query-decomposition";
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

describe("decomposeQuery()", () => {
  describe("happy path", () => {
    it("should decompose a complex multi-part query into sub-queries", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: true,
        subQueries: [
          "What is middleware in Next.js App Router?",
          "How does caching work in Next.js App Router?",
          "How does middleware affect cached routes?",
        ],
        reasoning: "This query asks about two topics: middleware and caching, plus their interaction",
      }));

      const result = await decomposeQuery(
        "How does middleware interact with the App Router's caching strategy?",
        llm,
      );

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toHaveLength(3);
      expect(result.subQueries[0]).toContain("middleware");
      expect(result.subQueries[1]).toContain("caching");
      expect(result.reasoning).toContain("middleware");
    });

    it("should return shouldDecompose=false for a simple single-topic query", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: false,
        subQueries: ["What is the default port for Next.js?"],
        reasoning: "Single-topic query, no decomposition needed",
      }));

      const result = await decomposeQuery("What is the default port for Next.js?", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toHaveLength(1);
      expect(result.subQueries[0]).toBe("What is the default port for Next.js?");
    });

    it("should handle LLM response with 2 sub-queries", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: true,
        subQueries: [
          "Compare generateStaticParams API",
          "Compare getStaticPaths API",
        ],
        reasoning: "Comparison between two different APIs",
      }));

      const result = await decomposeQuery("Compare generateStaticParams with getStaticPaths", llm);

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toHaveLength(2);
    });

    it("should pass the query in the prompt to the LLM", async () => {
      const llm: LLMCaller = {
        call: async (prompt: string) => {
          expect(prompt).toContain("How does routing work?");
          return JSON.stringify({
            shouldDecompose: false,
            subQueries: ["How does routing work?"],
            reasoning: "Simple query",
          });
        },
      };

      await decomposeQuery("How does routing work?", llm);
    });
  });

  describe("edge cases", () => {
    it("should return shouldDecompose=false with original for empty query", async () => {
      const llm = mockLLMCaller("should not be called");

      const result = await decomposeQuery("", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual([""]);
    });

    it("should return shouldDecompose=false with original for whitespace-only query", async () => {
      const llm = mockLLMCaller("should not be called");

      const result = await decomposeQuery("   \n\t  ", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["   \n\t  "]);
    });

    it("should truncate sub-queries beyond 3 to max 3", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: true,
        subQueries: ["q1", "q2", "q3", "q4", "q5"],
        reasoning: "Too many sub-queries",
      }));

      const result = await decomposeQuery("A very complex query", llm);

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toHaveLength(3);
      expect(result.subQueries).toEqual(["q1", "q2", "q3"]);
    });

    it("should handle LLM response wrapped in markdown code fence", async () => {
      const response = '```json\n' + JSON.stringify({
        shouldDecompose: true,
        subQueries: ["sub-query 1", "sub-query 2"],
        reasoning: "Two topics",
      }) + '\n```';
      const llm = mockLLMCaller(response);

      const result = await decomposeQuery("Complex query about A and B", llm);

      expect(result.shouldDecompose).toBe(true);
      expect(result.subQueries).toHaveLength(2);
    });
  });

  describe("error cases", () => {
    it("should return original query as fallback when LLM returns invalid JSON", async () => {
      const llm = mockLLMCaller("This is not valid JSON at all.");

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await decomposeQuery("What is vector search?", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["What is vector search?"]);
      expect(result.reasoning).toContain("invalid JSON");

      vi.restoreAllMocks();
    });

    it("should return original query as fallback when LLM throws", async () => {
      const llm = throwingLLMCaller(new Error("API rate limit exceeded"));

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await decomposeQuery("What is embedding?", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["What is embedding?"]);
      expect(result.reasoning).toContain("API rate limit exceeded");

      vi.restoreAllMocks();
    });

    it("should return original query when LLM returns empty response", async () => {
      const llm = mockLLMCaller("");

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await decomposeQuery("How does auth work?", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["How does auth work?"]);

      vi.restoreAllMocks();
    });

    it("should return original query when JSON has missing shouldDecompose field", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        subQueries: ["q1"],
        reasoning: "Missing shouldDecompose",
      }));

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await decomposeQuery("Test query", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["Test query"]);

      vi.restoreAllMocks();
    });

    it("should fall back to original query when LLM returns subQueries with empty string", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: true,
        subQueries: ["valid sub-query", "", "another valid one"],
        reasoning: "Contains an empty string sub-query",
      }));

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await decomposeQuery("Complex query", llm);

      // parseDecompositionResponse checks: obj.subQueries.some(q => q === "")
      // which returns null, triggering fallback to original query
      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["Complex query"]);

      vi.restoreAllMocks();
    });

    it("should return original query when JSON has empty subQueries array", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: true,
        subQueries: [],
        reasoning: "Empty array",
      }));

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await decomposeQuery("Test query", llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual(["Test query"]);

      vi.restoreAllMocks();
    });
  });

  describe("security", () => {
    it("should not crash on a query with injection-like content", async () => {
      const injectionQuery = '"; DROP TABLE chunks; --';
      const llm = mockLLMCaller(JSON.stringify({
        shouldDecompose: false,
        subQueries: [injectionQuery],
        reasoning: "Single query",
      }));

      const result = await decomposeQuery(injectionQuery, llm);

      expect(result.shouldDecompose).toBe(false);
      expect(result.subQueries).toEqual([injectionQuery]);
    });
  });
});
