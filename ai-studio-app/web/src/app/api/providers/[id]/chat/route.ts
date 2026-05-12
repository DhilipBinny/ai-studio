import { NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providers, providerModels } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { quickChat } from "@/lib/services/provider-chat";

export const POST = withRBAC("PROVIDERS", 10, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const body = await request.json();
  const { modelId, message } = body as { modelId?: string; message?: string };

  if (!modelId || !message) {
    return errorResponse("modelId and message are required", "VALIDATION_ERROR", 400);
  }

  const db = getDb();

  const [provider] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!provider) return errorResponse("Provider not found", "NOT_FOUND", 404);

  const result = await quickChat({
    providerType: provider.providerType,
    apiKeyRef: provider.apiKeyRef,
    baseUrl: provider.baseUrl,
    config: (provider.config as Record<string, unknown>) || {},
    modelId,
    message,
  });

  return NextResponse.json(result);
});
