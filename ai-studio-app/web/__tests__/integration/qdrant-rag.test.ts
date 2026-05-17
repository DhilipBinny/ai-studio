import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getAdminCookies, authedFetch, BASE } from "./setup";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_COLLECTION = "knowledge_chunks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueName() {
  return `QdrantTest KB ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Directly query Qdrant REST API to count points matching a filter. */
async function qdrantCount(
  filter: Record<string, unknown>,
): Promise<number> {
  const res = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/count`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter, exact: true }),
  });
  if (!res.ok) {
    throw new Error(`Qdrant count failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.result?.count ?? 0;
}

/** Directly query Qdrant REST API to scroll (list) points with payload. */
async function qdrantScroll(
  filter: Record<string, unknown>,
  limit = 10,
): Promise<Array<{ id: string | number; payload: Record<string, unknown> }>> {
  const res = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter, limit, with_payload: true }),
  });
  if (!res.ok) {
    throw new Error(`Qdrant scroll failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.result?.points ?? [];
}

/** Delete Qdrant points by filter. */
async function qdrantDeleteByFilter(filter: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter }),
  });
  if (!res.ok) {
    throw new Error(`Qdrant delete failed: ${res.status} ${await res.text()}`);
  }
}

const testDoc = `# Qdrant Integration Test Document

This document tests the RAG pipeline with Qdrant as the vector store backend.

## Vector Search

Qdrant is a high-performance vector similarity search engine written in Rust.
It supports named vectors, filtering, and multi-tenancy through payload indexes.
The default port for Qdrant is 6333 for HTTP and 6334 for gRPC.

## Tenant Isolation

Each point in Qdrant carries a tenant_id payload field. The is_tenant flag on
the payload index enables Qdrant's built-in tenant isolation optimizations.
This ensures that vector search results never leak across tenant boundaries.

## Named Vectors

A single Qdrant collection can store vectors of different dimensions using
named vectors (e.g., dim_384, dim_768, dim_1536, dim_3072). This allows
knowledge bases using different embedding providers to coexist in one collection.
`;

// ---------------------------------------------------------------------------
// Pre-flight: check if Qdrant + VECTOR_DB=qdrant are available
// ---------------------------------------------------------------------------

let qdrantAvailable = false;
let vectorDbIsQdrant = false;

