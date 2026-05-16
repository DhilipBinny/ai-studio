import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { sessions, users, profiles } from "@ais-app/database";
import { hashToken, signAccessToken, signRefreshToken } from "@ais-app/auth";
import { eq, and, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { errorResponse } from "@/lib/api-utils";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("refresh_token")?.value;
    if (!refreshToken) {
      return errorResponse("Refresh token required", "NO_REFRESH_TOKEN", 401);
    }

    const db = getDb();
    const tokenHash = hashToken(refreshToken);

    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .limit(1);

    if (!session || new Date(session.expiresAt) < new Date()) {
      return errorResponse("Invalid or expired refresh token", "INVALID_REFRESH", 401);
    }

    // Revoke old token
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.id));

    const [user] = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        profileId: users.profileId,
        role: users.role,
        isActive: users.isActive,
        isLocked: users.isLocked,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user || !user.isActive || user.isLocked) {
      return errorResponse("Account unavailable", "ACCOUNT_UNAVAILABLE", 401);
    }

    let accessRightsHash = "";
    if (user.profileId) {
      const [profile] = await db
        .select({ accessRights: profiles.accessRights })
        .from(profiles)
        .where(eq(profiles.id, user.profileId))
        .limit(1);

      if (profile) {
        const sorted = JSON.stringify(profile.accessRights, Object.keys(profile.accessRights as object).sort());
        accessRightsHash = createHash("sha256").update(sorted).digest("hex");
      }
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      profileId: user.profileId || "",
      role: user.role,
      accessRightsHash,
    });

    const newRefresh = signRefreshToken();
    await db.insert(sessions).values({
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash: newRefresh.hash,
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const response = NextResponse.json({ success: true });

    response.cookies.set("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 15 * 60,
    });

    response.cookies.set("refresh_token", newRefresh.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/refresh",
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error("Refresh token error:", err);
    return errorResponse("Internal server error", "INTERNAL_ERROR", 500);
  }
}
