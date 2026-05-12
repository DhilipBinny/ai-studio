import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { apiKeys } from "@ais-app/database";
import { eq, and, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
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
  const body = await request.json();
  const name = body.name;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return errorResponse("Name is required", "VALIDATION_ERROR", 400);
  }

  const { key, prefix, hash } = generateApiKey();
  const db = getDb();

  const [record] = await db
    .insert(apiKeys)
    .values({
      tenantId: auth.tenantId,
      name: name.trim(),
      keyHash: hash,
      keyPrefix: prefix,
      scopedAgentIds: body.scopedAgentIds || [],
      rateLimitRpm: body.rateLimitRpm || 60,
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
