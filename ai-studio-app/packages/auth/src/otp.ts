import { randomInt, randomUUID, createHash, timingSafeEqual } from "node:crypto";

export function generateOTP(): { code: string; hashedCode: string; etus: string } {
  const code = randomInt(0, 999999).toString().padStart(6, "0");
  const hashedCode = hashOTP(code);
  const etus = randomUUID();
  return { code, hashedCode, etus };
}

export function hashOTP(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function verifyOTP(code: string, hashedCode: string): boolean {
  const hashed = Buffer.from(hashOTP(code), "hex");
  const expected = Buffer.from(hashedCode, "hex");
  if (hashed.length !== expected.length) return false;
  return timingSafeEqual(hashed, expected);
}
