import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentRuns } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("RUNS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Run ID required", "MISSING_ID", 400);

  const db = getDb();
  const [run] = await db.select({ id: agentRuns.id, status: agentRuns.status }).from(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.tenantId, auth.tenantId))).limit(1);
  if (!run) return errorResponse("Run not found", "NOT_FOUND", 404);
  if (run.status !== "running" && run.status !== "pending") return errorResponse("Run is not active", "INVALID_STATE", 400);

  await db.update(agentRuns).set({ status: "cancelled", completedAt: new Date() }).where(and(eq(agentRuns.id, id), eq(agentRuns.tenantId, auth.tenantId)));
  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "run.cancel", resourceType: "agent_run", resourceId: id });

  return NextResponse.json({ success: true });
});
