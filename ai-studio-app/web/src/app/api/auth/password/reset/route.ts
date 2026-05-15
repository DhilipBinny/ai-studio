import { NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, passwordResetRequests, sessions, passwordHistory } from "@ais-app/database";
import { passwordResetSchema } from "@ais-app/validation";
import { hashPassword, hashToken, validatePassword, checkBreached, checkPasswordHistory, AUTH_CONFIG } from "@ais-app/auth";
import { eq, and, isNull, desc } from "drizzle-orm";
import { errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export async function POST(request: Request) {
  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = passwordResetSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });
  }

  const db = getDb();
  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const [resetRequest] = await db
    .select()
    .from(passwordResetRequests)
    .where(and(eq(passwordResetRequests.tokenHash, tokenHash), isNull(passwordResetRequests.usedAt)))
    .limit(1);

  if (!resetRequest) {
    return errorResponse("Invalid or expired reset link", "INVALID_TOKEN", 400);
  }

  if (new Date(resetRequest.expiresAt) < new Date()) {
    return errorResponse("Reset link has expired", "TOKEN_EXPIRED", 400);
  }

  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return errorResponse(validation.errors[0] || "Password too weak", "WEAK_PASSWORD", 400);
  }

  const breach = await checkBreached(newPassword);
  if (breach.breached) {
    return errorResponse("This password has appeared in data breaches. Choose a different one.", "BREACHED_PASSWORD", 400);
  }

  const history = await db.select({ passwordHash: passwordHistory.passwordHash })
    .from(passwordHistory).where(eq(passwordHistory.userId, resetRequest.userId))
    .orderBy(desc(passwordHistory.createdAt)).limit(AUTH_CONFIG.password.historyCount);
  const historyCheck = await checkPasswordHistory(newPassword, history.map((h) => h.passwordHash));
  if (historyCheck.reused) {
    return errorResponse(historyCheck.error!, "PASSWORD_REUSED", 400);
  }

  const newHash = await hashPassword(newPassword);

  await db.insert(passwordHistory).values({
    tenantId: resetRequest.tenantId,
    userId: resetRequest.userId,
    passwordHash: newHash,
  });

  await db.update(users).set({
    passwordHash: newHash,
    passwordChangedAt: new Date(),
    failedLoginAttempts: 0,
    isLocked: false,
    lockedAt: null,
    requirePasswordChange: false,
  }).where(eq(users.id, resetRequest.userId));

  await db.update(passwordResetRequests).set({
    usedAt: new Date(),
  }).where(eq(passwordResetRequests.id, resetRequest.id));

  await db.update(sessions).set({
    revokedAt: new Date(),
  }).where(and(eq(sessions.userId, resetRequest.userId), isNull(sessions.revokedAt)));

  await createAuditEntry({
    tenantId: resetRequest.tenantId,
    userId: resetRequest.userId,
    action: "auth.password_reset",
    resourceType: "user",
    resourceId: resetRequest.userId,
    details: {},
  });

  return NextResponse.json({ success: true });
}
