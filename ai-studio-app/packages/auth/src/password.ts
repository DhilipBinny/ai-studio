import { hash, verify } from "@node-rs/argon2";
import { AUTH_CONFIG } from "./config";

const ARGON2_CONFIG = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export async function hashPassword(password: string): Promise<string> {
  if (password.length < AUTH_CONFIG.password.minLength || password.length > AUTH_CONFIG.password.maxLength) {
    throw new Error(`Password must be between ${AUTH_CONFIG.password.minLength} and ${AUTH_CONFIG.password.maxLength} characters`);
  }
  return hash(password, ARGON2_CONFIG);
}

export async function verifyPassword(
  storedHash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch (err) {
    if (err instanceof Error && err.message.includes("argon2")) {
      return false;
    }
    throw err;
  }
}
