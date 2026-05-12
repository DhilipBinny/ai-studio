import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { sessions } from "@ais-app/database";
import { hashToken } from "@ais-app/auth";
import { eq } from "drizzle-orm";
import { withAuth, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withAuth(async (request: NextRequest, auth) => {
  const db = getDb();
  const refreshToken = request.cookies.get("refresh_token")?.value;

  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, tokenHash));
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "auth.logout",
    details: {},
  });

  const response = NextResponse.json({ success: true });
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
  return response;
});
