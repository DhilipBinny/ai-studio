import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { connectors } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { MCPClient } from "@ais/mcp-client";
import { decryptSecret, isEncrypted } from "@ais-app/auth";
import type { MCPServerConfig } from "@ais/types";

export const POST = withRBAC("CONNECTORS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const db = getDb();
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId)))
    .limit(1);

  if (!connector) return errorResponse("Connector not found", "NOT_FOUND", 404);
  if (connector.connectorType !== "mcp") return errorResponse("Only MCP connectors can be tested", "INVALID_TYPE", 400);

  const config = connector.connectionConfig as Record<string, unknown>;
  const mcpConfig: MCPServerConfig = {
    enabled: true,
    transport: (config.transport as "stdio" | "sse") || "stdio",
    command: config.command as string | undefined,
    args: config.args as string[] | undefined,
    env: config.env
      ? Object.fromEntries(Object.entries(config.env as Record<string, string>).map(([k, v]) => [k, isEncrypted(v) ? decryptSecret(v) : v]))
      : undefined,
    url: config.url as string | undefined,
  };

  const start = Date.now();
  const client = new MCPClient(connector.name, mcpConfig);

  try {
    await client.connect();
    const tools = client.listTools();
    const latencyMs = Date.now() - start;

    await db
      .update(connectors)
      .set({
        status: "active",
        lastTestedAt: new Date(),
        lastError: null,
        connectionConfig: {
          ...config,
          discoveredTools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
        },
        updatedAt: new Date(),
      })
      .where(eq(connectors.id, id));

    await client.disconnect();

    await createAuditEntry({
      tenantId: auth.tenantId, userId: auth.userId,
      action: "connector.test", resourceType: "connector", resourceId: id,
      details: { success: true, latencyMs, toolsDiscovered: tools.length },
    });

    return NextResponse.json({
      success: true,
      latencyMs,
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
    });
  } catch (e) {
    const latencyMs = Date.now() - start;
    const errorMsg = (e as Error).message;

    await db
      .update(connectors)
      .set({ status: "error", lastTestedAt: new Date(), lastError: errorMsg, updatedAt: new Date() })
      .where(eq(connectors.id, id));

    await client.disconnect().catch(() => {});

    await createAuditEntry({
      tenantId: auth.tenantId, userId: auth.userId,
      action: "connector.test", resourceType: "connector", resourceId: id,
      details: { success: false, latencyMs, error: errorMsg },
    });

    return NextResponse.json({ success: false, latencyMs, error: errorMsg, tools: [] });
  }
});
