import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents, tools, knowledgeBases, connectors, workflows, agentSessions } from "@ais-app/database";
import { eq, and, count, gte, sql } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (_request, auth) => {
  const db = getDb();
  const tenantFilter = eq(agents.tenantId, auth.tenantId);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    [{ agentCount }],
    [{ toolCount }],
    [{ kbCount }],
    [{ connectorCount }],
    [{ workflowCount }],
    [{ totalSessions }],
    [{ sessionsToday }],
    [{ completedSessions }],
  ] = await Promise.all([
    db.select({ agentCount: count() }).from(agents).where(and(eq(agents.tenantId, auth.tenantId), eq(agents.isActive, true))),
    db.select({ toolCount: count() }).from(tools).where(and(eq(tools.tenantId, auth.tenantId), eq(tools.isActive, true))),
    db.select({ kbCount: count() }).from(knowledgeBases).where(and(eq(knowledgeBases.tenantId, auth.tenantId), eq(knowledgeBases.isActive, true))),
    db.select({ connectorCount: count() }).from(connectors).where(and(eq(connectors.tenantId, auth.tenantId), eq(connectors.isActive, true))),
    db.select({ workflowCount: count() }).from(workflows).where(and(eq(workflows.tenantId, auth.tenantId), eq(workflows.isActive, true))),
    db.select({ totalSessions: count() }).from(agentSessions).where(eq(agentSessions.tenantId, auth.tenantId)),
    db.select({ sessionsToday: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, auth.tenantId), gte(agentSessions.createdAt, todayStart))),
    db.select({ completedSessions: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, auth.tenantId), eq(agentSessions.status, "completed"))),
  ]);

  const successRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

  return NextResponse.json({
    agents: agentCount,
    tools: toolCount,
    knowledgeBases: kbCount,
    connectors: connectorCount,
    workflows: workflowCount,
    totalSessions,
    sessionsToday,
    successRate,
  });
});
