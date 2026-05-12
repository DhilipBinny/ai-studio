import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { profiles } from "@ais-app/database";
import { createProfileSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("PROFILES", 10, async (_request, auth) => {
  const db = getDb();
  const data = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.tenantId, auth.tenantId), eq(profiles.isActive, true)))
    .orderBy(profiles.name);

  return NextResponse.json({ data });
});

export const POST = withRBAC("PROFILES", 20, async (request, auth) => {
  const body = await request.json();
  const parsed = createProfileSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();

  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.tenantId, auth.tenantId), eq(profiles.name, parsed.data.name)))
    .limit(1);

  if (existing) {
    return errorResponse("Profile name already exists", "NAME_EXISTS", 409);
  }

  const [profile] = await db
    .insert(profiles)
    .values({
      tenantId: auth.tenantId,
      name: parsed.data.name,
      description: parsed.data.description || "",
      accessRights: parsed.data.accessRights,
    })
    .returning();

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "profile.create",
    resourceType: "profile",
    resourceId: profile.id,
    details: { name: parsed.data.name },
  });

  return NextResponse.json(profile, { status: 201 });
});
