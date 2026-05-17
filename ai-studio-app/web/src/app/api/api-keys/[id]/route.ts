import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { apiKeys } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const DELETE = withRBAC("SETTINGS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("API key ID required", "MISSING_ID", 400);

  const db = getDb();
  const [key] = await db
    .select({ id: apiKeys.id, name: apiKeys.name })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, auth.tenantId)))
    .limit(1);

  if (!key) return errorResponse("API key not found", "NOT_FOUND", 404);

  await db
    .update(apiKeys)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(apiKeys.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "api_key.revoke",
    resourceType: "api_key",
    resourceId: id,
    details: { name: key.name },
  });

  return NextResponse.json({ success: true });
});
