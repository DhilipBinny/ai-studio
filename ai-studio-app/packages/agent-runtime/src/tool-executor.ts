import { getDb } from "@ais-app/database";
import { agentTools, tools, agentSessionToolCalls, agentKnowledgeBases } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { LoopDetector } from "@ais/tool-platform";
import { loadMCPTools, executeMCPTool } from "./mcp-executor";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolContext {
  agentId: string;
  tenantId: string;
  sessionId: string;
}

type ToolExecutorFn = (args: Record<string, unknown>) => Promise<string>;
type ContextAwareExecutorFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

const BUILTIN_EXECUTORS: Record<string, ToolExecutorFn> = {
  get_current_time: async (args) => {
    const tz = (args.timezone as string) || "UTC";
    return new Date().toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
  },

  calculate: async (args) => {
    const expr = args.expression as string;
    if (!expr) return "Error: expression is required";
    if (!/^[\d\s+\-*/().%]+$/.test(expr)) return "Error: invalid expression (only numbers and +,-,*,/,(),% allowed)";
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return String(result);
    } catch {
      return "Error: failed to evaluate expression";
    }
  },

  echo: async (args) => {
    return args.message as string || "No message provided";
  },
};

const CONTEXT_EXECUTORS: Record<string, ContextAwareExecutorFn> = {
  knowledge_search: async (args, ctx) => {
    const { searchKnowledge } = await import("./knowledge-search");
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

const KNOWLEDGE_SEARCH_DEFINITION: ToolDefinition = {
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

export interface LoadedTools {
  definitions: ToolDefinition[];
  mcpConnectorMap: Map<string, string>;
}

export async function loadToolDefinitions(
  agentId: string,
  tenantId: string,
): Promise<LoadedTools> {
  const db = getDb();

  const rows = await db
    .select({
      name: tools.name,
      displayName: tools.displayName,
      description: tools.description,
      toolType: tools.toolType,
      parametersSchema: tools.parametersSchema,
    })
    .from(agentTools)
    .innerJoin(tools, eq(agentTools.toolId, tools.id))
    .where(and(
      eq(agentTools.agentId, agentId),
      eq(agentTools.tenantId, tenantId),
      eq(tools.isActive, true),
    ));

  const defs: ToolDefinition[] = rows.map((row) => ({
    name: row.name,
    description: row.description || row.displayName,
    input_schema: Object.keys(row.parametersSchema as Record<string, unknown>).length > 0
      ? row.parametersSchema as Record<string, unknown>
      : { type: "object", properties: {}, required: [] },
  }));

  const kbLinks = await db
    .select({ id: agentKnowledgeBases.id })
    .from(agentKnowledgeBases)
    .where(and(eq(agentKnowledgeBases.agentId, agentId), eq(agentKnowledgeBases.tenantId, tenantId)))
    .limit(1);

  if (kbLinks.length > 0) {
    defs.push(KNOWLEDGE_SEARCH_DEFINITION);
  }

  const { tools: mcpTools, connectorMap } = await loadMCPTools(agentId, tenantId);
  defs.push(...mcpTools);

  return { definitions: defs, mcpConnectorMap: connectorMap };
}

export function createLoopDetector(): LoopDetector {
  return new LoopDetector();
}

export async function executeTool(
  call: ToolCall,
  tenantId: string,
  sessionId: string,
  loopDetector?: LoopDetector,
  context?: ToolContext,
  mcpConnectorMap?: Map<string, string>,
): Promise<ToolResult> {
  if (loopDetector) {
    const loopError = loopDetector.record(call.name, call.input);
    if (loopError) {
      return { tool_use_id: call.id, content: loopError, is_error: true };
    }
  }

  const start = Date.now();
  const db = getDb();

  let result: string;
  let status: "pending" | "success" | "error" | "denied" | "timeout" = "success";
  let errorMessage: string | null = null;

  const isMCP = call.name.startsWith("mcp__") && mcpConnectorMap;
  const contextExecutor = CONTEXT_EXECUTORS[call.name];
  const executor = BUILTIN_EXECUTORS[call.name];

  if (isMCP) {
    try {
      result = await executeMCPTool(call.name, call.input, mcpConnectorMap);
    } catch (e) {
      result = `Error: ${(e as Error).message}`;
      status = "error";
      errorMessage = (e as Error).message;
    }
  } else if (contextExecutor && context) {
    try {
      result = await contextExecutor(call.input, context);
    } catch (e) {
      result = `Error: ${(e as Error).message}`;
      status = "error";
      errorMessage = (e as Error).message;
    }
  } else if (executor) {
    try {
      result = await executor(call.input);
    } catch (e) {
      result = `Error: ${(e as Error).message}`;
      status = "error";
      errorMessage = (e as Error).message;
    }
  } else {
    result = `Tool "${call.name}" has no executor. Register a builtin executor or configure an API/MCP endpoint.`;
    status = "error";
    errorMessage = "No executor found";
  }

  const durationMs = Date.now() - start;

  await db.insert(agentSessionToolCalls).values({
    tenantId,
    agentSessionId: sessionId,
    toolName: call.name,
    arguments: call.input,
    result,
    status,
    durationMs,
    errorMessage,
  });

  return {
    tool_use_id: call.id,
    content: result,
    is_error: status === "error",
  };
}
