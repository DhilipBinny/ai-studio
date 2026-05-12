import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, profiles } from "@ais-app/database";
import { hashPassword, validatePassword, checkBreached } from "@ais-app/auth";
import { createUserSchema, paginationSchema } from "@ais-app/validation";
import { eq, and, count, asc, desc, ilike } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("USERS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const search = url.searchParams.get("search");

  const showAll = url.searchParams.get("showAll") === "true";
  const conditions = [eq(users.tenantId, auth.tenantId)];
  if (!showAll) conditions.push(eq(users.isActive, true));
  if (search) conditions.push(ilike(users.email, `%${search}%`));

  const where = and(...conditions);
  const orderBy = pagination.sortOrder === "asc" ? asc(users.createdAt) : desc(users.createdAt);

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        profileId: users.profileId,
        profileName: profiles.name,
        isActive: users.isActive,
        isLocked: users.isLocked,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(profiles, eq(users.profileId, profiles.id))
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return NextResponse.json({
    data,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(total / pagination.pageSize),
  });
});

export const POST = withRBAC("USERS", 20, async (request, auth) => {
  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, {
      issues: parsed.error.issues,
    });
  }

  const db = getDb();
  const { email, name, password, role, profileId } = parsed.data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, auth.tenantId), eq(users.email, email)))
    .limit(1);

  if (existing) {
    return errorResponse("Email already exists", "EMAIL_EXISTS", 409);
  }

  if (profileId) {
    const [profile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.id, profileId), eq(profiles.tenantId, auth.tenantId)))
      .limit(1);
    if (!profile) {
      return errorResponse("Profile not found", "PROFILE_NOT_FOUND", 404);
    }
  }

  const validation = validatePassword(password, [email]);
  if (!validation.valid) {
    return errorResponse(validation.errors[0] || "Password too weak", "WEAK_PASSWORD", 400);
  }

  const breach = await checkBreached(password);
  if (breach.breached) {
    return errorResponse(
      "This password has appeared in data breaches. Choose a different one.",
      "BREACHED_PASSWORD",
      400
    );
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      tenantId: auth.tenantId,
      email,
      name,
      passwordHash,
      role,
      profileId: profileId || null,
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      profileId: users.profileId,
      createdAt: users.createdAt,
    });

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "user.create",
    resourceType: "user",
    resourceId: user.id,
    details: { email, role },
  });

  return NextResponse.json(user, { status: 201 });
});
