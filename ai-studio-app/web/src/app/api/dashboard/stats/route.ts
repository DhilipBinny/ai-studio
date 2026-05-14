import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agents, tools, knowledgeBases, connectors, workflows, agentSessions, systemConfig } from "@ais-app/database";
import { eq, and, count, gte, sum, sql, desc } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (_request, auth) => {
  const db = getDb();
  const tid = auth.tenantId;

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
    [{ failedToday }],
    [totalsRow],
    [todayCostRow],
    topAgents,
    recentSessions,
    billingConfig,
  ] = await Promise.all([
    db.select({ agentCount: count() }).from(agents).where(and(eq(agents.tenantId, tid), eq(agents.isActive, true))),
    db.select({ toolCount: count() }).from(tools).where(and(eq(tools.tenantId, tid), eq(tools.isActive, true))),
    db.select({ kbCount: count() }).from(knowledgeBases).where(and(eq(knowledgeBases.tenantId, tid), eq(knowledgeBases.isActive, true))),
    db.select({ connectorCount: count() }).from(connectors).where(and(eq(connectors.tenantId, tid), eq(connectors.isActive, true))),
    db.select({ workflowCount: count() }).from(workflows).where(and(eq(workflows.tenantId, tid), eq(workflows.isActive, true))),
    db.select({ totalSessions: count() }).from(agentSessions).where(eq(agentSessions.tenantId, tid)),
    db.select({ sessionsToday: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), gte(agentSessions.createdAt, todayStart))),
    db.select({ failedToday: count() }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), eq(agentSessions.status, "failed"), gte(agentSessions.createdAt, todayStart))),
    db.select({
      totalCostUsd: sum(agentSessions.totalCostUsd),
    }).from(agentSessions).where(eq(agentSessions.tenantId, tid)),
    db.select({
      costToday: sum(agentSessions.totalCostUsd),
    }).from(agentSessions).where(and(eq(agentSessions.tenantId, tid), gte(agentSessions.createdAt, todayStart))),
    db.select({
      agentId: agentSessions.agentId,
      agentName: agents.name,
      sessions: count(),
      tokens: sum(sql`${agentSessions.totalInputTokens} + ${agentSessions.totalOutputTokens}`),
      toolCalls: sum(agentSessions.totalToolCalls),
      costUsd: sum(agentSessions.totalCostUsd),
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
      costUsd: agentSessions.totalCostUsd,
      createdAt: agentSessions.createdAt,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(eq(agentSessions.tenantId, tid))
    .orderBy(desc(agentSessions.createdAt))
    .limit(10),
    db.select({ value: systemConfig.value }).from(systemConfig).where(and(eq(systemConfig.tenantId, tid), eq(systemConfig.key, "billing"))).limit(1),
  ]);

  const billingSettings = (billingConfig[0]?.value ?? {}) as Record<string, unknown>;
  const rawMargin = Number(billingSettings.cost_margin_factor);
  const marginFactor = isNaN(rawMargin) || rawMargin < 1 ? 1.0 : rawMargin;

  const totalCostUsd = Number(totalsRow?.totalCostUsd || 0) * marginFactor;
  const costToday = Number(todayCostRow?.costToday || 0) * marginFactor;
  const avgCostPerSession = totalSessions > 0 ? totalCostUsd / totalSessions : 0;

  return NextResponse.json({
    agents: agentCount,
    tools: toolCount,
    knowledgeBases: kbCount,
    connectors: connectorCount,
    workflows: workflowCount,
    totalSessions,
    sessionsToday,
    failedToday,
    costToday,
    totalCostUsd,
    avgCostPerSession,
    topAgents: topAgents.map((a) => ({
      ...a,
      costUsd: Number(a.costUsd || 0) * marginFactor,
    })),
    recentSessions: recentSessions.map((s) => ({
      ...s,
      costUsd: Number(s.costUsd || 0) * marginFactor,
    })),
  });
});
