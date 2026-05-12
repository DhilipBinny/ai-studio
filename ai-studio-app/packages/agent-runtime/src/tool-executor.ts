import { getDb } from "@ais-app/database";
import { agentTools, tools, agentSessionToolCalls } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { LoopDetector } from "@ais/tool-platform";

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

type ToolExecutorFn = (args: Record<string, unknown>) => Promise<string>;

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

export async function loadToolDefinitions(
  agentId: string,
  tenantId: string,
): Promise<ToolDefinition[]> {
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

  return rows.map((row) => ({
    name: row.name,
    description: row.description || row.displayName,
    input_schema: Object.keys(row.parametersSchema as Record<string, unknown>).length > 0
      ? row.parametersSchema as Record<string, unknown>
      : { type: "object", properties: {}, required: [] },
  }));
}

export function createLoopDetector(): LoopDetector {
  return new LoopDetector();
}

export async function executeTool(
  call: ToolCall,
  tenantId: string,
  sessionId: string,
  loopDetector?: LoopDetector,
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
  let status: string = "success";
  let errorMessage: string | null = null;

  const executor = BUILTIN_EXECUTORS[call.name];
  if (executor) {
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
