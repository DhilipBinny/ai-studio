import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions, agents, systemConfig } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("RUNS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const status = url.searchParams.get("status");
  const agentId = url.searchParams.get("agentId");

  const conditions = [eq(agentSessions.tenantId, auth.tenantId)];
  if (status) conditions.push(eq(agentSessions.status, status as typeof agentSessions.status.enumValues[number]));
  if (agentId) conditions.push(eq(agentSessions.agentId, agentId));

  const where = and(...conditions);

  const [data, [{ total }], billingRow] = await Promise.all([
    db.select({
      id: agentSessions.id, agentId: agentSessions.agentId, agentName: agents.name,
      status: agentSessions.status, triggerType: agentSessions.triggerType, channel: agentSessions.channel,
      totalInputTokens: agentSessions.totalInputTokens, totalOutputTokens: agentSessions.totalOutputTokens,
      totalCostUsd: agentSessions.totalCostUsd, totalTurns: agentSessions.totalTurns,
      totalToolCalls: agentSessions.totalToolCalls,
      modelUsed: agentSessions.modelUsed, startedAt: agentSessions.startedAt,
      completedAt: agentSessions.completedAt, createdAt: agentSessions.createdAt,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(where)
    .orderBy(desc(agentSessions.createdAt))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(agentSessions).where(where),
    db.select({ value: systemConfig.value }).from(systemConfig).where(and(eq(systemConfig.tenantId, auth.tenantId), eq(systemConfig.key, "billing"))).limit(1),
  ]);

  const billingSettings = (billingRow[0]?.value ?? {}) as Record<string, unknown>;
  const rawMargin = Number(billingSettings.cost_margin_factor);
  const marginFactor = isNaN(rawMargin) || rawMargin < 1 ? 1.0 : rawMargin;

  const rows = data.map((s) => ({
    ...s,
    totalCostUsd: (Number(s.totalCostUsd || 0) * marginFactor).toFixed(6),
  }));

  return NextResponse.json({ data: rows, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});
