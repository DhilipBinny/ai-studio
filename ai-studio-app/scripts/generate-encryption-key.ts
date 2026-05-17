/**
 * Generate a new AES-256-GCM encryption key for secrets at rest.
 *
 * Usage:
 *   npx tsx scripts/generate-encryption-key.ts
 *
 * Copy the output to your .env file:
 *   ENCRYPTION_KEY=<generated key>
 *
 * For key rotation, add as a new version:
 *   ENCRYPTION_KEY_V1=<old key>
 *   ENCRYPTION_KEY_V2=<new key>
 *   ENCRYPTION_KEY_VERSION=2
 */

import { randomBytes } from "crypto";
import { BRAND_NAME } from "@ais-app/types";

const key = randomBytes(32).toString("hex");

console.log(`=== ${BRAND_NAME} — Encryption Key Generator ===\n`);
console.log("Generated AES-256-GCM key (64 hex characters = 256 bits):\n");
console.log(`  ENCRYPTION_KEY=${key}\n`);
console.log("Add this to your .env files:");
console.log("  - ai-studio-app/web/.env");
console.log("  - ai-studio-app/.env\n");
console.log("IMPORTANT:");
console.log("  - Keep this key SECRET — anyone with it can decrypt all stored credentials");
console.log("  - Back it up securely — losing it means all encrypted secrets become unreadable");
console.log("  - Never commit it to git\n");
