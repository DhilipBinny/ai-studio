import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { agentSessions, agents } from "@ais-app/database";
import { eq, count, sum, desc, sql } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (_request, auth) => {
  const db = getDb();

  const data = await db
    .select({
      agentId: agentSessions.agentId,
      agentName: agents.name,
      sessionCount: count(agentSessions.id).as("session_count"),
      totalCost: sum(agentSessions.totalCostUsd).as("total_cost"),
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(eq(agentSessions.tenantId, auth.tenantId))
    .groupBy(agentSessions.agentId, agents.name)
    .orderBy(desc(sql`count(${agentSessions.id})`))
    .limit(10);

  return NextResponse.json({ data });
});
