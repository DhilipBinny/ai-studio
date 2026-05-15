import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { apiKeys } from "@ais-app/database";
import { eq, and, desc } from "drizzle-orm";
import { createApiKeySchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { generateApiKey } from "@/lib/api-key-auth";

export const GET = withRBAC("SETTINGS", 20, async (_request, auth) => {
  const db = getDb();

  const data = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopedAgentIds: apiKeys.scopedAgentIds,
      rateLimitRpm: apiKeys.rateLimitRpm,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      isActive: apiKeys.isActive,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, auth.tenantId))
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({ data });
});

export const POST = withRBAC("SETTINGS", 20, async (request, auth) => {
  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });
  }
  const { name, scopedAgentIds, rateLimitRpm } = parsed.data;

  const { key, prefix, hash } = generateApiKey();
  const db = getDb();

  const [record] = await db
    .insert(apiKeys)
    .values({
      tenantId: auth.tenantId,
      name: name.trim(),
      keyHash: hash,
      keyPrefix: prefix,
      scopedAgentIds: scopedAgentIds || [],
      rateLimitRpm: rateLimitRpm || 60,
      createdBy: auth.userId,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
    });

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "api_key.create",
    resourceType: "api_key",
    resourceId: record.id,
    details: { name: name.trim() },
  });

  return NextResponse.json({ ...record, key }, { status: 201 });
});
