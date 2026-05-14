import type { ContextAwareExecutorFn, ToolDefinition } from "./types";

export const CONTEXT_EXECUTORS: Record<string, ContextAwareExecutorFn> = {
  knowledge_search: async (args, ctx) => {
    const { searchKnowledge } = await import("../knowledge-search");
    const query = args.query as string;
    if (!query) return "Error: query is required";

    const topK = (args.top_k as number) || 5;
    const results = await searchKnowledge(query, ctx.agentId, ctx.tenantId, { topK });

    if (results.length === 0) return "No relevant documents found for this query.";

    return results.map((r, i) =>
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
