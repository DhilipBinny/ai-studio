import { describe, it, expect, vi } from "vitest";
import { graphExpand } from "../src/graph-search";
import type { GraphSearchStore } from "../src/graph-search";
import type { Embedder } from "../src/interfaces";

// ── Helpers ──

function mockEmbedder(embedding: number[] = [0.1, 0.2, 0.3]): Embedder {
  return {
    embed: async (texts: string[]) => texts.map(() => embedding),
    embedSingle: async () => embedding,
  };
}

function mockStore(overrides: Partial<GraphSearchStore> = {}): GraphSearchStore {
  return {
    findEntitiesByEmbedding: async () => [],
    findConnectedEntities: async () => [],
    getChunksByIds: async () => [],
    ...overrides,
  };
}

// ── Tests ──

describe("graphExpand()", () => {
  describe("happy path", () => {
    it("should return chunks with score 0.01 when matching entities are found", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [
          { id: "ent-1", name: "middleware", sourceChunkId: 101 },
        ],
        findConnectedEntities: async () => [],
        getChunksByIds: async () => [
          { id: 101, content: "Middleware handles auth.", metadata: {} },
        ],
      });

      const result = await graphExpand("middleware auth", ["kb-1"], "tenant-1", embedder, store);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 101,
        content: "Middleware handles auth.",
        score: 0.01,
      });
    });

    it("should include 1-hop connected entity chunks in the results", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [
          { id: "ent-1", name: "Agent", sourceChunkId: 10 },
        ],
        findConnectedEntities: async () => [
          { entityId: "ent-2", sourceChunkId: 20 },
          { entityId: "ent-3", sourceChunkId: 30 },
        ],
        getChunksByIds: async (ids: number[]) => {
          const data: Record<number, { id: number; content: string; metadata: Record<string, unknown> }> = {
            10: { id: 10, content: "Agent configuration.", metadata: {} },
            20: { id: 20, content: "Tool binding details.", metadata: {} },
            30: { id: 30, content: "Workflow node setup.", metadata: {} },
          };
          return ids.map((id) => data[id]).filter(Boolean);
        },
      });

      const result = await graphExpand("agent tools", ["kb-1"], "tenant-1", embedder, store);

      expect(result).toHaveLength(3);
      const ids = result.map((r) => r.id);
      expect(ids).toContain(10);
      expect(ids).toContain(20);
      expect(ids).toContain(30);
      result.forEach((r) => expect(r.score).toBe(0.01));
    });
  });

  describe("edge cases", () => {
    it("should return empty result when no matching entities are found", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [],
      });

      const result = await graphExpand("unrelated query", ["kb-1"], "tenant-1", embedder, store);

      expect(result).toEqual([]);
    });

    it("should return only direct entity chunks when there are no relationships", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [
          { id: "ent-1", name: "Redis", sourceChunkId: 50 },
        ],
        findConnectedEntities: async () => [],
        getChunksByIds: async () => [
          { id: 50, content: "Redis caching layer.", metadata: {} },
        ],
      });

      const result = await graphExpand("caching", ["kb-1"], "tenant-1", embedder, store);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(50);
    });

    it("should return empty result when kbIds is empty", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [],
      });

      const result = await graphExpand("query", [], "tenant-1", embedder, store);

      expect(result).toEqual([]);
    });

    it("should deduplicate chunk IDs when matched and connected entities share chunks", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [
          { id: "ent-1", name: "Auth", sourceChunkId: 42 },
        ],
        findConnectedEntities: async () => [
          { entityId: "ent-2", sourceChunkId: 42 }, // same chunk as matched entity
        ],
        getChunksByIds: async () => [
          { id: 42, content: "Auth and session management.", metadata: {} },
        ],
      });

      const result = await graphExpand("auth", ["kb-1"], "tenant-1", embedder, store);

      // Chunk 42 appears in both matched and connected, but should only appear once
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(42);
    });

    it("should return empty result when entities found but getChunksByIds returns empty array", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => [
          { id: "ent-1", name: "Kafka", sourceChunkId: 99 },
        ],
        findConnectedEntities: async () => [
          { entityId: "ent-2", sourceChunkId: 100 },
        ],
        getChunksByIds: async () => [],
      });

      const result = await graphExpand("streaming", ["kb-1"], "tenant-1", embedder, store);

      expect(result).toEqual([]);
    });
  });

  describe("error cases", () => {
    it("should return empty result when store.findEntitiesByEmbedding throws", async () => {
      const embedder = mockEmbedder();
      const store = mockStore({
        findEntitiesByEmbedding: async () => {
          throw new Error("Database connection failed");
        },
      });

      const result = await graphExpand("query", ["kb-1"], "tenant-1", embedder, store)
        .catch(() => []);

      expect(result).toEqual([]);
    });

    it("should propagate error when embedder.embedSingle throws", async () => {
      const embedder: Embedder = {
        embed: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
        embedSingle: async () => {
          throw new Error("Embedding service unavailable");
        },
      };
      const store = mockStore();

      await expect(
        graphExpand("query", ["kb-1"], "tenant-1", embedder, store),
      ).rejects.toThrow("Embedding service unavailable");
    });
  });
});
