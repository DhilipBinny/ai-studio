import type { ContextAwareExecutorFn, ToolDefinition, SearchSessionState } from "./types";
import { getDb, agentTasks, agents } from "@ais-app/database";
import { eq, and } from "drizzle-orm";

export const CONTEXT_EXECUTORS: Record<string, ContextAwareExecutorFn> = {
  list_agents: async (_args, ctx) => {
    const db = getDb();
    const rows = await db.select({ id: agents.id, name: agents.name, slug: agents.slug, description: agents.description })
      .from(agents)
      .where(and(eq(agents.tenantId, ctx.tenantId), eq(agents.isActive, true), eq(agents.status, "active")));

    if (rows.length === 0) return "No active agents found.";
    return rows.map(a => `• ${a.slug} (${a.name}): ${a.description || "No description"}`).join("\n");
  },

  invoke_agent: async (args, ctx) => {
    const message = args.message as string;
    const projectId = args.project_id as string | undefined;
    const timeoutMs = Math.min(Number(args.timeout_ms) || 600000, 600000);

    if (!message) return "Error: message is required";

    const db = getDb();
    let resolvedAgentId: string;

    // Mode 1: by agent_id (UUID)
    // Mode 2: by agent_slug (human-readable)
    // Mode 3: inline (create ephemeral agent on-the-fly)
    const agentId = args.agent_id as string | undefined;
    const agentSlug = args.agent_slug as string | undefined;
    const inline = args.inline as { system_prompt?: string; tools?: string[] } | undefined;

    if (agentId) {
      const [target] = await db.select({ id: agents.id }).from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.tenantId, ctx.tenantId))).limit(1);
      if (!target) return "Error: agent_id not found in this tenant. Use list_agents to see available agents.";
      resolvedAgentId = target.id;
    } else if (agentSlug) {
      const [target] = await db.select({ id: agents.id }).from(agents)
        .where(and(eq(agents.slug, agentSlug), eq(agents.tenantId, ctx.tenantId), eq(agents.isActive, true))).limit(1);
      if (!target) return `Error: agent with slug "${agentSlug}" not found. Use list_agents to see available agents.`;
      resolvedAgentId = target.id;
    } else if (inline?.system_prompt) {
      const [ephemeral] = await db.insert(agents).values({
        tenantId: ctx.tenantId,
        name: `Ephemeral sub-agent`,
        slug: `ephemeral-${Date.now()}`,
        systemPrompt: inline.system_prompt,
        status: "active",
        isActive: false,
        metadata: { ephemeral: true, parentSessionId: ctx.sessionId, createdAt: new Date().toISOString() },
      }).returning();
      resolvedAgentId = ephemeral.id;
    } else {
      return "Error: provide agent_id, agent_slug, or inline.system_prompt. Use list_agents to see available agents.";
    }

    const { runSession } = await import("../session-runner");
    const startTime = Date.now();

    const [task] = await db.insert(agentTasks).values({
      tenantId: ctx.tenantId,
      projectId: projectId || null,
      parentSessionId: ctx.sessionId,
      agentId: resolvedAgentId,
      status: "running",
      description: message.slice(0, 200),
      prompt: message,
    }).returning();

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const resultPromise = runSession({
        agentId: resolvedAgentId,
        tenantId: ctx.tenantId,
        userId: "",
        message,
        channel: "sub_agent",
        metadata: {
          parentSessionId: ctx.sessionId,
          parentTaskId: task.id,
          projectId: projectId || undefined,
          isSubAgent: true,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Sub-agent timed out")), timeoutMs);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      await db.update(agentTasks).set({
        childSessionId: result.sessionId,
        status: result.status === "completed" ? "completed" : "failed",
        result: result.response?.slice(0, 5000) || null,
        errorMessage: result.error || null,
        completedAt: new Date(),
        durationMs,
        notified: true,
      }).where(eq(agentTasks.id, task.id));

      if (result.status !== "completed") {
        return `Sub-agent failed: ${result.error || "Unknown error"}\nSession: ${result.sessionId}`;
      }

      return [
        `Sub-agent completed successfully.`,
        `Session: ${result.sessionId}`,
        `Duration: ${(durationMs / 1000).toFixed(1)}s`,
        `Tokens: ${result.usage.inputTokens + result.usage.outputTokens} ($${result.usage.costUsd.toFixed(4)})`,
        ``,
        `Response:`,
        result.response,
      ].join("\n");
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : "Unknown error";

      await db.update(agentTasks).set({
        status: "failed",
        errorMessage: errorMsg,
        completedAt: new Date(),
        durationMs,
        notified: true,
      }).where(eq(agentTasks.id, task.id));

      return `Sub-agent error: ${errorMsg}`;
    }
  },

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

export const LIST_AGENTS_DEFINITION: ToolDefinition = {
  name: "list_agents",
  description: "List all available agents you can delegate work to. Returns their slug (for invoke_agent), name, and description.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

export const INVOKE_AGENT_DEFINITION: ToolDefinition = {
  name: "invoke_agent",
  description: "Spawn a sub-agent and wait for completion. Three modes: (1) by agent_slug (preferred — use list_agents to find slugs), (2) by agent_id (UUID), (3) inline with custom system_prompt for ad-hoc tasks. The sub-agent runs independently with its own tools, then returns its response.",
  input_schema: {
    type: "object",
    properties: {
      agent_slug: { type: "string", description: "Slug of an existing agent to invoke (use list_agents to find). Preferred over agent_id." },
      agent_id: { type: "string", description: "UUID of an existing agent (alternative to slug)" },
      inline: {
        type: "object",
        description: "Create an ad-hoc sub-agent with custom instructions (no pre-defined agent needed)",
        properties: {
          system_prompt: { type: "string", description: "System prompt for the ephemeral sub-agent" },
          tools: { type: "array", items: { type: "string" }, description: "Tool names to give the sub-agent (default: read_file, glob, grep)" },
        },
      },
      message: { type: "string", description: "The task/prompt to send to the sub-agent" },
      project_id: { type: "string", description: "Project ID for shared workspace access" },
      timeout_ms: { type: "number", description: "Max wait in ms (default: 600000 = 10 min)" },
    },
    required: ["message"],
  },
};
