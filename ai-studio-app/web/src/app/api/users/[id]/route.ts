import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, profiles } from "@ais-app/database";
import { updateUserSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("USERS", 10, async (_request, auth, params) => {
  const db = getDb();
  const id = params?.id;
  if (!id) return errorResponse("User ID required", "MISSING_ID", 400);

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
      profileId: users.profileId,
      settings: users.settings,
      isLocked: users.isLocked,
      failedLoginAttempts: users.failedLoginAttempts,
      lastLoginAt: users.lastLoginAt,
      passwordChangedAt: users.passwordChangedAt,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)))
    .limit(1);

  if (!user) return errorResponse("User not found", "NOT_FOUND", 404);

  let profile = null;
  if (user.profileId) {
    const [p] = await db
      .select({ id: profiles.id, name: profiles.name, accessRights: profiles.accessRights })
      .from(profiles)
      .where(eq(profiles.id, user.profileId))
      .limit(1);
    profile = p || null;
  }

  return NextResponse.json({ ...user, profile });
});

const ROLE_RANK: Record<string, number> = { super_admin: 40, admin: 30, member: 20, viewer: 10 };

export const PATCH = withRBAC("USERS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("User ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  if (parsed.data.role !== undefined) {
    const callerRank = ROLE_RANK[auth.role] ?? 0;
    const targetRank = ROLE_RANK[parsed.data.role] ?? 0;
    if (targetRank >= callerRank) {
      return errorResponse("Cannot assign role equal to or above your own", "ROLE_ESCALATION", 403);
    }
    if (id === auth.userId) {
      return errorResponse("Cannot change your own role", "SELF_ROLE_CHANGE", 403);
    }
  }

  const db = getDb();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("User not found", "NOT_FOUND", 404);

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.role !== undefined) updateData.role = parsed.data.role;
  if (parsed.data.profileId !== undefined) updateData.profileId = parsed.data.profileId;
  if (parsed.data.settings !== undefined) updateData.settings = parsed.data.settings;

  if (Object.keys(updateData).length === 0) {
    return errorResponse("No fields to update", "NO_CHANGES", 400);
  }

  const [updated] = await db
    .update(users)
    .set(updateData)
    .where(and(eq(users.id, id), eq(users.tenantId, auth.tenantId)))
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "user.update",
    resourceType: "user",
    resourceId: id,
    details: { fields: Object.keys(updateData) },
  });

  return NextResponse.json(updated);
});
