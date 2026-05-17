import { NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("USERS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("User ID required", "MISSING_ID", 400);

  const db = getDb();

  const [user] = await db
    .select({ id: users.id, email: users.email, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)))
    .limit(1);

  if (!user) return errorResponse("User not found", "NOT_FOUND", 404);
  if (user.isActive) return errorResponse("User is already active", "ALREADY_ACTIVE", 400);

  await db
    .update(users)
    .set({ isActive: true, deactivatedAt: null })
    .where(eq(users.id, id));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "user.reactivate",
    resourceType: "user",
    resourceId: id,
    details: { email: user.email },
  });

  return NextResponse.json({ success: true });
});
