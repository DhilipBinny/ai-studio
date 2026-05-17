import { describe, it, expect, vi } from "vitest";
import { evaluateRAG } from "../src/evaluator";
import type { EvaluationQuestion } from "../src/evaluator";
import type { LLMCaller } from "../src/hyde";
import type { SearchResult, Embedder } from "../src/interfaces";

// ── Helpers ──

function makeSearchResult(content: string, score = 0.9): SearchResult {
  return {
    content,
    score,
    documentName: "doc.md",
    knowledgeBaseName: "KB1",
    chunkIndex: 0,
    source: "vector" as const,
  };
}

const mockSearchFn = async (_query: string): Promise<SearchResult[]> => [
  makeSearchResult("Test content about routing"),
];

const emptySearchFn = async (_query: string): Promise<SearchResult[]> => [];

/**
 * Build a mock LLM caller that responds with appropriate JSON based on prompt content.
 *
 * The evaluator uses distinct prompts for:
 *  - Answer generation: free-text
 *  - Context precision: expects JSON array of {chunk_index, relevant}
 *  - Context recall: expects JSON {claims: [...], score}
 *  - Faithfulness: expects JSON {claims: [...], score}
 *  - Answer relevancy: expects JSON array of 3 question strings
 */
function buildMockLLMCaller(overrides?: {
  answerText?: string;
  contextPrecisionJSON?: string;
  contextRecallJSON?: string;
  faithfulnessJSON?: string;
  answerRelevancyJSON?: string;
}): LLMCaller {
  return {
    call: async (prompt: string) => {
      // Answer generation prompt (contains "Answer the following question using ONLY")
      if (prompt.includes("Answer the following question using ONLY")) {
        return overrides?.answerText ?? "Routing is the process of directing AI requests to models.";
      }

      // Context precision prompt (contains "judge whether each chunk")
      if (prompt.includes("judge whether each chunk")) {
        return overrides?.contextPrecisionJSON ?? JSON.stringify([
          { chunk_index: 0, relevant: true, reason: "Directly addresses routing" },
        ]);
      }

      // Context recall prompt (contains "fraction of the ground truth")
      if (prompt.includes("fraction of the ground truth")) {
        return overrides?.contextRecallJSON ?? JSON.stringify({
          claims: [{ claim: "Routing directs requests", supported: true }],
          score: 0.75,
        });
      }

      // Faithfulness prompt (contains "every claim" and "supported by the context")
      if (prompt.includes("every claim") && prompt.includes("supported by the context")) {
        return overrides?.faithfulnessJSON ?? JSON.stringify({
          claims: [{ claim: "Routing directs requests", supported: true }],
          score: 0.85,
        });
      }

      // Answer relevancy prompt (contains "generate exactly 3 questions")
      if (prompt.includes("generate exactly 3 questions")) {
        return overrides?.answerRelevancyJSON ?? JSON.stringify([
          "How does routing work?",
          "What is AI routing?",
          "How are requests directed?",
        ]);
      }

      return "Fallback response";
    },
  };
}

/**
 * Build a mock embedder that returns deterministic embeddings.
 * For answer relevancy, the cosine similarity between the question embedding
 * and generated-question embeddings determines the score.
 * We return identical vectors so similarity = 1.0.
 */
function buildMockEmbedder(): Embedder {
  return {
    embed: async (texts: string[]) =>
      texts.map(() => [0.5, 0.5, 0.5, 0.5]),
    embedSingle: async () => [0.5, 0.5, 0.5, 0.5],
  };
}

// ── Tests ──

