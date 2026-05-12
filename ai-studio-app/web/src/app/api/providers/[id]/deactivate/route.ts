import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { providers } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("PROVIDERS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Provider ID required", "MISSING_ID", 400);

  const db = getDb();

  const [provider] = await db
    .select({ id: providers.id, name: providers.name })
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, auth.tenantId)))
    .limit(1);

  if (!provider) return errorResponse("Provider not found", "NOT_FOUND", 404);

  await db
    .update(providers)
    .set({ isActive: false, deactivatedAt: new Date(), status: "inactive" })
    .where(eq(providers.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "provider.deactivate",
    resourceType: "provider",
    resourceId: id,
    details: { name: provider.name },
  });

  return NextResponse.json({ success: true });
});
