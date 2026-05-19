import { getDb } from "@ais-app/database";
import { systemConfig } from "@ais-app/database";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Centralized Defaults — single source of truth for all agent runtime config
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  MAX_TOOL_ROUNDS: 100,
  DEFAULT_MAX_TOKENS_PER_TURN: 16384,
  WORKFLOW_NODE_TIMEOUT_MS: 1_800_000,
  INVOKE_AGENT_TIMEOUT_MS: 600_000,
  EPHEMERAL_AGENT_TTL_MS: 24 * 60 * 60 * 1000,
  EXEC_MAX_STDOUT_BYTES: 50 * 1024,
  EXEC_MAX_STDERR_BYTES: 10 * 1024,
  EXEC_MAX_TIMEOUT_SECONDS: 300,
  EXEC_DEFAULT_TIMEOUT_SECONDS: 30,
  FILE_MAX_WRITE_BYTES: 10 * 1024 * 1024,
  RECOVERY_SWEEP_INTERVAL_MS: 120_000,
  CLEANUP_INTERVAL_MS: 3_600_000,
} as const;

// ---------------------------------------------------------------------------
// Runtime config resolution: DB (per-tenant) → env → defaults
// ---------------------------------------------------------------------------

let cachedConfig: Record<string, unknown> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

export async function getAgentRuntimeConfig(tenantId?: string): Promise<typeof DEFAULTS> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return { ...DEFAULTS, ...cachedConfig } as typeof DEFAULTS;
  }

  let dbConfig: Record<string, unknown> = {};
  try {
    if (tenantId) {
      const db = getDb();
      const [row] = await db.select({ value: systemConfig.value }).from(systemConfig)
        .where(and(eq(systemConfig.tenantId, tenantId), eq(systemConfig.key, "agent_runtime"))).limit(1);
      if (row?.value && typeof row.value === "object") {
        dbConfig = row.value as Record<string, unknown>;
      }
    }
  } catch {
    // DB not available — use defaults
  }

  cachedConfig = dbConfig;
  cacheTimestamp = now;

  const resolved = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    const dbVal = dbConfig[key];
    const envVal = process.env[key];
    if (dbVal != null && typeof dbVal === "number") {
      (resolved as Record<string, number>)[key] = dbVal;
    } else if (envVal) {
      (resolved as Record<string, number>)[key] = Number(envVal);
    }
  }

  return resolved;
}

export function getConfigSync(): typeof DEFAULTS {
  if (cachedConfig) {
    const resolved = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const dbVal = (cachedConfig as Record<string, unknown>)[key];
      const envVal = process.env[key];
      if (dbVal != null && typeof dbVal === "number") {
        (resolved as Record<string, number>)[key] = dbVal;
      } else if (envVal) {
        (resolved as Record<string, number>)[key] = Number(envVal);
      }
    }
    return resolved;
  }

  const resolved = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
    const envVal = process.env[key];
    if (envVal) {
      (resolved as Record<string, number>)[key] = Number(envVal);
    }
  }
  return resolved;
}
