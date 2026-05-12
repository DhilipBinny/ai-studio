import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { tools } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("TOOLS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Tool ID required", "MISSING_ID", 400);

  const db = getDb();
  const [tool] = await db.select({ id: tools.id, name: tools.name }).from(tools).where(and(eq(tools.id, id), eq(tools.tenantId, auth.tenantId))).limit(1);
  if (!tool) return errorResponse("Tool not found", "NOT_FOUND", 404);

  await db.update(tools).set({ isActive: false, deactivatedAt: new Date() }).where(and(eq(tools.id, id), eq(tools.tenantId, auth.tenantId)));
  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "tool.deactivate", resourceType: "tool", resourceId: id, details: { name: tool.name } });

  return NextResponse.json({ success: true });
});
