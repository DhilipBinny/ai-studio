import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentRuns, agents } from "@ais-app/database";
import { eq, count, sum, desc, sql } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (_request, auth) => {
  const db = getDb();

  const data = await db
    .select({
      agentId: agentRuns.agentId,
      agentName: agents.name,
      runCount: count(agentRuns.id).as("run_count"),
      totalCost: sum(agentRuns.totalCostUsd).as("total_cost"),
    })
    .from(agentRuns)
    .innerJoin(agents, eq(agentRuns.agentId, agents.id))
    .where(eq(agentRuns.tenantId, auth.tenantId))
    .groupBy(agentRuns.agentId, agents.name)
    .orderBy(desc(sql`count(${agentRuns.id})`))
    .limit(10);

  return NextResponse.json({ data });
});
