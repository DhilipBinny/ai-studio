import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, profiles } from "@ais-app/database";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/api-utils";

export const GET = withAuth(async (_request: NextRequest, auth) => {
  const db = getDb();

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      avatarUrl: users.avatarUrl,
      settings: users.settings,
      profileId: users.profileId,
      tenantId: users.tenantId,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let profile = null;
  if (user.profileId) {
    const [p] = await db
      .select({
        id: profiles.id,
        name: profiles.name,
        accessRights: profiles.accessRights,
      })
      .from(profiles)
      .where(eq(profiles.id, user.profileId))
      .limit(1);
    profile = p || null;
  }

  return NextResponse.json({
    user: {
      ...user,
      profile,
      accessRights: profile?.accessRights ?? auth.accessRights,
    },
  });
});
