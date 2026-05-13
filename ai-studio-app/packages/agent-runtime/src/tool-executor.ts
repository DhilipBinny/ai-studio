import { getDb } from "@ais-app/database";
import { agentTools, tools, agentSessionToolCalls, agentKnowledgeBases, agentSessions } from "@ais-app/database";
import { eq, and, desc } from "drizzle-orm";
import { LoopDetector } from "@ais/tool-platform";
import { loadMCPTools, executeMCPTool } from "./mcp-executor";
import {
  allBuiltinTools,
  ensureWorkspace,
  type WorkspaceConfig,
  type BuiltinToolContext,
} from "@ais/tools-common";
import type { ToolRegistration } from "@ais/tool-platform";
import type { ToolResult as CoreToolResult } from "@ais/types";

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

const builtinToolMap = new Map<string, ToolRegistration>();
for (const tool of allBuiltinTools) {
  builtinToolMap.set(tool.definition.name, tool);
}

const BUILTIN_TOOL_RISK: Record<string, string> = {
  read_file: "safe", list_directory: "safe", glob: "safe", grep: "safe",
  web_fetch: "safe", web_search: "safe", read_pdf: "safe",
  get_current_time: "safe", calculate: "safe",
  write_file: "moderate", edit_file: "moderate", apply_patch: "moderate",
  exec_command: "dangerous", batch_exec: "dangerous",
};

const BUILTIN_TOOL_CATEGORY: Record<string, string> = {
  read_file: "file_operations", write_file: "file_operations", edit_file: "file_operations",
  list_directory: "file_operations", glob: "file_operations", read_pdf: "file_operations",
  apply_patch: "file_operations", grep: "search", web_fetch: "web", web_search: "web",
  exec_command: "execution", batch_exec: "execution",
  get_current_time: "utility", calculate: "utility",
};

async function seedBuiltinToolsForTenant(tenantId: string): Promise<void> {
  const db = getDb();
  const allNames = [...builtinToolMap.keys(), "get_current_time", "calculate"];
  const seen = new Set<string>();

  for (const name of allNames) {
    if (seen.has(name)) continue;
    seen.add(name);

    const registration = builtinToolMap.get(name);
    const displayName = registration?.definition.name
      ? registration.definition.name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const description = registration?.definition.description || "";
    const parametersSchema = registration?.definition.parameters || { type: "object", properties: {}, required: [] };
    const riskLevel = BUILTIN_TOOL_RISK[name] || "safe";
    const category = BUILTIN_TOOL_CATEGORY[name] || "general";

    try {
      await db.insert(tools).values({
        tenantId,
        name,
        displayName,
        description,
        toolType: "builtin",
        category,
        riskLevel,
        parametersSchema,
        config: {},
      }).onConflictDoNothing();
    } catch {
      // ignore — race condition with concurrent seed
    }
  }
}

function toolResultToString(result: CoreToolResult): string {
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null) {
    if ("content" in result && Array.isArray((result as { content: unknown[] }).content)) {
      const blocks = (result as { content: Array<{ type: string; text?: string }> }).content;
      return blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("\n");
    }
    if ("error" in result) {
      return `Error: ${(result as { error: string }).error}`;
    }
    return JSON.stringify(result);
  }
  return String(result);
}

export interface LoadedTools {
  definitions: ToolDefinition[];
  mcpConnectorMap: Map<string, string>;
  workspaceConfig: WorkspaceConfig | null;
}

