import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, sessions } from "@ais-app/database";
import { hashPassword, verifyPassword } from "@ais-app/auth";
import { changePasswordSchema } from "@ais-app/validation";
import { eq, and, isNull } from "drizzle-orm";
import { withAuth, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { canManage } from "@ais-app/auth";

export const PATCH = withAuth(async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("User ID required", "MISSING_ID", 400);

  const isSelf = id === auth.userId;
  const isAdmin = canManage(auth.accessRights, "USERS");

  if (!isSelf && !isAdmin) {
    return errorResponse("Insufficient permissions", "FORBIDDEN", 403);
  }

  const body = await request.json();
  const db = getDb();

  if (isSelf) {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
    }

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)))
      .limit(1);

    if (!user) return errorResponse("User not found", "NOT_FOUND", 404);

    const valid = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
    if (!valid) {
      return errorResponse("Current password is incorrect", "WRONG_PASSWORD", 401);
    }

    const newHash = await hashPassword(parsed.data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), requirePasswordChange: false })
      .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)));
  } else {
    const newPassword = body.newPassword;
    if (!newPassword || newPassword.length < 8 || newPassword.length > 64) {
      return errorResponse("Password must be between 8 and 64 characters", "VALIDATION_ERROR", 400);
    }
    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), requirePasswordChange: true })
      .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)));
  }

  await db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "user.password_change",
    resourceType: "user",
    resourceId: id,
    details: { changedBy: isSelf ? "self" : "admin", sessionsRevoked: true },
  });

  return NextResponse.json({ success: true });
});
