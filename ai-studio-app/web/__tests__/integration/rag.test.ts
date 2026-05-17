import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getAdminCookies, authedFetch, BASE } from "./setup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueName() {
  return `Test KB ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const testDoc = `# Next.js Routing

Next.js uses a file-system based router where folders are used to define routes.
Each folder represents a route segment that maps to a URL segment.

## Dynamic Routes

Dynamic segments can be created by wrapping a folder name in square brackets: [slug].
For example, a blog post could be accessed at /blog/[slug] where slug is the dynamic segment.

## Middleware

Middleware allows you to run code before a request is completed. It runs on the Edge runtime.
You can modify request and response headers, redirect, or rewrite URLs.
Middleware is defined in a middleware.ts file at the root of the project.
The default port for the Next.js development server is 3000.

## Server Components

Server Components are the default in the App Router. They run on the server and have
zero JavaScript bundle cost. You can use async/await directly in server components.
`;

// ---------------------------------------------------------------------------
// RAG Integration Tests
// ---------------------------------------------------------------------------

describe.sequential("RAG API", () => {
  let cookies: string;
  let testKbId: string;
  let testDocId: string;
  const cleanupKbIds: string[] = [];

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    cookies = await getAdminCookies();

    // Create the primary test KB with new P0-P2 config fields
    const res = await authedFetch("/api/knowledge-bases", cookies, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: uniqueName(),
        description: "Integration test KB for RAG overhaul",
        contextualEnrichment: "static",
        queryExpansion: "none",
        modalityType: "text",
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.id).toBeDefined();
    testKbId = body.id;
    cleanupKbIds.push(testKbId);
  }, 15000);

  afterAll(async () => {
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

    // Deactivate (soft-delete) all test KBs
    for (const id of cleanupKbIds) {
      try {
        await authedFetch(`/api/knowledge-bases/${id}`, cookies, {
          method: "DELETE",
        });
      } catch {
        // best-effort cleanup
      }
    }
  }, 15000);

  // -------------------------------------------------------------------------
  // 1. Knowledge Base Config
  // -------------------------------------------------------------------------

  describe("knowledge base config", () => {
    it("should create KB with all new P0-P2 config fields and return them", async () => {
      // Arrange
      const name = uniqueName();
      const payload = {
        name,
        description: "Full config test",
        contextualEnrichment: "static",
        queryExpansion: "none",
        queryDecomposition: false,
        graphExtraction: false,
        modalityType: "text",
        chunkConfig: {
          method: "recursive",
          chunk_size: 1024,
          chunk_overlap: 100,
        },
      };

      // Act
      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.contextualEnrichment).toBe("static");
      expect(body.queryExpansion).toBe("none");
      expect(body.queryDecomposition).toBe(false);
      expect(body.graphExtraction).toBe(false);
      expect(body.modalityType).toBe("text");
      expect(body.chunkConfig).toMatchObject({
        method: "recursive",
        chunk_size: 1024,
        chunk_overlap: 100,
      });

      cleanupKbIds.push(body.id);
    }, 10000);

    it("should return new config fields in GET KB detail", async () => {
      // Act
      const res = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies);
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.id).toBe(testKbId);
      expect(body).toHaveProperty("contextualEnrichment");
      expect(body).toHaveProperty("queryExpansion");
      expect(body).toHaveProperty("queryDecomposition");
      expect(body).toHaveProperty("graphExtraction");
      expect(body).toHaveProperty("modalityType");
      expect(body).toHaveProperty("documentCount");
    }, 10000);

    it("should update contextualEnrichment to 'llm' via PATCH", async () => {
      // Act
      const res = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextualEnrichment: "llm" }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.contextualEnrichment).toBe("llm");
    }, 10000);

    it("should update queryExpansion to 'hyde' via PATCH", async () => {
      // Act
      const res = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryExpansion: "hyde" }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.queryExpansion).toBe("hyde");
    }, 10000);

    it("should update queryDecomposition to true via PATCH", async () => {
      // Act
      const res = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryDecomposition: true }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.queryDecomposition).toBe(true);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // 2. Document Upload + Processing
  // -------------------------------------------------------------------------

  describe("document upload and processing", () => {
    it("should upload a markdown document to the KB", async () => {
      // Arrange — reset KB back to static enrichment so builtin processing works
      await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextualEnrichment: "static", queryExpansion: "none" }),
      });

      const blob = new Blob([testDoc], { type: "text/markdown" });
      const formData = new FormData();
      formData.append("file", blob, "nextjs-routing.md");

      // Act
      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents`,
        cookies,
        { method: "POST", body: formData },
      );
      const body = await res.json();

      // Assert
      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.fileName).toBe("nextjs-routing.md");
      expect(body.status).toBe("uploaded");

      testDocId = body.id;
    }, 15000);

    it("should start processing the uploaded document", async () => {
      // Arrange — document must exist from previous test
      expect(testDocId).toBeDefined();

      // Act
      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents/${testDocId}/process`,
        cookies,
        { method: "POST" },
      );
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.status).toBe("processing");
    }, 15000);

    it("should finish processing within 30 seconds (poll until ready)", async () => {
      expect(testDocId).toBeDefined();

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

      // Document should be "ready" — if it errored, report the error
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
  });

  // -------------------------------------------------------------------------
  // 3. Document Detail Verification
  // -------------------------------------------------------------------------

  describe("document detail after processing", () => {
    it("should have chunk count > 0 after processing", async () => {
      expect(testDocId).toBeDefined();

      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents/${testDocId}`,
        cookies,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("ready");
      expect(body.chunkCount).toBeGreaterThan(0);
      expect(body.processedAt).toBeDefined();
    }, 10000);

    it("should list the document in the KB document listing", async () => {
      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents`,
        cookies,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.total).toBeGreaterThanOrEqual(1);

      const doc = body.data.find((d: { id: string }) => d.id === testDocId);
      expect(doc).toBeDefined();
      expect(doc.fileName).toBe("nextjs-routing.md");
      expect(doc.status).toBe("ready");
    }, 10000);

    it("should reflect updated documentCount on the KB", async () => {
      const res = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.documentCount).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // 4. New RAG Config Validation
  // -------------------------------------------------------------------------

  describe("config validation", () => {
    it("should reject invalid contextualEnrichment value", async () => {
      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: uniqueName(),
          contextualEnrichment: "invalid",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);

    it("should reject invalid queryExpansion value", async () => {
      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: uniqueName(),
          queryExpansion: "invalid",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);

    it("should reject invalid modalityType value", async () => {
      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: uniqueName(),
          modalityType: "invalid",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);

    it("should accept all valid enum combinations", async () => {
      const name = uniqueName();
      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contextualEnrichment: "llm",
          queryExpansion: "hyde",
          queryDecomposition: true,
          graphExtraction: true,
          modalityType: "multimodal",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.contextualEnrichment).toBe("llm");
      expect(body.queryExpansion).toBe("hyde");
      expect(body.queryDecomposition).toBe(true);
      expect(body.graphExtraction).toBe(true);
      expect(body.modalityType).toBe("multimodal");

      cleanupKbIds.push(body.id);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // 5. Graph Tables Exist
  // -------------------------------------------------------------------------

  describe("graph tables", () => {
    it("should accept graphExtraction config on KB creation", async () => {
      const name = uniqueName();
      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          graphExtraction: true,
          graphExtractionModel: "claude-haiku-4-20250514",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.graphExtraction).toBe(true);
      expect(body.graphExtractionModel).toBe("claude-haiku-4-20250514");

      cleanupKbIds.push(body.id);
    }, 10000);

    it("should toggle graphExtraction via PATCH", async () => {
      // Enable
      const enableRes = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphExtraction: true }),
      });
      expect(enableRes.status).toBe(200);
      const enableBody = await enableRes.json();
      expect(enableBody.graphExtraction).toBe(true);

      // Disable
      const disableRes = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphExtraction: false }),
      });
      expect(disableRes.status).toBe(200);
      const disableBody = await disableRes.json();
      expect(disableBody.graphExtraction).toBe(false);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // 6. Evaluation Endpoint (Validation)
  // -------------------------------------------------------------------------

  describe("evaluation endpoint validation", () => {
    it("should reject evaluate request with missing questions", async () => {
      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/evaluate`,
        cookies,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "00000000-0000-0000-0000-000000000001" }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);

    it("should reject evaluate request with missing agentId", async () => {
      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/evaluate`,
        cookies,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questions: [{ question: "What is routing?" }],
          }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // 7. Edge Cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should return 404 for non-existent KB", async () => {
      const res = await authedFetch(
        "/api/knowledge-bases/00000000-0000-0000-0000-000000000000",
        cookies,
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe("NOT_FOUND");
    }, 10000);

    it("should return 404 for non-existent document in valid KB", async () => {
      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents/00000000-0000-0000-0000-000000000000`,
        cookies,
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe("NOT_FOUND");
    }, 10000);

    it("should reject KB creation with duplicate name", async () => {
      // Get the name of our existing test KB
      const detailRes = await authedFetch(`/api/knowledge-bases/${testKbId}`, cookies);
      const detail = await detailRes.json();

      const res = await authedFetch("/api/knowledge-bases", cookies, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: detail.name }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("NAME_EXISTS");
    }, 10000);

    it("should reject document upload with unsupported file type", async () => {
      const blob = new Blob(["test"], { type: "application/zip" });
      const formData = new FormData();
      formData.append("file", blob, "bad.zip");

      const res = await authedFetch(
        `/api/knowledge-bases/${testKbId}/documents`,
        cookies,
        { method: "POST", body: formData },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("INVALID_FILE_TYPE");
    }, 10000);
  });
});
