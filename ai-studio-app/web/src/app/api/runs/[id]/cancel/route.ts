import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const POST = withRBAC("RUNS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Session ID required", "MISSING_ID", 400);

  const db = getDb();
  const [session] = await db.select({ id: agentSessions.id, status: agentSessions.status }).from(agentSessions).where(and(eq(agentSessions.id, id), eq(agentSessions.tenantId, auth.tenantId))).limit(1);
  if (!session) return errorResponse("Session not found", "NOT_FOUND", 404);
  if (session.status !== "running" && session.status !== "pending") return errorResponse("Session is not active", "INVALID_STATE", 400);

  await db.update(agentSessions).set({ status: "cancelled", completedAt: new Date() }).where(and(eq(agentSessions.id, id), eq(agentSessions.tenantId, auth.tenantId)));
  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "session.cancel", resourceType: "agent_session", resourceId: id });

  return NextResponse.json({ success: true });
});
