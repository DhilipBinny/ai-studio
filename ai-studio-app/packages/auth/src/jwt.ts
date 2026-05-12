import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { JWTPayload } from "@ais-app/types";

const ISSUER = "ais";
const AUDIENCE = "ais-app";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: {
  userId: string;
  tenantId: string;
  profileId: string;
  role: string;
  accessRightsHash: string;
}): Promise<string> {
  const secret = getSecret();
  return new SignJWT({
    sub: payload.userId,
    tid: payload.tenantId,
    pid: payload.profileId,
    rol: payload.role,
    arh: payload.accessRightsHash,
  } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyAccessToken(
  token: string
): Promise<JWTPayload> {
  const secret = getSecret();
  const { payload } = await jwtVerify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return payload as unknown as JWTPayload;
}

export function signRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  const hash = hashToken(token);
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
