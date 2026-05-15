/**
 * GraphRAG Entity Extraction
 *
 * At indexing time, for each chunk, an LLM extracts entities (concepts, APIs,
 * tools, people, etc.) and relationships between them. These are stored in
 * graph_entities / graph_relationships and used for query-time graph expansion.
 */

import type { LLMCaller } from "./hyde";

export interface ExtractedEntity {
  name: string;
  entityType: string;
  description: string;
}

export interface ExtractedRelationship {
  source: string;
  target: string;
  relationshipType: string;
  description: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

const ENTITY_EXTRACTION_PROMPT = `Extract entities and relationships from this text chunk.

Chunk:
{CHUNK_TEXT}

Document context: {DOCUMENT_NAME}

Extract:
1. Named entities (concepts, features, APIs, configurations, people, tools)
2. Relationships between entities

Respond as JSON:
{
  "entities": [
    {"name": "middleware", "type": "concept", "description": "Request interceptor in Next.js"},
    {"name": "App Router", "type": "feature", "description": "File-system based routing in Next.js"}
  ],
  "relationships": [
    {"source": "middleware", "target": "App Router", "type": "integrates_with",
     "description": "Middleware intercepts requests before App Router handles them"}
  ]
}`;

function buildExtractionPrompt(chunkText: string, documentName: string): string {
  return ENTITY_EXTRACTION_PROMPT
    .replace("{CHUNK_TEXT}", chunkText)
    .replace("{DOCUMENT_NAME}", documentName);
}

/**
 * Extract entities and relationships from a single chunk using an LLM.
 * On failure (LLM error, malformed JSON), returns empty entities/relationships.
 */
export async function extractEntitiesFromChunk(
  chunkText: string,
  documentName: string,
  llmCaller: LLMCaller,
): Promise<ExtractionResult> {
  try {
    const prompt = buildExtractionPrompt(chunkText, documentName);
    const response = await llmCaller.call(prompt, {
      maxTokens: 1000,
      temperature: 0.0,
    });

    if (!response || response.trim().length === 0) {
      return { entities: [], relationships: [] };
    }

    const parsed = parseExtractionResponse(response);
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Graph entity extraction failed: ${message}`);
    return { entities: [], relationships: [] };
  }
}

/**
 * Parse the LLM JSON response into entities and relationships.
 * Handles malformed JSON gracefully by attempting to extract the JSON
 * object from a potentially wrapped response.
 */
function parseExtractionResponse(response: string): ExtractionResult {
  // Try to find JSON object in response (LLM may wrap in markdown code blocks)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { entities: [], relationships: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
    const rawRelationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];

    const entities: ExtractedEntity[] = rawEntities
      .filter((e): e is Record<string, unknown> =>
        typeof e === "object" && e !== null &&
        typeof (e as Record<string, unknown>).name === "string" &&
        typeof (e as Record<string, unknown>).type === "string"
      )
      .map((e) => ({
        name: String(e.name).trim(),
        entityType: String(e.type).trim(),
        description: typeof e.description === "string" ? e.description.trim() : "",
      }))
      .filter((e) => e.name.length > 0 && e.entityType.length > 0);

    const relationships: ExtractedRelationship[] = rawRelationships
      .filter((r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null &&
        typeof (r as Record<string, unknown>).source === "string" &&
        typeof (r as Record<string, unknown>).target === "string" &&
        typeof (r as Record<string, unknown>).type === "string"
      )
      .map((r) => ({
        source: String(r.source).trim(),
        target: String(r.target).trim(),
        relationshipType: String(r.type).trim(),
        description: typeof r.description === "string" ? r.description.trim() : "",
      }))
      .filter((r) => r.source.length > 0 && r.target.length > 0 && r.relationshipType.length > 0);

    return { entities, relationships };
  } catch {
    return { entities: [], relationships: [] };
  }
}
