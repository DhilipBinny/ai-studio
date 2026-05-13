import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providers, providerModels } from "@ais-app/database";
import { createProviderSchema, paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("PROVIDERS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));

  const where = and(eq(providers.tenantId, auth.tenantId), eq(providers.isActive, true));

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: providers.id,
        name: providers.name,
        providerType: providers.providerType,
        baseUrl: providers.baseUrl,
        apiKeyRef: providers.apiKeyRef,
        config: providers.config,
        status: providers.status,
        isActive: providers.isActive,
        createdAt: providers.createdAt,
        modelCount: sql<number>`(SELECT COUNT(*) FROM provider_models WHERE provider_id = ${providers.id} AND is_active = true)`,
      })
      .from(providers)
      .where(where)
      .orderBy(desc(providers.createdAt))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(providers).where(where),
  ]);

  const providerIds = data.map((p) => p.id);
  const models = providerIds.length > 0
    ? await db
        .select({
          id: providerModels.id,
          providerId: providerModels.providerId,
          modelId: providerModels.modelId,
          displayName: providerModels.displayName,
          capabilities: providerModels.capabilities,
          contextWindow: providerModels.contextWindow,
          maxOutputTokens: providerModels.maxOutputTokens,
          isActive: providerModels.isActive,
        })
        .from(providerModels)
        .where(and(
          eq(providerModels.tenantId, auth.tenantId),
          eq(providerModels.isActive, true),
        ))
    : [];

  const enriched = data.map((p) => ({
    ...p,
    apiKeyRef: p.apiKeyRef ? "****" : null,
    models: models.filter((m) => m.providerId === p.id),
  }));

  return NextResponse.json({
    data: enriched,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(total / pagination.pageSize),
  });
});

export const POST = withRBAC("PROVIDERS", 20, async (request, auth) => {
  const body = await request.json();
  const parsed = createProviderSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();
  const { name, providerType, baseUrl, apiKeyRef, config } = parsed.data;

  const [existing] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.tenantId, auth.tenantId), eq(providers.name, name)))
    .limit(1);

  if (existing) {
    return errorResponse("Provider name already exists", "NAME_EXISTS", 409);
  }

  const [provider] = await db
    .insert(providers)
    .values({
      tenantId: auth.tenantId,
      name,
      providerType,
      baseUrl: baseUrl || null,
      apiKeyRef: apiKeyRef || null,
      config: config || {},
    })
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "provider.create",
    resourceType: "provider",
    resourceId: provider.id,
    details: { name, providerType },
  });

  return NextResponse.json(provider, { status: 201 });
});
