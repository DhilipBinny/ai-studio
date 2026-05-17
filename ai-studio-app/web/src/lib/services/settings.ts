import { getDb } from "@ais-app/database";
import { systemConfig } from "@ais-app/database";
import { eq } from "drizzle-orm";
import { validateConfigValue, SYSTEM_CONFIG_SCHEMA } from "@ais-app/types";
import { createAuditEntry } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigEntry {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// getSettings — all config values for a tenant
// ---------------------------------------------------------------------------

export async function getSettings(tenantId: string) {
  const db = getDb();

  const data = await db
    .select({
      id: systemConfig.id,
      key: systemConfig.key,
      value: systemConfig.value,
      updatedAt: systemConfig.updatedAt,
    })
    .from(systemConfig)
    .where(eq(systemConfig.tenantId, tenantId));

  return { data };
}

// ---------------------------------------------------------------------------
// updateSettings — validate + upsert
// ---------------------------------------------------------------------------

export async function updateSettings(
  tenantId: string,
  entries: ConfigEntry[],
  userId: string,
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ValidationError("entries array required");
  }

  const db = getDb();

  for (const entry of entries) {
    const schema = SYSTEM_CONFIG_SCHEMA.find((s) => s.key === entry.key);
    if (schema && typeof entry.value === "object" && entry.value !== null) {
      const validation = validateConfigValue(
        entry.key,
        entry.value as Record<string, unknown>,
      );
      if (!validation.valid) {
        throw new ValidationError(validation.errors[0], validation.errors);
      }
    }

    await db
      .insert(systemConfig)
      .values({
        tenantId,
        key: entry.key,
        value: entry.value,
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: [systemConfig.tenantId, systemConfig.key],
        set: { value: entry.value, updatedBy: userId },
      });
  }

  await createAuditEntry({
    tenantId,
    userId,
    action: "settings.update",
    resourceType: "system_config",
    details: { keys: entries.map((e) => e.key) },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  public errors: string[];

  constructor(message: string, errors?: string[]) {
    super(message);
    this.name = "ValidationError";
    this.errors = errors ?? [message];
  }
}