describe("evaluateRAG()", () => {
  describe("happy path", () => {
    it("should return all 4 scores between 0-1 for a single question with ground truth", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "How does routing work?", groundTruth: "Routing directs requests to models." },
      ];

      const { results, summary } = await evaluateRAG(
        questions,
        mockSearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(results).toHaveLength(1);

      const scores = results[0].scores;
      expect(scores.contextPrecision).toBeGreaterThanOrEqual(0);
      expect(scores.contextPrecision).toBeLessThanOrEqual(1);
      expect(scores.contextRecall).not.toBeNull();
      expect(scores.contextRecall!).toBeGreaterThanOrEqual(0);
      expect(scores.contextRecall!).toBeLessThanOrEqual(1);
      expect(scores.faithfulness).toBeGreaterThanOrEqual(0);
      expect(scores.faithfulness).toBeLessThanOrEqual(1);
      expect(scores.answerRelevancy).toBeGreaterThanOrEqual(0);
      expect(scores.answerRelevancy).toBeLessThanOrEqual(1);

      // summary should reflect the single result
      expect(summary.totalQuestions).toBe(1);
    });

    it("should return results array matching input length for multiple questions", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "What is routing?", groundTruth: "Routing is request direction." },
        { question: "What are agents?", groundTruth: "Agents are autonomous AI entities." },
      ];

      const { results } = await evaluateRAG(
        questions,
        mockSearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(results).toHaveLength(2);
      expect(results[0].question).toBe("What is routing?");
      expect(results[1].question).toBe("What are agents?");
    });

    it("should compute correct summary averages", async () => {
      // Use two questions with known scores (both have ground truth)
      const questions: EvaluationQuestion[] = [
        { question: "Q1", groundTruth: "GT1" },
        { question: "Q2", groundTruth: "GT2" },
      ];

      const { results, summary } = await evaluateRAG(
        questions,
        mockSearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(summary.totalQuestions).toBe(2);

      // Averages should equal the mean of the two result scores
      const expectedAvgPrecision =
        (results[0].scores.contextPrecision + results[1].scores.contextPrecision) / 2;
      expect(summary.avgContextPrecision).toBeCloseTo(expectedAvgPrecision, 10);

      const expectedAvgFaithfulness =
        (results[0].scores.faithfulness + results[1].scores.faithfulness) / 2;
      expect(summary.avgFaithfulness).toBeCloseTo(expectedAvgFaithfulness, 10);

      const expectedAvgRelevancy =
        (results[0].scores.answerRelevancy + results[1].scores.answerRelevancy) / 2;
      expect(summary.avgAnswerRelevancy).toBeCloseTo(expectedAvgRelevancy, 10);

      // Both have ground truth, so avgContextRecall should not be null
      expect(summary.avgContextRecall).not.toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should return contextRecall as null when question has no ground truth", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "How does routing work?" }, // no groundTruth
      ];

      const { results, summary } = await evaluateRAG(
        questions,
        mockSearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(results[0].scores.contextRecall).toBeNull();
      // Summary avgContextRecall should be null since no questions have ground truth
      expect(summary.avgContextRecall).toBeNull();
    });

    it("should return empty results and zero summary for empty questions array", async () => {
      const { results, summary } = await evaluateRAG(
        [],
        mockSearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(results).toEqual([]);
      expect(summary.totalQuestions).toBe(0);
      expect(summary.avgContextPrecision).toBe(0);
      expect(summary.avgContextRecall).toBeNull();
      expect(summary.avgFaithfulness).toBe(0);
      expect(summary.avgAnswerRelevancy).toBe(0);
    });

    it("should produce 0 or low scores when search returns no chunks", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "What is routing?", groundTruth: "Routing directs requests." },
      ];

      const { results } = await evaluateRAG(
        questions,
        emptySearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(results).toHaveLength(1);
      // With no chunks, contextPrecision and contextRecall should be 0
      expect(results[0].scores.contextPrecision).toBe(0);
      expect(results[0].scores.contextRecall).toBe(0);
      // retrievedChunks should be empty
      expect(results[0].retrievedChunks).toEqual([]);
    });
  });

  describe("error cases", () => {
    it("should default metric score to 0 when LLM returns invalid JSON", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "What is routing?", groundTruth: "Routing directs requests." },
      ];

      const llm = buildMockLLMCaller({
        // Valid answer generation
        answerText: "Routing directs requests to models.",
        // Invalid JSON for precision
        contextPrecisionJSON: "not valid json at all",
        // Invalid JSON for recall
        contextRecallJSON: "completely broken {{{",
        // Invalid JSON for faithfulness
        faithfulnessJSON: "also not json <<<",
        // Invalid JSON for relevancy
        answerRelevancyJSON: "broken json",
      });

      const { results } = await evaluateRAG(
        questions,
        mockSearchFn,
        llm,
        buildMockEmbedder(),
      );

      // All metric scores should default to 0 due to parse failures
      expect(results[0].scores.contextPrecision).toBe(0);
      expect(results[0].scores.faithfulness).toBe(0);
      expect(results[0].scores.answerRelevancy).toBe(0);
    });

    it("should handle gracefully when LLM caller throws on all calls", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "What is routing?" },
      ];

      const throwingLLM: LLMCaller = {
        call: async () => {
          throw new Error("LLM service down");
        },
      };

      // Should not throw — all metric handlers catch internally
      const { results, summary } = await evaluateRAG(
        questions,
        mockSearchFn,
        throwingLLM,
        buildMockEmbedder(),
      );

      expect(results).toHaveLength(1);
      // Generated answer falls back to error message
      expect(results[0].generatedAnswer).toBe("Failed to generate answer.");
      // All scores should be 0 (catch blocks return 0)
      expect(results[0].scores.contextPrecision).toBe(0);
      expect(results[0].scores.faithfulness).toBe(0);
      expect(results[0].scores.answerRelevancy).toBe(0);
      // No ground truth, so contextRecall is null
      expect(results[0].scores.contextRecall).toBeNull();
      expect(summary.totalQuestions).toBe(1);
    });
  });

  describe("safeParseJSON edge cases", () => {
    it("should extract JSON from LLM response with prose text surrounding it", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "What is routing?", groundTruth: "Routing directs requests." },
      ];

      const llm = buildMockLLMCaller({
        answerText: "Routing directs requests to models.",
        // Context precision: LLM wraps the JSON in prose text
        contextPrecisionJSON: 'Here is the result: [{"chunk_index": 0, "relevant": true, "reason": "Relevant"}]',
        // Context recall: valid JSON with prose wrapper
        contextRecallJSON: 'Sure, here is the analysis: {"claims": [{"claim": "Routing directs requests", "supported": true}], "score": 0.9}',
        faithfulnessJSON: JSON.stringify({
          claims: [{ claim: "Routing directs requests", supported: true }],
          score: 0.85,
        }),
        answerRelevancyJSON: JSON.stringify([
          "How does routing work?",
          "What is AI routing?",
          "How are requests directed?",
        ]),
      });

      const { results } = await evaluateRAG(
        questions,
        mockSearchFn,
        llm,
        buildMockEmbedder(),
      );

      // safeParseJSON regex should extract the JSON from the prose-wrapped responses
      expect(results[0].scores.contextPrecision).toBeGreaterThan(0);
      expect(results[0].scores.contextRecall).toBe(0.9);
    });

    it("should compute context recall from claims ratio when score field is missing", async () => {
      const questions: EvaluationQuestion[] = [
        { question: "What is routing?", groundTruth: "Routing directs requests to models." },
      ];

      const llm = buildMockLLMCaller({
        // Context recall: claims array but NO score field
        contextRecallJSON: JSON.stringify({
          claims: [
            { claim: "Routing directs requests", supported: true },
            { claim: "Directs to models", supported: true },
            { claim: "Uses load balancing", supported: false },
          ],
          // no score field — evaluator should compute from claims ratio: 2/3
        }),
      });

      const { results } = await evaluateRAG(
        questions,
        mockSearchFn,
        llm,
        buildMockEmbedder(),
      );

      // With no score field, evaluator falls through to claims ratio: 2/3 = 0.6667
      expect(results[0].scores.contextRecall).toBeCloseTo(2 / 3, 4);
    });
  });

  describe("security", () => {
    it("should not crash on questions containing injection-like content", async () => {
      const questions: EvaluationQuestion[] = [
        {
          question: '"; DROP TABLE chunks; -- SELECT * FROM users WHERE 1=1',
          groundTruth: "Injection should not affect evaluation.",
        },
      ];

      const { results } = await evaluateRAG(
        questions,
        mockSearchFn,
        buildMockLLMCaller(),
        buildMockEmbedder(),
      );

      expect(results).toHaveLength(1);
      expect(results[0].question).toBe('"; DROP TABLE chunks; -- SELECT * FROM users WHERE 1=1');
      // Scores should still be valid numbers
      expect(typeof results[0].scores.contextPrecision).toBe("number");
      expect(typeof results[0].scores.faithfulness).toBe("number");
    });
  });
});
