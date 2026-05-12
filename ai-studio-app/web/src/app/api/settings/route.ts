import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { systemConfig } from "@ais-app/database";
import { eq } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("SETTINGS", 10, async (_request, auth) => {
  const db = getDb();

  const data = await db
    .select({
      id: systemConfig.id,
      key: systemConfig.key,
      value: systemConfig.value,
      updatedAt: systemConfig.updatedAt,
    })
    .from(systemConfig)
    .where(eq(systemConfig.tenantId, auth.tenantId));

  return NextResponse.json({ data });
});

export const PATCH = withRBAC("SETTINGS", 20, async (request, auth) => {
  const body = await request.json();
  const entries = body.entries as Array<{ key: string; value: unknown }>;

  if (!Array.isArray(entries) || entries.length === 0) {
    return errorResponse("entries array required", "VALIDATION_ERROR", 400);
  }

  const db = getDb();

  for (const entry of entries) {
    await db
      .insert(systemConfig)
      .values({
        tenantId: auth.tenantId,
        key: entry.key,
        value: entry.value,
        updatedBy: auth.userId,
      })
      .onConflictDoUpdate({
        target: [systemConfig.tenantId, systemConfig.key],
        set: { value: entry.value, updatedBy: auth.userId },
      });
  }

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "settings.update",
    resourceType: "system_config",
    details: { keys: entries.map((e) => e.key) },
  });

  return NextResponse.json({ success: true });
});
