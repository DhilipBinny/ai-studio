import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { sessions, revokedTokens } from "@ais-app/database";
import { hashToken, verifyAccessToken } from "@ais-app/auth";
import { eq } from "drizzle-orm";
import { withAuth, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withAuth(async (request: NextRequest, auth) => {
  const db = getDb();
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const accessToken = request.cookies.get("access_token")?.value;

  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, tokenHash));
  }

  if (accessToken) {
    try {
      const payload = await verifyAccessToken(accessToken);
      if (payload.jti) {
        await db.insert(revokedTokens).values({
          jti: payload.jti,
          userId: auth.userId,
          reason: "logout",
          expiresAt: new Date(payload.exp * 1000),
        }).onConflictDoNothing();
      }
    } catch {
      // token might already be invalid — ignore
    }
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "auth.logout",
    details: { sessionRevoked: !!refreshToken },
    ipAddress: request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  });

  const response = NextResponse.json({ success: true });
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
  return response;
});
