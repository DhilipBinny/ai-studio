import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, profiles, sessions, otp, systemConfig } from "@ais-app/database";
import { verifyPassword, signAccessToken, signRefreshToken, generateOTP } from "@ais-app/auth";
import { loginSchema } from "@ais-app/validation";
import { sendEmail, buildOTPEmail } from "@ais-app/email";
import { eq, and } from "drizzle-orm";
import { createHash } from "node:crypto";
import { errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { RateLimiter } from "@ais-app/auth";

const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);

const GENERIC_AUTH_ERROR = "Invalid email or password";
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, {
      issues: parsed.error.issues,
    });
  }

  const { email, password } = parsed.data;
  const ip = request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const limitKey = `login:${ip}:${email}`;

  const rateCheck = loginLimiter.check(limitKey);
  if (!rateCheck.allowed) {
    return errorResponse("Too many login attempts. Try again later.", "RATE_LIMITED", 429);
  }

  const db = getDb();

  const [user] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      profileId: users.profileId,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      role: users.role,
      isActive: users.isActive,
      isLocked: users.isLocked,
      failedLoginAttempts: users.failedLoginAttempts,
      otpRequestCount: users.otpRequestCount,
      otpBlockedUntil: users.otpBlockedUntil,
    })
    .from(users)
    .where(and(eq(users.tenantId, DEFAULT_TENANT_ID), eq(users.email, email)))
    .limit(1);

  if (!user || !user.isActive || user.isLocked) {
    return errorResponse(GENERIC_AUTH_ERROR, "INVALID_CREDENTIALS", 401);
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    const newAttempts = user.failedLoginAttempts + 1;
    const maxAttempts = 10;

    const updates: Record<string, unknown> = {
      failedLoginAttempts: newAttempts,
    };

    if (newAttempts >= maxAttempts) {
      updates.isLocked = true;
      updates.lockedAt = new Date();
    }

    await db.update(users).set(updates).where(eq(users.id, user.id));

    await createAuditEntry({
      tenantId: user.tenantId,
      userId: user.id,
      action: "auth.login_failed",
      details: { reason: "invalid_password", attempts: newAttempts },
      ipAddress: ip,
      userAgent: request.headers.get("user-agent"),
    });

    return errorResponse(GENERIC_AUTH_ERROR, "INVALID_CREDENTIALS", 401);
  }

  const [authConfig] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(
      and(
        eq(systemConfig.tenantId, user.tenantId),
        eq(systemConfig.key, "auth")
      )
    )
    .limit(1);

  const authSettings = (authConfig?.value ?? {}) as Record<string, unknown>;
  const enable2FA = authSettings.enable_2fa === true;

  if (enable2FA) {
    if (user.otpBlockedUntil && new Date(user.otpBlockedUntil) > new Date()) {
      return errorResponse("Too many OTP requests. Try again later.", "OTP_BLOCKED", 429);
    }

    const maxResend = (authSettings.otp_max_resend as number) || 5;
    const blockMinutes = (authSettings.otp_block_duration_minutes as number) || 30;

    if (user.otpRequestCount >= maxResend) {
      await db.update(users).set({
        otpBlockedUntil: new Date(Date.now() + blockMinutes * 60 * 1000),
        otpRequestCount: 0,
      }).where(eq(users.id, user.id));
      return errorResponse("Too many OTP requests. Try again later.", "OTP_BLOCKED", 429);
    }

    await db.update(otp).set({ isActive: false })
      .where(and(eq(otp.userId, user.id), eq(otp.isActive, true)));

    const otpData = generateOTP();

    await db.insert(otp).values({
      tenantId: user.tenantId,
      userId: user.id,
      etus: otpData.etus,
      otpCode: otpData.hashedCode,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await db
      .update(users)
      .set({ otpRequestCount: user.otpRequestCount + 1 })
      .where(eq(users.id, user.id));

    const emailContent = buildOTPEmail(otpData.code);
    try {
      await sendEmail({ to: user.email, ...emailContent });
    } catch {
      // OTP stored in DB — delivery failure is non-blocking
    }

    return NextResponse.json({ requires_otp: true, etus: otpData.etus });
  }

  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lastLoginAt: new Date() })
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
    details: { email: user.email, role: user.role },
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
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
