import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providerModels, providers } from "@ais-app/database";
import { createModelSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("PROVIDERS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const db = getDb();
  const models = await db
    .select()
    .from(providerModels)
    .where(and(eq(providerModels.providerId, id), eq(providerModels.tenantId, auth.tenantId)));

  return NextResponse.json({ data: models });
});

export const POST = withRBAC("PROVIDERS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = createModelSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();

  const [provider] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!provider) return errorResponse("Provider not found", "NOT_FOUND", 404);

  const [model] = await db
    .insert(providerModels)
    .values({
      tenantId: auth.tenantId,
      providerId: id,
      modelId: parsed.data.modelId,
      displayName: parsed.data.displayName,
      capabilities: parsed.data.capabilities || [],
      contextWindow: parsed.data.contextWindow || null,
      maxOutputTokens: parsed.data.maxOutputTokens || null,
      costPerInputToken: parsed.data.costPerInputToken || "0",
      costPerOutputToken: parsed.data.costPerOutputToken || "0",
    })
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "provider_model.create",
    resourceType: "provider_model",
    resourceId: model.id,
    details: { modelId: parsed.data.modelId, providerId: id },
  });

  return NextResponse.json(model, { status: 201 });
});
