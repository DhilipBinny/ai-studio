import nodemailer from "nodemailer";
import { BRAND_NAME, BRAND_HEX, BRAND_EMAIL_FROM, BRAND_COMPANY } from "@ais-app/types";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const t = getTransporter();
  await t.sendMail({
    from: process.env.SMTP_FROM || BRAND_EMAIL_FROM,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildOTPEmail(code: string): { subject: string; html: string } {
  const safeCode = escapeHtml(code);
  return {
    subject: `Your verification code - ${BRAND_NAME}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
        <h2 style="color: ${BRAND_HEX};">${BRAND_NAME}</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 24px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
          ${safeCode}
        </div>
        <p style="color: #666; font-size: 14px;">This code expires in 5 minutes. Do not share it with anyone.</p>
      </div>
    `,
  };
}

export function buildPasswordResetEmail(resetUrl: string): {
  subject: string;
  html: string;
} {
  return {
    subject: `Password reset - ${BRAND_NAME}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
        <h2 style="color: ${BRAND_HEX};">${BRAND_NAME}</h2>
        <p>A password reset was requested for your account.</p>
        <a href="${escapeHtml(resetUrl)}" style="display: inline-block; padding: 12px 24px; background: ${BRAND_HEX}; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  };
}
