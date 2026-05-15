import { describe, it, expect, vi } from "vitest";
import { extractEntitiesFromChunk } from "../src/graph-extraction";
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

describe("extractEntitiesFromChunk()", () => {
  describe("happy path", () => {
    it("should parse valid JSON with entities and relationships", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "middleware", type: "concept", description: "Request interceptor" },
          { name: "App Router", type: "feature", description: "File-based routing" },
        ],
        relationships: [
          {
            source: "middleware",
            target: "App Router",
            type: "integrates_with",
            description: "Middleware intercepts before routing",
          },
        ],
      }));

      const result = await extractEntitiesFromChunk(
        "Middleware handles requests before App Router processes them.",
        "architecture.md",
        llm,
      );

      expect(result.entities).toHaveLength(2);
      expect(result.entities[0]).toEqual({
        name: "middleware",
        entityType: "concept",
        description: "Request interceptor",
      });
      expect(result.entities[1]).toEqual({
        name: "App Router",
        entityType: "feature",
        description: "File-based routing",
      });
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0]).toEqual({
        source: "middleware",
        target: "App Router",
        relationshipType: "integrates_with",
        description: "Middleware intercepts before routing",
      });
    });

    it("should capture multiple entities with different types", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "PostgreSQL", type: "database", description: "Relational DB" },
          { name: "pgvector", type: "extension", description: "Vector similarity" },
          { name: "Drizzle", type: "orm", description: "TypeScript ORM" },
        ],
        relationships: [],
      }));

      const result = await extractEntitiesFromChunk(
        "PostgreSQL with pgvector extension, accessed via Drizzle ORM.",
        "stack.md",
        llm,
      );

      expect(result.entities).toHaveLength(3);
      const types = result.entities.map((e) => e.entityType);
      expect(types).toContain("database");
      expect(types).toContain("extension");
      expect(types).toContain("orm");
    });

    it("should parse relationships that reference extracted entity names", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "Agent", type: "concept", description: "AI agent" },
          { name: "Tool", type: "concept", description: "Agent capability" },
        ],
        relationships: [
          {
            source: "Agent",
            target: "Tool",
            type: "uses",
            description: "Agent invokes tools",
          },
        ],
      }));

      const result = await extractEntitiesFromChunk(
        "An Agent uses Tools to perform actions.",
        "agents.md",
        llm,
      );

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].source).toBe("Agent");
      expect(result.relationships[0].target).toBe("Tool");
      expect(result.relationships[0].relationshipType).toBe("uses");
    });
  });

  describe("edge cases", () => {
    it("should return empty entities and relationships when LLM returns empty arrays", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [],
        relationships: [],
      }));

      const result = await extractEntitiesFromChunk("Some text.", "doc.md", llm);

      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);
    });

    it("should return empty relationships when LLM returns entities but no relationships", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "Redis", type: "cache", description: "In-memory store" },
        ],
        relationships: [],
      }));

      const result = await extractEntitiesFromChunk("Redis is used for caching.", "infra.md", llm);

      expect(result.entities).toHaveLength(1);
      expect(result.relationships).toEqual([]);
    });

    it("should filter out entities with whitespace-only name or type while keeping valid entities", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "  ", type: "concept", description: "Whitespace-only name" },
          { name: "Redis", type: "   ", description: "Whitespace-only type" },
          { name: "\t\n", type: "\t", description: "Tabs and newlines" },
          { name: "Valid Entity", type: "feature", description: "This one is valid" },
        ],
        relationships: [],
      }));

      const result = await extractEntitiesFromChunk(
        "Some text with entities.",
        "doc.md",
        llm,
      );

      // After trimming, whitespace-only names/types become "" and get filtered
      // Only "Valid Entity" should survive the filter
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("Valid Entity");
      expect(result.entities[0].entityType).toBe("feature");
    });

    it("should still work with very short chunk text (10 chars)", async () => {
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "API", type: "concept", description: "Application interface" },
        ],
        relationships: [],
      }));

      const result = await extractEntitiesFromChunk("API calls.", "doc.md", llm);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("API");
    });
  });

  describe("error cases", () => {
    it("should return empty entities and relationships when LLM throws", async () => {
      const llm = throwingLLMCaller(new Error("API timeout"));

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await extractEntitiesFromChunk(
        "Some text about entities.",
        "doc.md",
        llm,
      );

      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);

      vi.restoreAllMocks();
    });

    it("should return empty result when LLM returns invalid JSON", async () => {
      const llm = mockLLMCaller("This is not valid JSON at all.");

      const result = await extractEntitiesFromChunk("Some chunk.", "doc.md", llm);

      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);
    });

    it("should strip markdown code fences and parse the JSON inside", async () => {
      const jsonPayload = JSON.stringify({
        entities: [
          { name: "Embedder", type: "component", description: "Creates embeddings" },
        ],
        relationships: [],
      });
      const llm = mockLLMCaller("```json\n" + jsonPayload + "\n```");

      const result = await extractEntitiesFromChunk("Embedder service.", "doc.md", llm);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("Embedder");
      expect(result.entities[0].entityType).toBe("component");
    });
  });

  describe("security", () => {
    it("should not crash on chunk text with injection-like content", async () => {
      const injectionText = '"; DROP TABLE entities; -- <script>alert("xss")</script>';
      const llm = mockLLMCaller(JSON.stringify({
        entities: [
          { name: "SQL", type: "language", description: "Query language" },
        ],
        relationships: [],
      }));

      const result = await extractEntitiesFromChunk(injectionText, "doc.md", llm);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe("SQL");
    });
  });
});
