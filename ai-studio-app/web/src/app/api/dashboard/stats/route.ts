import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents, tools, knowledgeBases, connectors, workflows, agentSessions } from "@ais-app/database";
import { eq, and, count, gte, sum, sql, desc } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (_request, auth) => {
  const db = getDb();
  const tid = auth.tenantId;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    [{ agentCount }],
    [{ toolCount }],
    [{ kbCount }],
    [{ connectorCount }],
    [{ workflowCount }],
    [{ totalSessions }],
    [{ sessionsToday }],
    [{ sessionsThisWeek }],
    [{ completedSessions }],
    [{ failedSessions }],
    [tokenRow],
    topAgents,
    recentSessions,
  ] = await Promise.all([
    db.select({ agentCount: count() }).from(agents).where(and(eq(agents.tenantId, tid), eq(agents.isActive, true))),
    db.select({ toolCount: count() }).from(tools).where(and(eq(tools.tenantId, tid), eq(tools.isActive, true))),
    db.select({ kbCount: count() }).from(knowledgeBases).where(and(eq(knowledgeBases.tenantId, tid), eq(knowledgeBases.isActive, true))),
    db.select({ connectorCount: count() }).from(connectors).where(and(eq(connectors.tenantId, tid), eq(connectors.isActive, true))),
    db.select({ workflowCount: count() }).from(workflows).where(and(eq(workflows.tenantId, tid), eq(workflows.isActive, true))),
    db.select({ totalSessions: count() }).from(agentSessions).where(eq(agentSessions.tenantId, tid)),
    db.select({ sessionsToday: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), gte(agentSessions.createdAt, todayStart))),
    db.select({ sessionsThisWeek: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), gte(agentSessions.createdAt, weekStart))),
    db.select({ completedSessions: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), eq(agentSessions.status, "completed"))),
    db.select({ failedSessions: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), eq(agentSessions.status, "failed"))),
    db.select({
      totalInputTokens: sum(agentSessions.totalInputTokens),
      totalOutputTokens: sum(agentSessions.totalOutputTokens),
      totalToolCalls: sum(agentSessions.totalToolCalls),
    }).from(agentSessions).where(eq(agentSessions.tenantId, tid)),
    db.select({
      agentId: agentSessions.agentId,
      agentName: agents.name,
      sessions: count(),
      tokens: sum(sql`${agentSessions.totalInputTokens} + ${agentSessions.totalOutputTokens}`),
      toolCalls: sum(agentSessions.totalToolCalls),
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(eq(agentSessions.tenantId, tid))
    .groupBy(agentSessions.agentId, agents.name)
    .orderBy(desc(count()))
    .limit(5),
    db.select({
      id: agentSessions.id,
      agentName: agents.name,
      status: agentSessions.status,
      channel: agentSessions.channel,
      totalTurns: agentSessions.totalTurns,
      totalToolCalls: agentSessions.totalToolCalls,
      tokens: sql<number>`${agentSessions.totalInputTokens} + ${agentSessions.totalOutputTokens}`,
      createdAt: agentSessions.createdAt,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(eq(agentSessions.tenantId, tid))
    .orderBy(desc(agentSessions.createdAt))
    .limit(10),
  ]);

  const waitingSessions = totalSessions - completedSessions - failedSessions;
  const successRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
  const errorRate = totalSessions > 0 ? Math.round((failedSessions / totalSessions) * 100) : 0;

  return NextResponse.json({
    agents: agentCount,
    tools: toolCount,
    knowledgeBases: kbCount,
    connectors: connectorCount,
    workflows: workflowCount,
    totalSessions,
    sessionsToday,
    sessionsThisWeek,
    completedSessions,
    failedSessions,
    waitingSessions,
    successRate,
    errorRate,
    totalInputTokens: Number(tokenRow?.totalInputTokens || 0),
    totalOutputTokens: Number(tokenRow?.totalOutputTokens || 0),
    totalTokens: Number(tokenRow?.totalInputTokens || 0) + Number(tokenRow?.totalOutputTokens || 0),
    totalToolCalls: Number(tokenRow?.totalToolCalls || 0),
    topAgents,
    recentSessions,
  });
});
