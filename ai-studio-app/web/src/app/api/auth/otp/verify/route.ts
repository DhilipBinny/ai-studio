import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { otp, users, profiles, sessions } from "@ais-app/database";
import { verifyOTP, signAccessToken, signRefreshToken, RateLimiter } from "@ais-app/auth";
import { otpVerifySchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { createHash } from "node:crypto";
import { errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

const otpLimiter = new RateLimiter(5, 15 * 60 * 1000);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = otpVerifySchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, {
      issues: parsed.error.issues,
    });
  }

  const { etus, otp: otpCode } = parsed.data;

  const rateCheck = otpLimiter.check(`otp:${etus}`);
  if (!rateCheck.allowed) {
    return errorResponse("Too many verification attempts", "RATE_LIMITED", 429);
  }

  const db = getDb();
  const ip = request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";

  const [otpRecord] = await db
    .select()
    .from(otp)
    .where(and(eq(otp.etus, etus), eq(otp.isActive, true)))
    .limit(1);

  if (!otpRecord) {
    return errorResponse("Invalid or expired verification session", "INVALID_OTP_SESSION", 401);
  }

  if (new Date(otpRecord.expiresAt) < new Date()) {
    await db.update(otp).set({ isActive: false }).where(eq(otp.id, otpRecord.id));
    return errorResponse("Verification code has expired", "OTP_EXPIRED", 401);
  }

  if (!verifyOTP(otpCode, otpRecord.otpCode)) {
    return errorResponse("Invalid verification code", "INVALID_OTP", 401);
  }

  await db.update(otp).set({ isActive: false }).where(eq(otp.id, otpRecord.id));

  const [user] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      profileId: users.profileId,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, otpRecord.userId))
    .limit(1);

  if (!user || !user.isActive) {
    return errorResponse("Account unavailable", "ACCOUNT_UNAVAILABLE", 401);
  }

  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lastLoginAt: new Date(), otpRequestCount: 0 })
    .where(eq(users.id, user.id));

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

  const refreshData = signRefreshToken();
  await db.insert(sessions).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: refreshData.hash,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  await createAuditEntry({
    tenantId: user.tenantId,
    userId: user.id,
    action: "auth.login",
    details: { method: "otp" },
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  });

  const response = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });

  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60,
  });

  response.cookies.set("refresh_token", refreshData.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
}
