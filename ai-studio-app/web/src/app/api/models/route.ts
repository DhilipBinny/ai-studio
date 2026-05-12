import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providerModels, providers } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("PROVIDERS", 10, async (_request, auth) => {
  const db = getDb();

  const data = await db
    .select({
      id: providerModels.id,
      modelId: providerModels.modelId,
      displayName: providerModels.displayName,
      capabilities: providerModels.capabilities,
      contextWindow: providerModels.contextWindow,
      maxOutputTokens: providerModels.maxOutputTokens,
      costPerInputToken: providerModels.costPerInputToken,
      costPerOutputToken: providerModels.costPerOutputToken,
      isActive: providerModels.isActive,
      providerName: providers.name,
      providerType: providers.providerType,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(
      and(
        eq(providerModels.tenantId, auth.tenantId),
        eq(providerModels.isActive, true),
        eq(providers.isActive, true)
      )
    );

  return NextResponse.json({ data });
});
