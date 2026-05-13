import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providers, providerModels } from "@ais-app/database";
import { eq, and, sql } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("KNOWLEDGE", 10, async (_request, auth) => {
  const db = getDb();

  const results = await db
    .select({
      providerId: providers.id,
      providerName: providers.name,
      providerType: providers.providerType,
      modelId: providerModels.modelId,
      modelDisplayName: providerModels.displayName,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(and(
      eq(providerModels.tenantId, auth.tenantId),
      eq(providerModels.isActive, true),
      eq(providers.isActive, true),
      sql`${providerModels.capabilities}::jsonb @> '"reranking"'::jsonb`,
    ));

  const providerMap = new Map<string, {
    id: string;
    name: string;
    providerType: string;
    models: Array<{ modelId: string; displayName: string }>;
  }>();

  for (const row of results) {
    if (!providerMap.has(row.providerId)) {
      providerMap.set(row.providerId, {
        id: row.providerId,
        name: row.providerName,
        providerType: row.providerType,
        models: [],
      });
    }
    providerMap.get(row.providerId)!.models.push({
      modelId: row.modelId,
      displayName: row.modelDisplayName,
    });
  }

  return NextResponse.json({ data: Array.from(providerMap.values()) });
});
