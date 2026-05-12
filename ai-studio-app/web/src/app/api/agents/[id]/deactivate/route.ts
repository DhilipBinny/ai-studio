import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("AGENTS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Agent ID required", "MISSING_ID", 400);

  const db = getDb();
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, auth.tenantId)))
    .limit(1);

  if (!agent) return errorResponse("Agent not found", "NOT_FOUND", 404);

  await db
    .update(agents)
    .set({ isActive: false, deactivatedAt: new Date(), status: "archived" })
    .where(and(eq(agents.id, id), eq(agents.tenantId, auth.tenantId)));

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "agent.deactivate",
    resourceType: "agent",
    resourceId: id,
    details: { name: agent.name },
  });

  return NextResponse.json({ success: true });
});
