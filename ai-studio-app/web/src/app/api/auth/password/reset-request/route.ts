import { NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { users, passwordResetRequests } from "@ais-app/database";
import { passwordResetRequestSchema } from "@ais-app/validation";
import { hashToken, AUTH_CONFIG } from "@ais-app/auth";
import { sendEmail } from "@ais-app/email";
import { eq, and } from "drizzle-orm";
import { errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { randomBytes } from "node:crypto";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = passwordResetRequestSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse("Invalid input", "VALIDATION_ERROR", 400);
  }

  const db = getDb();
  const { email } = parsed.data;

  const [user] = await db
    .select({ id: users.id, tenantId: users.tenantId, name: users.name, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.tenantId, DEFAULT_TENANT_ID), eq(users.email, email)))
    .limit(1);

  if (!user || !user.isActive) {
    return NextResponse.json({ success: true });
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  await db.insert(passwordResetRequests).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + AUTH_CONFIG.password.resetTokenExpiryMinutes * 60 * 1000),
  });

  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/reset-password?token=${token}`;

  try {
    await sendEmail({
      to: email,
      subject: "Reset your password — Echol AI Studio",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #811a1b;">Echol AI Studio</h2>
          <p>Hi ${user.name || "there"},</p>
          <p>We received a request to reset your password. Click the link below to set a new password:</p>
          <p style="margin: 24px 0;">
            <a href="${resetUrl}" style="background: #811a1b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Reset Password
            </a>
          </p>
          <p style="color: #666; font-size: 13px;">This link expires in ${AUTH_CONFIG.password.resetTokenExpiryMinutes} minutes. If you didn't request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
          <p style="color: #999; font-size: 11px;">Echol Technology Pte Ltd</p>
        </div>
      `,
    });
  } catch {
    // Email delivery failure — don't expose to user
  }

  await createAuditEntry({
    tenantId: user.tenantId,
    userId: user.id,
    action: "auth.password_reset_request",
    resourceType: "user",
    resourceId: user.id,
    details: {},
  });

  return NextResponse.json({ success: true });
}
