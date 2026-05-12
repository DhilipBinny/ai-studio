import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentRuns, agents } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("RUNS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const status = url.searchParams.get("status");
  const agentId = url.searchParams.get("agentId");

  const conditions = [eq(agentRuns.tenantId, auth.tenantId)];
  if (status) conditions.push(eq(agentRuns.status, status as typeof agentRuns.status.enumValues[number]));
  if (agentId) conditions.push(eq(agentRuns.agentId, agentId));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: agentRuns.id, agentId: agentRuns.agentId, agentName: agents.name,
      status: agentRuns.status, triggerType: agentRuns.triggerType,
      totalInputTokens: agentRuns.totalInputTokens, totalOutputTokens: agentRuns.totalOutputTokens,
      totalCostUsd: agentRuns.totalCostUsd, totalTurns: agentRuns.totalTurns,
      modelUsed: agentRuns.modelUsed, startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt, createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(where)
    .orderBy(desc(agentRuns.createdAt))
    .limit(pagination.pageSize)
    .offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(agentRuns).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});
