import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { cronJobs, agents, workflows } from "@ais-app/database";
import { paginationSchema } from "@ais-app/validation";
import { eq, and, count, desc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("SETTINGS", 10, async (request, auth) => {
  const db = getDb();
  const url = new URL(request.url);
  const pagination = paginationSchema.parse(Object.fromEntries(url.searchParams));
  const where = eq(cronJobs.tenantId, auth.tenantId);

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: cronJobs.id, name: cronJobs.name, triggerType: cronJobs.triggerType,
      scheduleType: cronJobs.scheduleType, scheduleValue: cronJobs.scheduleValue,
      timezone: cronJobs.timezone, prompt: cronJobs.prompt, enabled: cronJobs.enabled,
      agentId: cronJobs.agentId, workflowId: cronJobs.workflowId,
      lastRun: cronJobs.lastRun, lastResult: cronJobs.lastResult, lastError: cronJobs.lastError,
      runCount: cronJobs.runCount, createdAt: cronJobs.createdAt,
    }).from(cronJobs).where(where).orderBy(desc(cronJobs.createdAt)).limit(pagination.pageSize).offset((pagination.page - 1) * pagination.pageSize),
    db.select({ total: count() }).from(cronJobs).where(where),
  ]);

  return NextResponse.json({ data, total, page: pagination.page, pageSize: pagination.pageSize, totalPages: Math.ceil(total / pagination.pageSize) });
});

export const POST = withRBAC("SETTINGS", 20, async (request, auth) => {
  const body = await request.json();
  const { name, triggerType, agentId, workflowId, scheduleType, scheduleValue, timezone, prompt } = body;

  if (!name) return errorResponse("Name required", "VALIDATION_ERROR", 400);
  if (!scheduleValue) return errorResponse("Schedule value required", "VALIDATION_ERROR", 400);
  if (!prompt) return errorResponse("Prompt required", "VALIDATION_ERROR", 400);

  if (triggerType === "agent" && !agentId) return errorResponse("Agent required for agent trigger", "VALIDATION_ERROR", 400);
  if (triggerType === "workflow" && !workflowId) return errorResponse("Workflow required for workflow trigger", "VALIDATION_ERROR", 400);

  if (scheduleType === "cron") {
    const parts = scheduleValue.trim().split(/\s+/);
    if (parts.length !== 5) return errorResponse("Invalid cron expression: must have 5 fields (minute hour day month weekday)", "VALIDATION_ERROR", 400);
  }

  const db = getDb();

  const [job] = await db.insert(cronJobs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    name,
    triggerType: triggerType || "agent",
    agentId: agentId || null,
    workflowId: workflowId || null,
    scheduleType: scheduleType || "cron",
    scheduleValue,
    timezone: timezone || "UTC",
    prompt,
    enabled: true,
  }).returning();

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "cron.create", resourceType: "cron_job", resourceId: job.id,
    details: { name, scheduleValue, triggerType },
  });

  return NextResponse.json(job, { status: 201 });
});
