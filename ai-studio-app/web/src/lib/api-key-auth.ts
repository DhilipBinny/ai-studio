import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@ais-app/database";
import { apiKeys } from "@ais-app/database";
import { eq, and } from "drizzle-orm";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const key = `ask_${raw}`;
  const prefix = key.slice(0, 12);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}

interface ApiKeyAuth {
  tenantId: string;
  keyId: string;
  keyName: string;
  scopedAgentIds: string[];
}

export async function authenticateApiKey(request: NextRequest): Promise<ApiKeyAuth | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ask_")) return null;

  const key = authHeader.slice(7);
  const keyHash = hashApiKey(key);

  const db = getDb();
  const [record] = await db
    .select({
      id: apiKeys.id,
      tenantId: apiKeys.tenantId,
      name: apiKeys.name,
      scopedAgentIds: apiKeys.scopedAgentIds,
      expiresAt: apiKeys.expiresAt,
      isActive: apiKeys.isActive,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!record) return null;
  if (!record.isActive) return null;
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, record.id));

  return {
    tenantId: record.tenantId,
    keyId: record.id,
    keyName: record.name,
    scopedAgentIds: (record.scopedAgentIds as string[]) || [],
  };
}

export function errorJson(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}
