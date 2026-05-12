import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { usageRecords } from "@ais-app/database";
import { eq, and, gte, sql, sum } from "drizzle-orm";
import { withRBAC } from "@/lib/api-utils";

export const GET = withRBAC("DASHBOARD", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "30", 10);

  const since = new Date();
  since.setDate(since.getDate() - days);

  const data = await db
    .select({
      day: sql<string>`DATE_TRUNC('day', ${usageRecords.createdAt})::text`.as("day"),
      inputTokens: sum(usageRecords.inputTokens).as("input_tokens"),
      outputTokens: sum(usageRecords.outputTokens).as("output_tokens"),
      totalCost: sum(usageRecords.costUsd).as("total_cost"),
    })
    .from(usageRecords)
    .where(and(eq(usageRecords.tenantId, auth.tenantId), gte(usageRecords.createdAt, since)))
    .groupBy(sql`DATE_TRUNC('day', ${usageRecords.createdAt})`)
    .orderBy(sql`DATE_TRUNC('day', ${usageRecords.createdAt})`);

  return NextResponse.json({ data });
});
