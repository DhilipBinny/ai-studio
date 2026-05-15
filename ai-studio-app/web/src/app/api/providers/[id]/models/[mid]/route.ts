import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providerModels } from "@ais-app/database";
import { updateModelSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const PATCH = withRBAC("PROVIDERS", 20, async (request, auth, params) => {
  const mid = params?.mid;
  if (!mid) return errorResponse("Model ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateModelSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();

  const [existing] = await db
    .select({ id: providerModels.id })
    .from(providerModels)
    .where(and(eq(providerModels.id, mid), eq(providerModels.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("Model not found", "NOT_FOUND", 404);

  const [updated] = await db
    .update(providerModels)
    .set(parsed.data)
    .where(eq(providerModels.id, mid))
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "provider_model.update",
    resourceType: "provider_model",
    resourceId: mid,
    details: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json(updated);
});
