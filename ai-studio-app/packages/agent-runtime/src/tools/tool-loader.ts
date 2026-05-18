import { getDb } from "@ais-app/database";
import { agentTools, tools, agentKnowledgeBases, agents } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { LoopDetector } from "@ais/tool-platform";
import { loadMCPTools } from "../mcp-executor";
import {
  allBuiltinTools,
  ensureWorkspace,
  type WorkspaceConfig,
} from "@ais/tools-common";
import type { ToolRegistration } from "@ais/tool-platform";
import type { ToolDefinition, LoadedTools } from "./types";
import { KNOWLEDGE_SEARCH_DEFINITION, KNOWLEDGE_REFINE_SEARCH_DEFINITION, INVOKE_AGENT_DEFINITION, LIST_AGENTS_DEFINITION, REMEMBER_DEFINITION, RECALL_DEFINITION, FORGET_DEFINITION, CREATE_AGENT_DEFINITION, CREATE_WORKFLOW_DEFINITION, TRIGGER_WORKFLOW_DEFINITION, GET_CONFIG_DEFINITION, SET_CONFIG_DEFINITION } from "./context-executors";
import { BUILTIN_TOOL_RISK, BUILTIN_TOOL_CATEGORY } from "./risk-map";

export const builtinToolMap = new Map<string, ToolRegistration>();
for (const tool of allBuiltinTools) {
  builtinToolMap.set(tool.definition.name, tool);
}

export async function seedBuiltinToolsForTenant(tenantId: string): Promise<void> {
  const db = getDb();
  const allNames = [...builtinToolMap.keys(), "get_current_time", "calculate", "echo"];
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

export async function loadToolDefinitions(
  agentId: string,
  tenantId: string,
  sessionId?: string,
  workflowRunId?: string,
  isSubAgent?: boolean,
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
    defs.push(KNOWLEDGE_REFINE_SEARCH_DEFINITION);
  }

  if (!isSubAgent) {
    defs.push(LIST_AGENTS_DEFINITION);
    defs.push(INVOKE_AGENT_DEFINITION);
  }

  defs.push(REMEMBER_DEFINITION);
  defs.push(RECALL_DEFINITION);
  defs.push(FORGET_DEFINITION);

  // Meta-tools: only for agents with metadata.platformTools enabled
  const [agentMeta] = await db.select({ trustLevel: agents.trustLevel, metadata: agents.metadata }).from(agents).where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId))).limit(1);
  const platformTools = (agentMeta?.metadata as Record<string, unknown>)?.platformTools === true;
  if (agentMeta?.trustLevel === "trusted" && platformTools) {
    defs.push(CREATE_AGENT_DEFINITION);
    defs.push(CREATE_WORKFLOW_DEFINITION);
    defs.push(TRIGGER_WORKFLOW_DEFINITION);
    defs.push(GET_CONFIG_DEFINITION);
    defs.push(SET_CONFIG_DEFINITION);
  }

  const toolBlacklist = Array.isArray((agentMeta?.metadata as Record<string, unknown>)?.toolBlacklist)
    ? (agentMeta!.metadata as Record<string, string[]>).toolBlacklist
    : [];
  if (toolBlacklist.length > 0) {
    const blocked = new Set(toolBlacklist);
    const before = defs.length;
    defs.splice(0, defs.length, ...defs.filter((d) => !blocked.has(d.name)));
  }

  const { tools: mcpTools, connectorMap } = await loadMCPTools(agentId, tenantId);
  defs.push(...mcpTools);

  let workspaceConfig: WorkspaceConfig | null = null;
  const hasBuiltinTools = Array.from(assignedToolNames).some((name) => builtinToolMap.has(name));

  if (hasBuiltinTools && sessionId) {
    const dataRoot = process.env.DATA_ROOT || ".data";
    workspaceConfig = { dataRoot, tenantId, agentId, sessionId, workflowRunId };
    ensureWorkspace(workspaceConfig);
  }

  return { definitions: defs, mcpConnectorMap: connectorMap, workspaceConfig };
}

export function createLoopDetector(): LoopDetector {
  return new LoopDetector();
}
