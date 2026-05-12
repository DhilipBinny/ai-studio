import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { tools } from "@ais-app/database";
import { updateToolSchema } from "@ais-app/validation";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("TOOLS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Tool ID required", "MISSING_ID", 400);

  const db = getDb();
  const [tool] = await db.select().from(tools).where(and(eq(tools.id, id), eq(tools.tenantId, auth.tenantId))).limit(1);
  if (!tool) return errorResponse("Tool not found", "NOT_FOUND", 404);

  return NextResponse.json(tool);
});

export const PATCH = withRBAC("TOOLS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Tool ID required", "MISSING_ID", 400);

  const body = await request.json();
  const parsed = updateToolSchema.safeParse(body);
  if (!parsed.success) return errorResponse("Invalid input", "VALIDATION_ERROR", 400, { issues: parsed.error.issues });

  const db = getDb();

  const [existing] = await db.select({ id: tools.id, version: tools.version }).from(tools).where(and(eq(tools.id, id), eq(tools.tenantId, auth.tenantId))).limit(1);
  if (!existing) return errorResponse("Tool not found", "NOT_FOUND", 404);

  const [updated] = await db.update(tools).set({ ...parsed.data, version: existing.version + 1 }).where(and(eq(tools.id, id), eq(tools.tenantId, auth.tenantId))).returning();

  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "tool.update", resourceType: "tool", resourceId: id, details: { fields: Object.keys(parsed.data) } });

  return NextResponse.json(updated);
});