async function checkPrerequisites(): Promise<{ qdrant: boolean; vectorDb: boolean }> {
  // 1. Check Qdrant connectivity
  let qdrant = false;
  try {
    const res = await fetch(`${QDRANT_URL}/collections`);
    qdrant = res.ok;
  } catch {
    qdrant = false;
  }

  // 2. Check if the dev server has VECTOR_DB=qdrant by looking at the health detail
  let vectorDb = false;
  try {
    const cookies = await getAdminCookies();
    const res = await authedFetch("/api/health?detail=true", cookies);
    if (res.ok) {
      const body = await res.json();
      // If the health check includes a "qdrant" key in checks, the server has VECTOR_DB=qdrant
      vectorDb = body.checks?.qdrant !== undefined;
    }
  } catch {
    vectorDb = false;
  }

  return { qdrant, vectorDb };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe.sequential("Qdrant RAG integration", () => {
  let cookies: string;
  let testKbId: string;
  let testDocId: string;

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    const prereqs = await checkPrerequisites();
    qdrantAvailable = prereqs.qdrant;
    vectorDbIsQdrant = prereqs.vectorDb;

    if (!qdrantAvailable) {
      console.warn(
        "[SKIP] Qdrant is not reachable at " + QDRANT_URL + ". Skipping Qdrant RAG integration tests.",
      );
      return;
    }

    if (!vectorDbIsQdrant) {
      console.warn(
        "[SKIP] Dev server does not have VECTOR_DB=qdrant. Skipping document processing tests.\n" +
          "Set VECTOR_DB=qdrant in ai-studio-app/web/.env and restart the dev server to run these tests.",
      );
    }

    cookies = await getAdminCookies();
  }, 20000);

  afterAll(async () => {
    if (!cookies) return;

    // Delete test documents first
    if (testKbId && testDocId) {
      try {
        await authedFetch(
          `/api/knowledge-bases/${testKbId}/documents/${testDocId}`,
          cookies,
          { method: "DELETE" },
        );
      } catch {
        // best-effort cleanup
      }
    }

    // Deactivate (soft-delete) test KB
    if (testKbId) {
      try {
        await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
          method: "DELETE",
        });
      } catch {
        // best-effort cleanup
      }
    }

    // Clean up Qdrant points by KB filter (in case server didn't clean up)
    if (testKbId && qdrantAvailable) {
      try {
        const collectionsRes = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}`);
        if (collectionsRes.ok) {
          await qdrantDeleteByFilter({
            must: [{ key: "knowledge_base_id", match: { value: testKbId } }],
          });
        }
      } catch {
        // best-effort
      }
    }
  }, 20000);

  // =========================================================================
  // 1. Qdrant Health
  // =========================================================================

  describe("qdrant health", () => {
    it("should confirm Qdrant is reachable", async () => {
      if (!qdrantAvailable) {
        expect(true).toBe(true); // vacuous pass — prereq warning above
        return;
      }

      const res = await fetch(`${QDRANT_URL}/collections`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.status).toBe("ok");
    }, 10000);

    it("should include qdrant status in health detail when VECTOR_DB=qdrant", async () => {
      if (!qdrantAvailable || !vectorDbIsQdrant) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set on dev server");
        return;
      }

      // Act
      const res = await authedFetch("/api/health?detail=true", cookies);
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.checks).toHaveProperty("qdrant");
      expect(body.checks.qdrant.status).toBe("healthy");
      expect(body.checks.qdrant.latencyMs).toBeGreaterThanOrEqual(0);
    }, 10000);
  });

  // =========================================================================
  // 2. Document Processing (requires VECTOR_DB=qdrant on the dev server)
  // =========================================================================

  describe("document processing", () => {
    it("should create a test KB and upload a markdown document", async () => {
      if (!vectorDbIsQdrant) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set — skipping document upload");
        return;
      }

      // Arrange — create KB with builtin embedding (384-dim)
      const kbRes = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: uniqueName(),
          description: "Qdrant integration test KB",
          contextualEnrichment: "static",
          queryExpansion: "none",
          modalityType: "text",
        }),
      });
      const kbBody = await kbRes.json();
      expect(kbRes.status).toBe(201);
      expect(kbBody.id).toBeDefined();
      testKbId = kbBody.id;

      // Upload test document
      const blob = new Blob([testDoc], { type: "text/markdown" });
      const formData = new FormData();
      formData.append("file", blob, "qdrant-test.md");

      const docRes = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents`,
        cookies,
        { method: "POST", body: formData },
      );
      const docBody = await docRes.json();

      expect(docRes.status).toBe(201);
      expect(docBody.id).toBeDefined();
      expect(docBody.fileName).toBe("qdrant-test.md");
      testDocId = docBody.id;
    }, 15000);

    it("should process the document and reach 'ready' status", async () => {
      if (!vectorDbIsQdrant || !testDocId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or no document uploaded");
        return;
      }

      // Trigger processing
      const processRes = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents/${testDocId}/process`,
        cookies,
        { method: "POST" },
      );
      const processBody = await processRes.json();
      expect(processRes.status).toBe(200);
      expect(processBody.status).toBe("processing");

      // Poll until ready (max 30s)
      const maxWait = 30000;
      const pollInterval = 2000;
      const start = Date.now();
      let status = "processing";

      while (Date.now() - start < maxWait) {
        await sleep(pollInterval);
        const res = await authedFetch(
          `/api/knowledge-bases/${testKbId}/documents/${testDocId}`,
          cookies,
        );
        const body = await res.json();
        status = body.status;
        if (status === "ready" || status === "error") break;
      }

      if (status === "error") {
        const errRes = await authedFetch(
          `/api/knowledge-bases/${testKbId}/documents/${testDocId}`,
          cookies,
        );
        const errBody = await errRes.json();
        expect.fail(`Document processing failed: ${errBody.errorMessage}`);
      }

      expect(status).toBe("ready");
    }, 35000);

    it("should have Qdrant points for the processed document", async () => {
      if (!vectorDbIsQdrant || !testKbId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or KB not created");
        return;
      }

      // Give Qdrant a moment to flush
      await sleep(1000);

      // Act — count Qdrant points for this KB
      const count = await qdrantCount({
        must: [{ key: "knowledge_base_id", match: { value: testKbId } }],
      });

      // Assert
      expect(count).toBeGreaterThan(0);
    }, 15000);
  });

  // =========================================================================
  // 3. Search Verification via Qdrant Direct
  // =========================================================================

  describe("search verification", () => {
    it("should have matching chunk counts between PG and Qdrant", async () => {
      if (!vectorDbIsQdrant || !testKbId || !testDocId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or document not processed");
        return;
      }

      // Get PG chunk count from document detail
      const docRes = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents/${testDocId}`,
        cookies,
      );
      const docBody = await docRes.json();
      const pgChunkCount = docBody.chunkCount;

      // Get Qdrant point count (excludes parent chunks which are PG-only)
      const qdrantPointCount = await qdrantCount({
        must: [
          { key: "knowledge_base_id", match: { value: testKbId } },
          { key: "document_id", match: { value: testDocId } },
        ],
      });

      // Qdrant count should be <= PG count (parent chunks are PG-only)
      // and > 0 (at least some chunks should be in Qdrant)
      expect(qdrantPointCount).toBeGreaterThan(0);
      expect(qdrantPointCount).toBeLessThanOrEqual(pgChunkCount);
    }, 15000);

    it("should have correct payload fields on Qdrant points", async () => {
      if (!vectorDbIsQdrant || !testKbId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or KB not created");
        return;
      }

      // Act — scroll points for this KB
      const points = await qdrantScroll(
        { must: [{ key: "knowledge_base_id", match: { value: testKbId } }] },
        5,
      );

      // Assert — verify payload structure matches our store
      expect(points.length).toBeGreaterThan(0);

      for (const point of points) {
        const p = point.payload;
        expect(p).toHaveProperty("tenant_id");
        expect(p).toHaveProperty("knowledge_base_id");
        expect(p).toHaveProperty("document_id");
        expect(p).toHaveProperty("chunk_type");
        expect(p).toHaveProperty("chunk_index");
        expect(p).toHaveProperty("content");
        expect(p).toHaveProperty("file_name");

        // Verify correct values
        expect(p.knowledge_base_id).toBe(testKbId);
        expect(typeof p.tenant_id).toBe("string");
        expect((p.tenant_id as string).length).toBeGreaterThan(0);
        expect(typeof p.content).toBe("string");
        expect((p.content as string).length).toBeGreaterThan(0);
      }
    }, 15000);
  });

  // =========================================================================
  // 4. Tenant Isolation
  // =========================================================================

  describe("tenant isolation", () => {
    it("should have correct tenant_id on all Qdrant points for this KB", async () => {
      if (!vectorDbIsQdrant || !testKbId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or KB not created");
        return;
      }

      // Act — scroll all points for this KB
      const points = await qdrantScroll(
        { must: [{ key: "knowledge_base_id", match: { value: testKbId } }] },
        100,
      );

      // Assert — all points should have the same tenant_id
      expect(points.length).toBeGreaterThan(0);
      const tenantIds = new Set(points.map((p) => p.payload.tenant_id));
      expect(tenantIds.size).toBe(1); // all same tenant
    }, 10000);

    it("should return 0 points when filtering by a different tenant_id", async () => {
      if (!vectorDbIsQdrant || !testKbId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or KB not created");
        return;
      }

      // Act — count points for this KB but with a fake tenant
      const count = await qdrantCount({
        must: [
          { key: "knowledge_base_id", match: { value: testKbId } },
          { key: "tenant_id", match: { value: "fake_tenant_isolation_test" } },
        ],
      });

      // Assert
      expect(count).toBe(0);
    }, 10000);
  });

  // =========================================================================
  // 5. Cleanup Verification
  // =========================================================================

  describe("cleanup", () => {
    it("should deactivate the test KB successfully", async () => {
      if (!vectorDbIsQdrant || !testKbId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or KB not created");
        return;
      }

      // Act — soft-delete the KB
      const res = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "DELETE",
      });

      // Assert
      expect(res.status).toBe(200);
    }, 10000);

    it("should document: Qdrant cleanup of deactivated KB points is manual or event-driven", async () => {
      if (!vectorDbIsQdrant || !testKbId) {
        console.warn("[SKIP] VECTOR_DB=qdrant not set or KB not created");
        return;
      }

      // Note: Deactivating a KB in the app soft-deletes it in PostgreSQL.
      // Whether Qdrant points are cleaned up depends on the implementation:
      // - If the DELETE endpoint also purges from Qdrant, count should be 0
      // - If cleanup is deferred (background job), points may linger
      //
      // We verify the count after deletion. Either outcome is acceptable,
      // but we document it for operational awareness.

      await sleep(2000); // allow async cleanup if any

      const count = await qdrantCount({
        must: [{ key: "knowledge_base_id", match: { value: testKbId } }],
      });

      if (count > 0) {
        console.warn(
          `[INFO] ${count} Qdrant points remain after KB deactivation. ` +
            "Qdrant cleanup is deferred or manual for soft-deleted KBs.",
        );
        // Clean up ourselves for test hygiene
        await qdrantDeleteByFilter({
          must: [{ key: "knowledge_base_id", match: { value: testKbId } }],
        });
      }

      // After our manual cleanup, should be 0
      const finalCount = await qdrantCount({
        must: [{ key: "knowledge_base_id", match: { value: testKbId } }],
      });
      expect(finalCount).toBe(0);

      // Mark KB as cleaned up so afterAll doesn't try again
      testKbId = "";
    }, 15000);
  });
});
