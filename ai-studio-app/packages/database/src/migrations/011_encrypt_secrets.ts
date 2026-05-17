/**
 * Migration 011: Encrypt all existing plaintext secrets
 *
 * Run with: npx tsx packages/database/src/migrations/011_encrypt_secrets.ts
 *
 * This script reads all providers and connectors with plaintext secrets
 * and encrypts them using AES-256-GCM. Requires ENCRYPTION_KEY in env.
 */

import postgres from "postgres";
import { encryptSecret, isEncrypted } from "../../../auth/src/encryption";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://aistudio:aistudio_dev_2026@localhost:5480/aistudio";

async function main() {
  console.log("=== Migration 011: Encrypt existing plaintext secrets ===\n");

  if (!process.env.ENCRYPTION_KEY) {
    console.error("ERROR: ENCRYPTION_KEY environment variable is required.");
    console.error("Generate one with: openssl rand -hex 32");
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL);
  let providersEncrypted = 0;
  let connectorsEncrypted = 0;

  try {
    // 1. Encrypt provider API keys
    const providers = await sql`SELECT id, name, api_key_ref FROM providers WHERE api_key_ref IS NOT NULL AND is_active = true`;

    for (const provider of providers) {
      const value = provider.api_key_ref as string;
      if (isEncrypted(value)) {
        console.log(`  Provider "${provider.name}": already encrypted, skipping`);
        continue;
      }

      const encrypted = encryptSecret(value);
      await sql`UPDATE providers SET api_key_ref = ${encrypted}, updated_at = NOW() WHERE id = ${provider.id}`;
      providersEncrypted++;
      console.log(`  Provider "${provider.name}": encrypted`);
    }

    // 2. Encrypt connector env vars in connection_config
    const mcpConnectors = await sql`SELECT id, name, connection_config FROM connectors WHERE connector_type = 'mcp' AND is_active = true`;

    for (const connector of mcpConnectors) {
      const config = connector.connection_config as Record<string, unknown>;
      const env = config?.env as Record<string, string> | undefined;

      if (!env || Object.keys(env).length === 0) {
        console.log(`  Connector "${connector.name}": no env vars, skipping`);
        continue;
      }

      let anyEncrypted = false;
      const newEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(env)) {
        if (isEncrypted(value)) {
          newEnv[key] = value;
          continue;
        }
        newEnv[key] = encryptSecret(value);
        anyEncrypted = true;
      }

      if (anyEncrypted) {
        const newConfig = { ...config, env: newEnv };
        await sql`UPDATE connectors SET connection_config = ${JSON.stringify(newConfig)}::jsonb, updated_at = NOW() WHERE id = ${connector.id}`;
        connectorsEncrypted++;
        console.log(`  Connector "${connector.name}": env vars encrypted`);
      } else {
        console.log(`  Connector "${connector.name}": already encrypted, skipping`);
      }
    }

    // 3. Encrypt credentialsRef on connectors
    const connWithCreds = await sql`SELECT id, name, credentials_ref FROM connectors WHERE credentials_ref IS NOT NULL AND is_active = true`;

    for (const conn of connWithCreds) {
      const value = conn.credentials_ref as string;
      if (isEncrypted(value)) continue;

      const encrypted = encryptSecret(value);
      await sql`UPDATE connectors SET credentials_ref = ${encrypted}, updated_at = NOW() WHERE id = ${conn.id}`;
      console.log(`  Connector "${conn.name}": credentials_ref encrypted`);
    }

    console.log(`\n=== Done ===`);
    console.log(`  Providers encrypted: ${providersEncrypted}`);
    console.log(`  Connectors encrypted: ${connectorsEncrypted}`);

  } catch (e) {
    console.error("Migration failed:", (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
