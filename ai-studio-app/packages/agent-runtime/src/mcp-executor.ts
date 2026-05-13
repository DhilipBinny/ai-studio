import { getDb } from "@ais-app/database";
import { agentConnectors, connectors } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { MCPBridge } from "@ais/mcp-client";
import { decryptSecret, isEncrypted } from "@ais-app/auth";
import type { MCPServerConfig, MCPToolDefinition } from "@ais/types";
import type { ToolDefinition } from "./tool-executor";

function decryptEnvVars(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, isEncrypted(v) ? decryptSecret(v) : v]),
  );
}

let bridge: MCPBridge | null = null;

function getBridge(): MCPBridge {
  if (!bridge) bridge = new MCPBridge();
  return bridge;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export async function loadMCPTools(
  agentId: string,
  tenantId: string,
): Promise<{ tools: ToolDefinition[]; connectorMap: Map<string, string> }> {
  const db = getDb();

  const assignments = await db
    .select({
      connectorId: agentConnectors.connectorId,
      connectorName: connectors.name,
      connectorType: connectors.connectorType,
      connectionConfig: connectors.connectionConfig,
      status: connectors.status,
    })
    .from(agentConnectors)
    .innerJoin(connectors, eq(agentConnectors.connectorId, connectors.id))
    .where(and(
      eq(agentConnectors.agentId, agentId),
      eq(agentConnectors.tenantId, tenantId),
      eq(connectors.isActive, true),
      eq(connectors.connectorType, "mcp"),
    ));

  if (assignments.length === 0) return { tools: [], connectorMap: new Map() };

  const mcpBridge = getBridge();
  const allTools: ToolDefinition[] = [];
  const connectorMap = new Map<string, string>();

  for (const a of assignments) {
    const config = a.connectionConfig as Record<string, unknown>;
    const mcpConfig: MCPServerConfig = {
      enabled: true,
      transport: (config.transport as "stdio" | "sse") || "stdio",
      command: config.command as string | undefined,
      args: config.args as string[] | undefined,
      env: decryptEnvVars(config.env as Record<string, string> | undefined),
    };

    try {
      if (!mcpBridge.isServerConnected(a.connectorId)) {
        await mcpBridge.connectServer(a.connectorId, mcpConfig);
      }

      const mcpTools = mcpBridge.getTools([a.connectorId]);
      const slug = slugify(a.connectorName);

      for (const tool of mcpTools) {
        const fullName = `mcp__${slug}__${tool.name}`;
        connectorMap.set(fullName, a.connectorId);

        allTools.push({
          name: fullName,
          description: `[${a.connectorName}] ${tool.description}`,
          input_schema: tool.inputSchema as Record<string, unknown>,
        });
      }
    } catch (e) {
      console.error(`Failed to connect MCP server "${a.connectorName}":`, (e as Error).message);
    }
  }

  return { tools: allTools, connectorMap };
}

export async function executeMCPTool(
  fullToolName: string,
  args: Record<string, unknown>,
  connectorMap: Map<string, string>,
): Promise<string> {
  const parts = fullToolName.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") {
    throw new Error(`Invalid MCP tool name: ${fullToolName}`);
  }

  const actualToolName = parts.slice(2).join("__");
  const connectorId = connectorMap.get(fullToolName);

  if (!connectorId) {
    throw new Error(`No connector found for MCP tool: ${fullToolName}`);
  }

  const mcpBridge = getBridge();
  return mcpBridge.callTool(connectorId, actualToolName, args);
}
