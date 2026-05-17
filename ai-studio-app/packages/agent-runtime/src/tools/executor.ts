import { getDb } from "@ais-app/database";
import { tools, agentSessionToolCalls, agentSessions } from "@ais-app/database";
import { eq, and, desc } from "drizzle-orm";
import { LoopDetector } from "@ais/tool-platform";
import { executeMCPTool } from "../mcp-executor";
import type { BuiltinToolContext, WorkspaceConfig } from "@ais/tools-common";
import type { ToolResult as CoreToolResult } from "@ais/types";
import type { ToolCall, ToolResult, ToolContext } from "./types";
import { BUILTIN_EXECUTORS } from "./builtin-executors";
import { CONTEXT_EXECUTORS } from "./context-executors";
import { BUILTIN_TOOL_RISK } from "./risk-map";
import { builtinToolMap } from "./tool-loader";

export function toolResultToString(result: CoreToolResult): string {
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
    const [sessionRow] = await db.select({ channel: agentSessions.channel }).from(agentSessions)
      .where(eq(agentSessions.id, sessionId)).limit(1);
    const autoApproveChannels = ["sub_agent", "workflow", "cron"];
    const isAutoApproved = sessionRow && autoApproveChannels.includes(sessionRow.channel || "");

    if (!isAutoApproved) {
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
          const { getConfigSync } = await import("../config");
          const cfg = getConfigSync();
          const braveApiKey = process.env.BRAVE_API_KEY || undefined;
          const builtinCtx: BuiltinToolContext = {
            workspace: workspaceConfig,
            braveApiKey,
            limits: { execMaxStdout: cfg.EXEC_MAX_STDOUT_BYTES, execMaxStderr: cfg.EXEC_MAX_STDERR_BYTES, execMaxTimeoutSeconds: cfg.EXEC_MAX_TIMEOUT_SECONDS, execDefaultTimeoutSeconds: cfg.EXEC_DEFAULT_TIMEOUT_SECONDS, fileMaxWriteBytes: cfg.FILE_MAX_WRITE_BYTES },
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