export async function loadToolDefinitions(
  agentId: string,
  tenantId: string,
  sessionId?: string,
): Promise<LoadedTools> {
  const db = getDb();

  const rows = await db
    .select({
      name: tools.name,
      displayName: tools.displayName,
      description: tools.description,
      toolType: tools.toolType,
      parametersSchema: tools.parametersSchema,
      riskLevel: tools.riskLevel,
    })
    .from(agentTools)
    .innerJoin(tools, eq(agentTools.toolId, tools.id))
    .where(and(
      eq(agentTools.agentId, agentId),
      eq(agentTools.tenantId, tenantId),
      eq(tools.isActive, true),
    ));

  const assignedToolNames = new Set(rows.map((r) => r.name));

  const defs: ToolDefinition[] = rows.map((row) => ({
    name: row.name,
    description: row.description || row.displayName,
    input_schema: Object.keys(row.parametersSchema as Record<string, unknown>).length > 0
      ? row.parametersSchema as Record<string, unknown>
      : { type: "object", properties: {}, required: [] },
  }));

  let safeBuiltinRows = await db
    .select({
      name: tools.name,
      displayName: tools.displayName,
      description: tools.description,
      parametersSchema: tools.parametersSchema,
    })
    .from(tools)
    .where(and(
      eq(tools.tenantId, tenantId),
      eq(tools.toolType, "builtin"),
      eq(tools.riskLevel, "safe"),
      eq(tools.isActive, true),
    ));

  if (safeBuiltinRows.length === 0) {
    await seedBuiltinToolsForTenant(tenantId);
    safeBuiltinRows = await db
      .select({
        name: tools.name,
        displayName: tools.displayName,
        description: tools.description,
        parametersSchema: tools.parametersSchema,
      })
      .from(tools)
      .where(and(
        eq(tools.tenantId, tenantId),
        eq(tools.toolType, "builtin"),
        eq(tools.riskLevel, "safe"),
        eq(tools.isActive, true),
      ));
  }

  for (const row of safeBuiltinRows) {
    if (assignedToolNames.has(row.name)) continue;
    assignedToolNames.add(row.name);
    defs.push({
      name: row.name,
      description: row.description || row.displayName,
      input_schema: Object.keys(row.parametersSchema as Record<string, unknown>).length > 0
        ? row.parametersSchema as Record<string, unknown>
        : { type: "object", properties: {}, required: [] },
    });
  }

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

  let workspaceConfig: WorkspaceConfig | null = null;
  const hasBuiltinTools = Array.from(assignedToolNames).some((name) => builtinToolMap.has(name));

  if (hasBuiltinTools && sessionId) {
    const dataRoot = process.env.DATA_ROOT || ".data";
    workspaceConfig = { dataRoot, tenantId, agentId, sessionId };
    ensureWorkspace(workspaceConfig);
  }

  return { definitions: defs, mcpConnectorMap: connectorMap, workspaceConfig };
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
  workspaceConfig?: WorkspaceConfig | null,
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

  let toolRisk = BUILTIN_TOOL_RISK[call.name];
  if (!toolRisk) {
    const [toolRow] = await db.select({ riskLevel: tools.riskLevel }).from(tools)
      .where(and(eq(tools.tenantId, tenantId), eq(tools.name, call.name), eq(tools.isActive, true))).limit(1);
    toolRisk = toolRow?.riskLevel;
  }

  if (toolRisk === "dangerous") {
    const argsHash = JSON.stringify(call.input);
    const [pendingCall] = await db
      .select({ id: agentSessionToolCalls.id, approvalStatus: agentSessionToolCalls.approvalStatus, arguments: agentSessionToolCalls.arguments })
      .from(agentSessionToolCalls)
      .where(and(
        eq(agentSessionToolCalls.agentSessionId, sessionId),
        eq(agentSessionToolCalls.toolName, call.name),
        eq(agentSessionToolCalls.requiresApproval, true),
      ))
      .orderBy(desc(agentSessionToolCalls.createdAt))
      .limit(1);

    const argsMatch = pendingCall && JSON.stringify(pendingCall.arguments) === argsHash;

    if (!pendingCall || !argsMatch || pendingCall.approvalStatus !== "approved") {
      await db.insert(agentSessionToolCalls).values({
        tenantId,
        agentSessionId: sessionId,
        toolName: call.name,
        arguments: call.input,
        result: "Awaiting human approval",
        status: "pending",
        requiresApproval: true,
        durationMs: 0,
      });

      await db.update(agentSessions).set({ status: "waiting_approval" }).where(eq(agentSessions.id, sessionId));

      return {
        tool_use_id: call.id,
        content: "This tool requires human approval before execution. The session is paused until an admin approves or denies this tool call. Tell the user their request needs admin approval for the dangerous operation.",
        is_error: false,
      };
    }
  }

  const isMCP = call.name.startsWith("mcp__") && mcpConnectorMap;
  const contextExecutor = CONTEXT_EXECUTORS[call.name];
  const executor = BUILTIN_EXECUTORS[call.name];
  const builtinTool = builtinToolMap.get(call.name);

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
  } else if (builtinTool && workspaceConfig) {
    try {
      if (builtinTool.validateInput) {
        const validation = builtinTool.validateInput(call.input);
        if (!validation.ok) {
          result = `Error: ${validation.error}`;
          status = "error";
          errorMessage = validation.error;
        } else {
          const braveApiKey = process.env.BRAVE_API_KEY || undefined;
          const builtinCtx: BuiltinToolContext = {
            workspace: workspaceConfig,
            braveApiKey,
          };
          const raw = await builtinTool.executor(call.input, builtinCtx as unknown as Record<string, unknown>);
          result = toolResultToString(raw);
          if (typeof raw === "object" && raw !== null && "error" in raw) {
            status = "error";
            errorMessage = (raw as { error: string }).error;
          }
        }
      } else {
        const braveApiKey = process.env.BRAVE_API_KEY || undefined;
        const builtinCtx: BuiltinToolContext = {
          workspace: workspaceConfig,
          braveApiKey,
        };
        const raw = await builtinTool.executor(call.input, builtinCtx as unknown as Record<string, unknown>);
        result = toolResultToString(raw);
        if (typeof raw === "object" && raw !== null && "error" in raw) {
          status = "error";
          errorMessage = (raw as { error: string }).error;
        }
      }
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
