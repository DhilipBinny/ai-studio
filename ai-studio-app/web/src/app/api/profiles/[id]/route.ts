import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { profiles } from "@ais-app/database";
import { updateProfileSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const PATCH = withRBAC("PROFILES", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Profile ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();

  const [existing] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, id), eq(profiles.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("Profile not found", "NOT_FOUND", 404);

  if (existing.isSystem && parsed.data.name && parsed.data.name !== existing.name) {
    return errorResponse("Cannot rename system profile", "SYSTEM_PROFILE", 400);
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.accessRights !== undefined) updateData.accessRights = parsed.data.accessRights;

  const [updated] = await db.update(profiles).set(updateData).where(and(eq(profiles.id, id), eq(profiles.tenantId, auth.tenantId))).returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "profile.update",
    resourceType: "profile",
    resourceId: id,
    details: { fields: Object.keys(updateData) },
  });

  return NextResponse.json(updated);
});

export const DELETE = withRBAC("PROFILES", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Profile ID required", "MISSING_ID", 400);

  const db = getDb();

  const [existing] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.id, id), eq(profiles.tenantId, auth.tenantId)))
    .limit(1);

  if (!existing) return errorResponse("Profile not found", "NOT_FOUND", 404);
  if (existing.isSystem) return errorResponse("Cannot delete system profile", "SYSTEM_PROFILE", 400);

  await db.update(profiles).set({ isActive: false }).where(and(eq(profiles.id, id), eq(profiles.tenantId, auth.tenantId)));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "profile.delete",
    resourceType: "profile",
    resourceId: id,
    details: { name: existing.name },
  });

  return NextResponse.json({ success: true });
});
