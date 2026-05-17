import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { QdrantClient } from "@qdrant/js-client-rest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const TEST_COLLECTION = "test_qdrant_unit";

const TENANT_A = "tenant_a_test";
const TENANT_B = "tenant_b_test";
const KB_ID_1 = "kb_001_test";
const KB_ID_2 = "kb_002_test";
const DOC_ID_1 = "doc_001_test";
const DOC_ID_2 = "doc_002_test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random vector of the given dimension. */
function randomVector(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1);
}

/** Normalized vector so cosine similarity produces meaningful scores. */
function normalizedVector(dim: number, seed: number): number[] {
  const v = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1)));
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / mag);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let client: QdrantClient;

/**
 * Qdrant unit tests — run against a REAL Qdrant instance at localhost:6333.
 * These test the Qdrant primitives that our store classes depend on:
 * collection lifecycle, named vectors, filtered search, tenant isolation, and deletion.
 */
describe("Qdrant stores — unit tests", () => {
  // -------------------------------------------------------------------------
  // Connectivity check — skip entire suite if Qdrant is unreachable
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    client = new QdrantClient({ url: QDRANT_URL });
    try {
      await client.versionInfo();
    } catch {
      throw new Error(
        `Qdrant is not reachable at ${QDRANT_URL}. Start Qdrant before running these tests.`,
      );
    }
  }, 10000);

  afterAll(async () => {
    // Clean up — delete the test collection
    try {
      await client.deleteCollection(TEST_COLLECTION);
    } catch {
      // collection may not exist if tests failed early
    }
  }, 10000);

  // =========================================================================
  // 1. Collection Management
  // =========================================================================

  describe("collection management", () => {
    it("should create a collection with named vectors (dim_384, dim_1536)", async () => {
      // Arrange
      const vectors = {
        dim_384: { size: 384, distance: "Cosine" as const },
        dim_1536: { size: 1536, distance: "Cosine" as const },
      };

      // Act
      const result = await client.createCollection(TEST_COLLECTION, { vectors });

      // Assert
      expect(result).toBe(true);
    }, 10000);

    it("should create payload indexes for tenant_id, knowledge_base_id, and document_id", async () => {
      // Act — create all payload indexes our stores use.
      // createPayloadIndex returns an operation result with status "acknowledged" or "completed".
      const tenantResult = await client.createPayloadIndex(TEST_COLLECTION, {
        field_name: "tenant_id",
        field_schema: { type: "keyword", is_tenant: true },
      });
      expect(tenantResult).toHaveProperty("status");

      const kbResult = await client.createPayloadIndex(TEST_COLLECTION, {
        field_name: "knowledge_base_id",
        field_schema: "keyword",
      });
      expect(kbResult).toHaveProperty("status");

      const docResult = await client.createPayloadIndex(TEST_COLLECTION, {
        field_name: "document_id",
        field_schema: "keyword",
      });
      expect(docResult).toHaveProperty("status");

      // Verify at least tenant_id is visible in the schema (keyword indexes
      // may appear lazily in payload_schema until points are inserted)
      const info = await client.getCollection(TEST_COLLECTION);
      const indexedFields = Object.keys(info.payload_schema || {});
      expect(indexedFields).toContain("tenant_id");
    }, 10000);

    it("should list collections and find the test collection", async () => {
      // Act
      const { collections } = await client.getCollections();

      // Assert
      const names = collections.map((c) => c.name);
      expect(names).toContain(TEST_COLLECTION);
    }, 10000);
  });

  // =========================================================================
  // 2. Upsert + Search
  // =========================================================================

  describe("upsert and search", () => {
    const seed384 = [10, 20, 30, 40, 50];
    const points384 = seed384.map((seed, idx) => ({
      id: idx + 1,
      vector: { dim_384: normalizedVector(384, seed) },
      payload: {
        tenant_id: TENANT_A,
        knowledge_base_id: KB_ID_1,
        document_id: DOC_ID_1,
        chunk_type: idx === 0 ? "summary" : "standard",
        chunk_index: idx,
        content: `Test chunk ${idx} about topic ${seed}`,
        file_name: "test-doc.md",
      },
    }));

    it("should upsert 5 points with dim_384 vectors and tenant payload", async () => {
      // Act
      await client.upsert(TEST_COLLECTION, { wait: true, points: points384 });

      // Assert — count points in collection
      const countResult = await client.count(TEST_COLLECTION, { exact: true });
      expect(countResult.count).toBe(5);
    }, 10000);

    it("should search by vector and return results sorted by score", async () => {
      // Arrange — search with the vector of point 1 (should match itself best)
      const queryVector = normalizedVector(384, 10);

      // Act
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: queryVector },
        limit: 5,
        with_payload: true,
        with_vector: false,
      });

      // Assert
      expect(results.length).toBeGreaterThan(0);
      // Scores should be in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
      // Top result should be the exact vector we searched with (score ~1.0)
      expect(results[0].score).toBeGreaterThan(0.99);
    }, 10000);

    it("should filter search by tenant_id and return only matching tenant's points", async () => {
      // Act
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "tenant_id", match: { value: TENANT_A } }],
        },
        limit: 10,
        with_payload: true,
      });

      // Assert — all results belong to TENANT_A
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        const p = r.payload as Record<string, unknown>;
        expect(p.tenant_id).toBe(TENANT_A);
      }
    }, 10000);

    it("should return empty results when filtering by wrong tenant_id (tenant isolation)", async () => {
      // Act — search with a tenant that has no points
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "tenant_id", match: { value: "nonexistent_tenant" } }],
        },
        limit: 10,
        with_payload: true,
      });

      // Assert
      expect(results).toHaveLength(0);
    }, 10000);

    it("should filter by knowledge_base_id correctly", async () => {
      // Act
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "knowledge_base_id", match: { value: KB_ID_1 } }],
        },
        limit: 10,
        with_payload: true,
      });

      // Assert
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        const p = r.payload as Record<string, unknown>;
        expect(p.knowledge_base_id).toBe(KB_ID_1);
      }

      // Search for a KB that doesn't exist
      const empty = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "knowledge_base_id", match: { value: "kb_nonexistent" } }],
        },
        limit: 10,
      });
      expect(empty).toHaveLength(0);
    }, 10000);

    it("should respect score_threshold and exclude low-score results", async () => {
      // Arrange — use a random vector that is unlikely to match well
      const dissimilarVector = normalizedVector(384, 99999);

      // Act — search with a very high threshold
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: dissimilarVector },
        limit: 10,
        score_threshold: 0.99,
        with_payload: true,
      });

      // Assert — with a random vector and high threshold, most/all results should be excluded
      // Each result that IS returned must meet the threshold
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.99);
      }
    }, 10000);

    it("should upsert points with dim_1536 alongside existing dim_384 points", async () => {
      // Arrange
      const points1536 = [
        {
          id: 100,
          vector: { dim_1536: normalizedVector(1536, 100) },
          payload: {
            tenant_id: TENANT_A,
            knowledge_base_id: KB_ID_2,
            document_id: DOC_ID_2,
            chunk_type: "standard",
            chunk_index: 0,
            content: "Large embedding test chunk",
            file_name: "large-embed.md",
          },
        },
        {
          id: 101,
          vector: { dim_1536: normalizedVector(1536, 101) },
          payload: {
            tenant_id: TENANT_A,
            knowledge_base_id: KB_ID_2,
            document_id: DOC_ID_2,
            chunk_type: "standard",
            chunk_index: 1,
            content: "Another large embedding chunk",
            file_name: "large-embed.md",
          },
        },
      ];

      // Act
      await client.upsert(TEST_COLLECTION, { wait: true, points: points1536 });

      // Assert
      const countResult = await client.count(TEST_COLLECTION, { exact: true });
      expect(countResult.count).toBe(7); // 5 dim_384 + 2 dim_1536
    }, 10000);

    it("should search dim_1536 and return correct dimension results", async () => {
      // Act
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_1536", vector: normalizedVector(1536, 100) },
        filter: {
          must: [{ key: "knowledge_base_id", match: { value: KB_ID_2 } }],
        },
        limit: 5,
        with_payload: true,
      });

      // Assert
      expect(results.length).toBe(2);
      expect(results[0].score).toBeGreaterThan(0.99); // exact match
      const payload = results[0].payload as Record<string, unknown>;
      expect(payload.knowledge_base_id).toBe(KB_ID_2);
    }, 10000);
  });

  // =========================================================================
  // 3. Delete
  // =========================================================================

  describe("delete", () => {
    it("should delete points by document_id filter", async () => {
      // Arrange — verify points exist before deletion
      const beforeCount = await client.count(TEST_COLLECTION, {
        exact: true,
        filter: {
          must: [{ key: "document_id", match: { value: DOC_ID_2 } }],
        },
      });
      expect(beforeCount.count).toBe(2);

      // Act
      await client.delete(TEST_COLLECTION, {
        wait: true,
        filter: {
          must: [{ key: "document_id", match: { value: DOC_ID_2 } }],
        },
      });

      // Assert
      const afterCount = await client.count(TEST_COLLECTION, {
        exact: true,
        filter: {
          must: [{ key: "document_id", match: { value: DOC_ID_2 } }],
        },
      });
      expect(afterCount.count).toBe(0);
    }, 10000);

    it("should not find deleted points in search results", async () => {
      // Act — search for the deleted document's KB
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_1536", vector: normalizedVector(1536, 100) },
        filter: {
          must: [{ key: "document_id", match: { value: DOC_ID_2 } }],
        },
        limit: 10,
        with_payload: true,
      });

      // Assert
      expect(results).toHaveLength(0);
    }, 10000);

    it("should not error when deleting nonexistent points", async () => {
      // Act — delete by a filter that matches nothing
      await expect(
        client.delete(TEST_COLLECTION, {
          wait: true,
          filter: {
            must: [{ key: "document_id", match: { value: "nonexistent_doc_id" } }],
          },
        }),
      ).resolves.not.toThrow();
    }, 10000);
  });

  // =========================================================================
  // 4. Edge Cases
  // =========================================================================

  describe("edge cases", () => {
    it("should return empty results when searching an empty filter match (not error)", async () => {
      // Act — search with a filter that matches no points
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 1) },
        filter: {
          must: [{ key: "tenant_id", match: { value: "absolutely_no_match" } }],
        },
        limit: 10,
      });

      // Assert
      expect(results).toEqual([]);
    }, 10000);

    it("should handle upsert with wrong dimension vector gracefully (error)", async () => {
      // Arrange — try to upsert a 10-dim vector into a 384-dim named vector
      const badPoint = {
        id: 999,
        vector: { dim_384: [0.1, 0.2, 0.3] }, // only 3 dims instead of 384
        payload: { tenant_id: "bad" },
      };

      // Act & Assert
      await expect(
        client.upsert(TEST_COLLECTION, { wait: true, points: [badPoint] }),
      ).rejects.toThrow();
    }, 10000);

    it("should reject search with limit 0 (Qdrant requires limit >= 1)", async () => {
      // Act & Assert — Qdrant returns 422 Unprocessable Entity for limit: 0
      await expect(
        client.search(TEST_COLLECTION, {
          vector: { name: "dim_384", vector: normalizedVector(384, 10) },
          limit: 0,
        }),
      ).rejects.toThrow();
    }, 10000);
  });

  // =========================================================================
  // 5. Multi-Tenancy
  // =========================================================================

  describe("multi-tenancy", () => {
    beforeAll(async () => {
      // Upsert points for TENANT_B
      const tenantBPoints = [
        {
          id: 200,
          vector: { dim_384: normalizedVector(384, 200) },
          payload: {
            tenant_id: TENANT_B,
            knowledge_base_id: "kb_b_001",
            document_id: "doc_b_001",
            chunk_type: "standard",
            chunk_index: 0,
            content: "Tenant B content alpha",
            file_name: "tenant-b.md",
          },
        },
        {
          id: 201,
          vector: { dim_384: normalizedVector(384, 201) },
          payload: {
            tenant_id: TENANT_B,
            knowledge_base_id: "kb_b_001",
            document_id: "doc_b_001",
            chunk_type: "standard",
            chunk_index: 1,
            content: "Tenant B content beta",
            file_name: "tenant-b.md",
          },
        },
      ];

      await client.upsert(TEST_COLLECTION, { wait: true, points: tenantBPoints });
    }, 10000);

    it("should return only tenant_a results when searching as tenant_a", async () => {
      // Act
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "tenant_id", match: { value: TENANT_A } }],
        },
        limit: 20,
        with_payload: true,
      });

      // Assert
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        const p = r.payload as Record<string, unknown>;
        expect(p.tenant_id).toBe(TENANT_A);
      }
    }, 10000);

    it("should return only tenant_b results when searching as tenant_b", async () => {
      // Act
      const results = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 200) },
        filter: {
          must: [{ key: "tenant_id", match: { value: TENANT_B } }],
        },
        limit: 20,
        with_payload: true,
      });

      // Assert
      expect(results.length).toBe(2);
      for (const r of results) {
        const p = r.payload as Record<string, unknown>;
        expect(p.tenant_id).toBe(TENANT_B);
      }
      // Top result should be an exact match
      expect(results[0].score).toBeGreaterThan(0.99);
    }, 10000);

    it("should ensure tenant_a search scores are independent of tenant_b data", async () => {
      // Arrange — search as tenant_a with tenant_a's vector
      const resultsA = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "tenant_id", match: { value: TENANT_A } }],
        },
        limit: 5,
        with_payload: true,
      });

      // Search as tenant_b with the SAME vector
      const resultsB = await client.search(TEST_COLLECTION, {
        vector: { name: "dim_384", vector: normalizedVector(384, 10) },
        filter: {
          must: [{ key: "tenant_id", match: { value: TENANT_B } }],
        },
        limit: 5,
        with_payload: true,
      });

      // Assert — tenant_a gets its own results, tenant_b gets its own
      expect(resultsA.length).toBeGreaterThan(0);
      expect(resultsB.length).toBeGreaterThan(0);

      const idsA = new Set(resultsA.map((r) => r.id));
      const idsB = new Set(resultsB.map((r) => r.id));

      // No overlap between tenant results
      for (const id of idsA) {
        expect(idsB.has(id)).toBe(false);
      }
    }, 10000);
  });
});
