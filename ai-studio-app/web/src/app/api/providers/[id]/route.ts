import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providers, providerModels } from "@ais-app/database";
import { updateProviderSchema } from "@ais-app/validation";
import { encryptSecret } from "@ais-app/auth";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("PROVIDERS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const db = getDb();

  const [provider] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!provider) return errorResponse("Provider not found", "NOT_FOUND", 404);

  const models = await db
    .select()
    .from(providerModels)
    .where(and(eq(providerModels.providerId, id), eq(providerModels.tenantId, auth.tenantId)));

  return NextResponse.json({ ...provider, apiKeyRef: provider.apiKeyRef ? "****" : null, models });
});

export const PATCH = withRBAC("PROVIDERS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = updateProviderSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();

  const [existing] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("Provider not found", "NOT_FOUND", 404);

  const updateData = { ...parsed.data };
  if (updateData.apiKeyRef) {
    updateData.apiKeyRef = encryptSecret(updateData.apiKeyRef);
  }

  const [updated] = await db
    .update(providers)
    .set(updateData)
    .where(eq(providers.id, id))
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "provider.update",
    resourceType: "provider",
    resourceId: id,
    details: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(updated);
});
