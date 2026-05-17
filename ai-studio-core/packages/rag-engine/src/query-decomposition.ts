/**
 * Query Decomposition — Break complex queries into simpler sub-queries
 *
 * Before searching, an LLM analyzes the query to determine if it should be
 * decomposed into multiple sub-queries for better retrieval. Each sub-query
 * is then searched independently, and results are merged.
 *
 * Simple queries pass through unchanged. On any failure, the original query
 * is returned as a single-item array (safe fallback).
 */

import type { LLMCaller } from "./hyde";

export interface DecompositionResult {
  shouldDecompose: boolean;
  subQueries: string[];
  reasoning: string;
}

const DECOMPOSITION_PROMPT_TEMPLATE = `Analyze this search query and determine if it should be broken into simpler sub-queries
for better retrieval from a document knowledge base.

Query: {USER_QUERY}

Rules:
- Only decompose if the query contains multiple distinct information needs
- Simple queries should NOT be decomposed (return the original)
- Maximum 3 sub-queries
- Each sub-query should be self-contained and searchable

Respond as JSON:
{
  "shouldDecompose": true,
  "subQueries": ["sub-query 1", "sub-query 2", "sub-query 3"],
  "reasoning": "This query asks about two topics: middleware and caching, plus their interaction"
}

If the query is simple enough to search directly:
{
  "shouldDecompose": false,
  "subQueries": ["{original query}"],
  "reasoning": "Single-topic query, no decomposition needed"
}`;

function buildDecompositionPrompt(query: string): string {
  return DECOMPOSITION_PROMPT_TEMPLATE.replace("{USER_QUERY}", query);
}

function fallbackResult(query: string, reasoning: string): DecompositionResult {
  return {
    shouldDecompose: false,
    subQueries: [query],
    reasoning,
  };
}

/**
 * Parse the LLM JSON response, extracting shouldDecompose, subQueries, reasoning.
 * Returns null if the response is not valid.
 */
function parseDecompositionResponse(raw: string): DecompositionResult | null {
  try {
    // Strip markdown code fence if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.shouldDecompose !== "boolean") return null;
    if (!Array.isArray(obj.subQueries)) return null;
    if (obj.subQueries.length === 0) return null;
    if (obj.subQueries.some((q: unknown) => typeof q !== "string" || q === "")) return null;
    if (obj.subQueries.length > 3) {
      // Trim to 3 max
      obj.subQueries = obj.subQueries.slice(0, 3);
    }

    return {
      shouldDecompose: obj.shouldDecompose,
      subQueries: obj.subQueries as string[],
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    };
  } catch {
    return null;
  }
}

/**
 * Decompose a complex query into simpler sub-queries using an LLM.
 *
 * - If the query is empty/whitespace, returns shouldDecompose=false with the original.
 * - If the LLM call fails or returns invalid JSON, returns the original query as fallback.
 * - Maximum 3 sub-queries are returned.
 */
export async function decomposeQuery(
  query: string,
  llmCaller: LLMCaller,
): Promise<DecompositionResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return fallbackResult(query, "Empty query, no decomposition needed");
  }

  try {
    const prompt = buildDecompositionPrompt(trimmed);
    const response = await llmCaller.call(prompt, {
      maxTokens: 300,
      temperature: 0.0,
    });

    if (!response || response.trim().length === 0) {
      console.warn("Query decomposition returned empty response, falling back to original query");
      return fallbackResult(trimmed, "LLM returned empty response");
    }

    const parsed = parseDecompositionResponse(response);
    if (!parsed) {
      console.warn("Query decomposition returned invalid JSON, falling back to original query");
      return fallbackResult(trimmed, "LLM returned invalid JSON");
    }

    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Query decomposition failed, falling back to original query: ${message}`);
    return fallbackResult(trimmed, `LLM call failed: ${message}`);
  }
}
