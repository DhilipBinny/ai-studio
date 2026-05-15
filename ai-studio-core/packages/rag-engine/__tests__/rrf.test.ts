import { describe, it, expect } from "vitest";
import { rrfFuse } from "../src/rrf";
import type { RankedItem } from "../src/types";

function makeItem(
  id: string | number,
  content: string,
  source: "vector" | "bm25",
  score = 0.9,
): RankedItem {
  return { id, content, score, source };
}

describe("rrfFuse", () => {
  it("should fuse 2 result lists with overlap — combined scores from both", () => {
    const vectorResults: RankedItem[] = [
      makeItem("a", "Doc A", "vector"),
      makeItem("b", "Doc B", "vector"),
      makeItem("c", "Doc C", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("b", "Doc B", "bm25"),
      makeItem("d", "Doc D", "bm25"),
      makeItem("a", "Doc A", "bm25"),
    ];

    const results = rrfFuse(vectorResults, bm25Results);
    const k = 60;

    // "b" is rank 2 in vector, rank 1 in BM25
    const itemB = results.find((r) => r.id === "b")!;
    expect(itemB.vectorRank).toBe(2);
    expect(itemB.bm25Rank).toBe(1);
    const expectedScoreB = 1 / (k + 2) + 1 / (k + 1);
    expect(itemB.rrfScore).toBeCloseTo(expectedScoreB, 10);

    // "a" is rank 1 in vector, rank 3 in BM25
    const itemA = results.find((r) => r.id === "a")!;
    expect(itemA.vectorRank).toBe(1);
    expect(itemA.bm25Rank).toBe(3);
    const expectedScoreA = 1 / (k + 1) + 1 / (k + 3);
    expect(itemA.rrfScore).toBeCloseTo(expectedScoreA, 10);
  });

  it("should score an item present only in vector list from vector rank alone", () => {
    const vectorResults: RankedItem[] = [
      makeItem("only-vec", "Vector only doc", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("other", "Other doc", "bm25"),
    ];

    const results = rrfFuse(vectorResults, bm25Results);
    const k = 60;

    const item = results.find((r) => r.id === "only-vec")!;
    expect(item.vectorRank).toBe(1);
    expect(item.bm25Rank).toBeNull();
    expect(item.rrfScore).toBeCloseTo(1 / (k + 1), 10);
  });

  it("should score an item present only in BM25 list from BM25 rank alone", () => {
    const vectorResults: RankedItem[] = [
      makeItem("other", "Other doc", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("only-bm25", "BM25 only doc", "bm25"),
    ];

    const results = rrfFuse(vectorResults, bm25Results);
    const k = 60;

    const item = results.find((r) => r.id === "only-bm25")!;
    expect(item.vectorRank).toBeNull();
    expect(item.bm25Rank).toBe(1);
    expect(item.rrfScore).toBeCloseTo(1 / (k + 1), 10);
  });

  it("should return results sorted by descending RRF score", () => {
    const vectorResults: RankedItem[] = [
      makeItem("a", "Doc A", "vector"),
      makeItem("b", "Doc B", "vector"),
      makeItem("c", "Doc C", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("c", "Doc C", "bm25"),
      makeItem("a", "Doc A", "bm25"),
      makeItem("b", "Doc B", "bm25"),
    ];

    const results = rrfFuse(vectorResults, bm25Results);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].rrfScore).toBeGreaterThanOrEqual(results[i].rrfScore);
    }
  });

  it("should return only BM25 results when vector list is empty", () => {
    const bm25Results: RankedItem[] = [
      makeItem("x", "Doc X", "bm25"),
      makeItem("y", "Doc Y", "bm25"),
    ];

    const results = rrfFuse([], bm25Results);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.vectorRank).toBeNull();
      expect(r.bm25Rank).not.toBeNull();
    }
  });

  it("should return only vector results when BM25 list is empty", () => {
    const vectorResults: RankedItem[] = [
      makeItem("x", "Doc X", "vector"),
      makeItem("y", "Doc Y", "vector"),
    ];

    const results = rrfFuse(vectorResults, []);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.bm25Rank).toBeNull();
      expect(r.vectorRank).not.toBeNull();
    }
  });

  it("should return an empty array when both lists are empty", () => {
    const results = rrfFuse([], []);

    expect(results).toEqual([]);
  });

  it("should produce different scores with custom k value (k=1 vs k=60)", () => {
    const vectorResults: RankedItem[] = [
      makeItem("a", "Doc A", "vector"),
      makeItem("b", "Doc B", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("a", "Doc A", "bm25"),
      makeItem("b", "Doc B", "bm25"),
    ];

    const resultsK1 = rrfFuse(vectorResults, bm25Results, 1);
    const resultsK60 = rrfFuse(vectorResults, bm25Results, 60);

    const scoreAK1 = resultsK1.find((r) => r.id === "a")!.rrfScore;
    const scoreAK60 = resultsK60.find((r) => r.id === "a")!.rrfScore;

    // With k=1: score = 1/(1+1) + 1/(1+1) = 1.0
    // With k=60: score = 1/(60+1) + 1/(60+1) ≈ 0.0328
    expect(scoreAK1).toBeCloseTo(1 / 2 + 1 / 2, 10);
    expect(scoreAK60).toBeCloseTo(1 / 61 + 1 / 61, 10);
    expect(scoreAK1).toBeGreaterThan(scoreAK60);
  });

  it("should compute scores using the formula: score = 1/(k+rank_vector) + 1/(k+rank_bm25)", () => {
    const k = 60;
    const vectorResults: RankedItem[] = [
      makeItem("a", "Doc A", "vector"),
      makeItem("b", "Doc B", "vector"),
      makeItem("c", "Doc C", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("c", "Doc C", "bm25"),
      makeItem("b", "Doc B", "bm25"),
      makeItem("a", "Doc A", "bm25"),
    ];

    const results = rrfFuse(vectorResults, bm25Results, k);

    // Verify exact formula for each item
    // "a": vector rank=1, bm25 rank=3
    const itemA = results.find((r) => r.id === "a")!;
    expect(itemA.rrfScore).toBeCloseTo(1 / (k + 1) + 1 / (k + 3), 10);

    // "b": vector rank=2, bm25 rank=2
    const itemB = results.find((r) => r.id === "b")!;
    expect(itemB.rrfScore).toBeCloseTo(1 / (k + 2) + 1 / (k + 2), 10);

    // "c": vector rank=3, bm25 rank=1
    const itemC = results.find((r) => r.id === "c")!;
    expect(itemC.rrfScore).toBeCloseTo(1 / (k + 3) + 1 / (k + 1), 10);

    // "a" and "c" should have identical scores (symmetric ranks)
    expect(itemA.rrfScore).toBeCloseTo(itemC.rrfScore, 10);
  });

  it("should preserve metadata from input items in fused results", () => {
    const vectorResults: RankedItem[] = [
      { id: "a", content: "Doc A", score: 0.95, source: "vector", metadata: { page: 1, section: "intro" } },
    ];
    const bm25Results: RankedItem[] = [
      { id: "b", content: "Doc B", score: 0.8, source: "bm25", metadata: { page: 5, tags: ["summary"] } },
    ];

    const results = rrfFuse(vectorResults, bm25Results);

    const itemA = results.find((r) => r.id === "a")!;
    expect(itemA.metadata).toEqual({ page: 1, section: "intro" });

    const itemB = results.find((r) => r.id === "b")!;
    expect(itemB.metadata).toEqual({ page: 5, tags: ["summary"] });
  });

  it("should let last duplicate ID win within the same list (Map behavior)", () => {
    // When the same ID appears twice in the vector list, the second entry
    // overwrites the first in the Map — so it keeps the later rank.
    const vectorResults: RankedItem[] = [
      makeItem("dup", "First occurrence", "vector", 0.9),
      makeItem("other", "Other doc", "vector", 0.8),
      makeItem("dup", "Second occurrence", "vector", 0.7),
    ];
    const bm25Results: RankedItem[] = [];

    const results = rrfFuse(vectorResults, bm25Results);
    const k = 60;

    const dupItem = results.find((r) => r.id === "dup")!;
    // The second "dup" is at index 2 (rank 3), overwriting the first (rank 1)
    expect(dupItem.content).toBe("Second occurrence");
    expect(dupItem.vectorRank).toBe(3);
    expect(dupItem.rrfScore).toBeCloseTo(1 / (k + 3), 10);
  });

  it("should produce valid scores when k=0", () => {
    const vectorResults: RankedItem[] = [
      makeItem("a", "Doc A", "vector"),
      makeItem("b", "Doc B", "vector"),
    ];
    const bm25Results: RankedItem[] = [
      makeItem("a", "Doc A", "bm25"),
    ];

    // k=0: scores become 1/rank, which is valid (no division by zero since rank >= 1)
    const results = rrfFuse(vectorResults, bm25Results, 0);

    const itemA = results.find((r) => r.id === "a")!;
    // vector rank 1, bm25 rank 1 => 1/(0+1) + 1/(0+1) = 2.0
    expect(itemA.rrfScore).toBeCloseTo(2.0, 10);

    const itemB = results.find((r) => r.id === "b")!;
    // vector rank 2, no bm25 => 1/(0+2) = 0.5
    expect(itemB.rrfScore).toBeCloseTo(0.5, 10);

    // Results should still be sorted descending
    expect(results[0].rrfScore).toBeGreaterThanOrEqual(results[1].rrfScore);
  });
});
