import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { connectors } from "@ais-app/database";
import { paginationSchema, createConnectorSchema } from "@ais-app/validation";
import { encryptSecret } from "@ais-app/auth";
import { ALLOWED_COMMANDS } from "@ais/mcp-client";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

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

function validateMcpCommand(connectionConfig: Record<string, unknown>): string | null {
  const command = connectionConfig?.command as string | undefined;
  if (!command) return null;
  const base = command.includes("/") ? command.split("/").pop()! : command;
  if (!ALLOWED_COMMANDS.has(base)) {
    return `Command "${base}" is not allowed. Permitted: ${[...ALLOWED_COMMANDS].join(", ")}`;
  }
  return null;
}

export const GET = withRBAC("CONNECTORS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = and(eq(connectors.tenantId, auth.tenantId), eq(connectors.isActive, true));

  const [data, [{ total }]] = await Promise.all([
    db.select().from(connectors).where(where).orderBy(desc(connectors.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(connectors).where(where),
  ]);

  const masked = data.map((d) => maskConnectorSecrets(d as unknown as Record<string, unknown>));

  return NextResponse.json({ data: masked, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("CONNECTORS", 20, async (request, auth) => {
  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = createConnectorSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });
  }
  const { name, description, connectorType, connectionConfig, healthCheckUrl, credentialsRef } = parsed.data;

  if (connectorType === "mcp" && connectionConfig) {
    const cmdError = validateMcpCommand(connectionConfig as Record<string, unknown>);
    if (cmdError) return errorResponse(cmdError, "INVALID_COMMAND", 400);
  }

  const db = getDb();
  const [existing] = await db.select({ id: connectors.id }).from(connectors).where(and(eq(connectors.tenantId, auth.tenantId), eq(connectors.name, name))).limit(1);
  if (existing) return errorResponse("Name already exists", "NAME_EXISTS", 409);

  const [connector] = await db.insert(connectors).values({
    tenantId: auth.tenantId,
    name,
    description: description || "",
    connectorType,
    connectionConfig: connectionConfig?.env
      ? { ...connectionConfig, env: Object.fromEntries(Object.entries(connectionConfig.env as Record<string, string>).map(([k, v]) => [k, encryptSecret(v)])) }
      : connectionConfig || {},
    credentialsRef: credentialsRef ? encryptSecret(credentialsRef) : null,
    healthCheckUrl: healthCheckUrl || null,
    createdBy: auth.userId,
  }).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "connector.create", resourceType: "connector", resourceId: connector.id, details: { name, connectorType } });

  return NextResponse.json(maskConnectorSecrets(connector as unknown as Record<string, unknown>), { status: 201 });
});
