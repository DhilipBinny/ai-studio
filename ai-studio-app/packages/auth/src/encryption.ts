import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKeys(): Record<number, Buffer> {
  const keys: Record<number, Buffer> = {};
  for (const [envKey, envVal] of Object.entries(process.env)) {
    const match = envKey.match(/^ENCRYPTION_KEY(?:_V(\d+))?$/);
    if (match && envVal && envVal.length >= 64) {
      const version = match[1] ? parseInt(match[1]) : 1;
      keys[version] = Buffer.from(envVal.slice(0, 64), "hex");
    }
  }
  return keys;
}

function getCurrentVersion(): number {
  return parseInt(process.env.ENCRYPTION_KEY_VERSION || "1");
}

export function encryptSecret(plaintext: string): string {
  const version = getCurrentVersion();
  const keys = getKeys();
  const key = keys[version];
  if (!key) throw new Error("ENCRYPTION_KEY not configured. Set a 64-character hex key in .env");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v${version}:${iv.toString("base64")}:${encrypted.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new Error("Invalid encrypted value format. Expected v{n}:iv:ciphertext:tag");
  }

  const version = parseInt(parts[0].slice(1));
  const keys = getKeys();
  const key = keys[version];
  if (!key) throw new Error(`Encryption key version ${version} not found. Check ENCRYPTION_KEY env var.`);

  const iv = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export function isEncrypted(value: string): boolean {
  return /^v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*:[A-Za-z0-9+/=]+$/.test(value);
}
