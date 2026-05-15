import type { ContextAwareExecutorFn, ToolDefinition, SearchSessionState } from "./types";

export const CONTEXT_EXECUTORS: Record<string, ContextAwareExecutorFn> = {
  knowledge_search: async (args, ctx) => {
    const { searchKnowledge } = await import("../knowledge-search");
    const query = args.query as string;
    if (!query) return "Error: query is required";

    const topK = (args.top_k as number) || 5;
    const results = await searchKnowledge(query, ctx.agentId, ctx.tenantId, { topK });

    if (results.length === 0) return "No relevant documents found for this query.";

    // Initialize search session state for potential refinement
    if (!ctx.searchState) {
      ctx.searchState = { seenChunkIds: new Set(), iterationCount: 0, previousQueries: [] };
    }
    ctx.searchState.previousQueries.push(query);

    // Track returned chunk IDs
    for (const r of results) {
      if (r.chunkId != null) {
        ctx.searchState.seenChunkIds.add(r.chunkId);
      }
    }

    return results.map((r, i) =>
      `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.knowledgeBaseName} / ${r.documentName}]\n${r.content}`
    ).join("\n\n---\n\n");
  },

  knowledge_refine_search: async (args, ctx) => {
    const MAX_ITERATIONS = 3;

    const state: SearchSessionState = ctx.searchState || {
      seenChunkIds: new Set(),
      iterationCount: 0,
      previousQueries: [],
    };

    if (state.iterationCount >= MAX_ITERATIONS) {
      return `Maximum search refinements (${MAX_ITERATIONS}) reached. Work with the results you have.`;
    }

    const query = args.query as string;
    if (!query) return "Error: query is required";

    const reason = args.reason as string;
    if (!reason) return "Error: reason is required";

    state.iterationCount++;
    state.previousQueries.push(query);

    const { searchKnowledge } = await import("../knowledge-search");
    const topK = (args.top_k as number) || 5;
    const results = await searchKnowledge(query, ctx.agentId, ctx.tenantId, { topK });

    // Filter out already-seen chunks
    const freshResults = results.filter((r) => r.chunkId == null || !state.seenChunkIds.has(r.chunkId));

    // Add new chunk IDs to the seen set
    for (const r of freshResults) {
      if (r.chunkId != null) {
        state.seenChunkIds.add(r.chunkId);
      }
    }

    ctx.searchState = state;

    if (freshResults.length === 0) {
      return `No new results found for refined query "${query}". Previous queries: ${state.previousQueries.join(", ")}`;
    }

    return freshResults.map((r, i) =>
      `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.knowledgeBaseName} / ${r.documentName}]\n${r.content}`
    ).join("\n\n---\n\n");
  },
};

export const KNOWLEDGE_SEARCH_DEFINITION: ToolDefinition = {
  name: "knowledge_search",
  description: "Search the agent's assigned knowledge bases for relevant information. Use this when the user asks questions that might be answered by uploaded documents.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query to find relevant document chunks" },
      top_k: { type: "number", description: "Number of results to return (default: 5)" },
    },
    required: ["query"],
  },
};

export const KNOWLEDGE_REFINE_SEARCH_DEFINITION: ToolDefinition = {
  name: "knowledge_refine_search",
  description: "Refine a previous knowledge search with a new query. Use when initial results were insufficient. Previously returned chunks are excluded.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Refined search query" },
      reason: { type: "string", description: "Why previous results were insufficient" },
      top_k: { type: "number", description: "Number of results (default: 5)" },
    },
    required: ["query", "reason"],
  },
};
