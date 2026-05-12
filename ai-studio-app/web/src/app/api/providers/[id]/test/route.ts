import { NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providers, providerModels } from "@ais-app/database";
import { eq, and, notInArray } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { testProvider } from "@/lib/services/provider-test";

export const POST = withRBAC("PROVIDERS", 10, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const db = getDb();

  const [provider] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!provider) {
    return errorResponse("Provider not found", "NOT_FOUND", 404);
  }

  const result = await testProvider({
    providerType: provider.providerType,
    apiKeyRef: provider.apiKeyRef,
    baseUrl: provider.baseUrl,
    config: (provider.config as Record<string, unknown>) || {},
  });

  if (result.success && result.models.length > 0) {
    for (const model of result.models) {
      const [existing] = await db
        .select({ id: providerModels.id })
        .from(providerModels)
        .where(and(
          eq(providerModels.tenantId, auth.tenantId),
          eq(providerModels.providerId, id),
          eq(providerModels.modelId, model.modelId),
        ))
        .limit(1);

      if (existing) {
        await db.update(providerModels)
          .set({
            displayName: model.displayName,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            updatedAt: new Date(),
          })
          .where(eq(providerModels.id, existing.id));
      } else {
        await db.insert(providerModels).values({
          tenantId: auth.tenantId,
          providerId: id,
          modelId: model.modelId,
          displayName: model.displayName,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
        });
      }
    }

    const discoveredModelIds = result.models.map((m) => m.modelId);
    if (discoveredModelIds.length > 0) {
      await db.update(providerModels)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(providerModels.tenantId, auth.tenantId),
          eq(providerModels.providerId, id),
          eq(providerModels.isActive, true),
          notInArray(providerModels.modelId, discoveredModelIds),
        ));
    }

    await db.update(providers)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(providers.id, id));
  } else if (!result.success) {
    await db.update(providers)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(providers.id, id));
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "provider.test",
    resourceType: "provider",
    resourceId: id,
    details: {
      success: result.success,
      latencyMs: result.latencyMs,
      modelsDiscovered: result.models.length,
      error: result.error || null,
    },
  });

  return NextResponse.json(result);
});
