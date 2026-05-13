import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { connectors } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { encryptSecret } from "@ais-app/auth";
import { ALLOWED_COMMANDS } from "@ais/mcp-client";

function maskConnectorSecrets(connector: Record<string, unknown>): Record<string, unknown> {
  const result = { ...connector };
  if (result.credentialsRef) result.credentialsRef = "****";
  if (result.connectionConfig && typeof result.connectionConfig === "object") {
    const cc = { ...(result.connectionConfig as Record<string, unknown>) };
    if (cc.env && typeof cc.env === "object") {
      cc.env = Object.fromEntries(
        Object.entries(cc.env as Record<string, string>).map(([k]) => [k, "****"])
      );
    }
    result.connectionConfig = cc;
  }
  return result;
}

export const GET = withRBAC("CONNECTORS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const db = getDb();
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId)))
    .limit(1);

  if (!connector) return errorResponse("Connector not found", "NOT_FOUND", 404);
  return NextResponse.json(maskConnectorSecrets(connector as unknown as Record<string, unknown>));
});

export const PATCH = withRBAC("CONNECTORS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const body = await request.json();
  const db = getDb();

  const [existing] = await db
    .select({ id: connectors.id, connectorType: connectors.connectorType })
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId), eq(connectors.isActive, true)))
    .limit(1);

  if (!existing) return errorResponse("Connector not found", "NOT_FOUND", 404);

  if (body.connectionConfig && existing.connectorType === "mcp") {
    const command = (body.connectionConfig as Record<string, unknown>)?.command as string | undefined;
    if (command) {
      const base = command.includes("/") ? command.split("/").pop()! : command;
      if (!ALLOWED_COMMANDS.has(base)) {
        return errorResponse(`Command "${base}" is not allowed. Permitted: ${[...ALLOWED_COMMANDS].join(", ")}`, "INVALID_COMMAND", 400);
      }
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.connectionConfig !== undefined) {
    const cc = body.connectionConfig;
    updates.connectionConfig = cc?.env
      ? { ...cc, env: Object.fromEntries(Object.entries(cc.env as Record<string, string>).map(([k, v]) => [k, encryptSecret(v)])) }
      : cc;
  }
  if (body.credentialsRef !== undefined) {
    updates.credentialsRef = body.credentialsRef ? encryptSecret(body.credentialsRef) : body.credentialsRef;
  }

  const [updated] = await db
    .update(connectors)
    .set(updates)
    .where(eq(connectors.id, id))
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "connector.update", resourceType: "connector", resourceId: id,
    details: { fields: Object.keys(updates) },
  });

  return NextResponse.json(maskConnectorSecrets(updated as unknown as Record<string, unknown>));
});

export const DELETE = withRBAC("CONNECTORS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Connector ID required", "MISSING_ID", 400);

  const db = getDb();
  const [connector] = await db
    .select({ id: connectors.id, name: connectors.name })
    .from(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.tenantId, auth.tenantId)))
    .limit(1);

  if (!connector) return errorResponse("Connector not found", "NOT_FOUND", 404);

  await db
    .update(connectors)
    .set({ isActive: false, deactivatedAt: new Date(), updatedAt: new Date() })
    .where(eq(connectors.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "connector.delete", resourceType: "connector", resourceId: id,
    details: { name: connector.name },
  });

  return NextResponse.json({ success: true });
});
