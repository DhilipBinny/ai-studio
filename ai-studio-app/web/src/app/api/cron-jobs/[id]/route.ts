import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { cronJobs } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { updateCronJobSchema } from "@ais-app/validation";
import { withRBAC, errorResponse, parseJsonBody } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";
import { runJobNow } from "@ais-app/agent-runtime";

export const PATCH = withRBAC("SETTINGS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Job ID required", "MISSING_ID", 400);

  const body = await parseJsonBody(request);
  if (!body) return errorResponse("Invalid JSON body", "INVALID_JSON", 400);
  const parsed = updateCronJobSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Validation failed", "VALIDATION_ERROR", 400, { errors: parsed.error.flatten() });
  }
  const db = getDb();

  const [existing] = await db.select({ id: cronJobs.id }).from(cronJobs)
    .where(and(eq(cronJobs.id, id), eq(cronJobs.tenantId, auth.tenantId))).limit(1);
  if (!existing) return errorResponse("Job not found", "NOT_FOUND", 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.scheduleType !== undefined) updates.scheduleType = parsed.data.scheduleType;
  if (parsed.data.scheduleValue !== undefined) updates.scheduleValue = parsed.data.scheduleValue;
  if (parsed.data.timezone !== undefined) updates.timezone = parsed.data.timezone;
  if (parsed.data.prompt !== undefined) updates.prompt = parsed.data.prompt;
  if (parsed.data.workflowInput !== undefined) updates.workflowInput = parsed.data.workflowInput;
  if (parsed.data.triggerType !== undefined) {
    updates.triggerType = parsed.data.triggerType;
    if (parsed.data.triggerType === "agent") {
      updates.agentId = parsed.data.agentId || null;
      updates.workflowId = null;
    } else {
      updates.workflowId = parsed.data.workflowId || null;
      updates.agentId = null;
    }
  } else {
    if (parsed.data.agentId !== undefined) updates.agentId = parsed.data.agentId;
    if (parsed.data.workflowId !== undefined) updates.workflowId = parsed.data.workflowId;
  }

  const [updated] = await db.update(cronJobs).set(updates).where(eq(cronJobs.id, id)).returning();

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "cron.update", resourceType: "cron_job", resourceId: id,
    details: { fields: Object.keys(updates) },
  });

  return NextResponse.json(updated);
});

export const DELETE = withRBAC("SETTINGS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Job ID required", "MISSING_ID", 400);

  const db = getDb();
  await db.delete(cronJobs).where(and(eq(cronJobs.id, id), eq(cronJobs.tenantId, auth.tenantId)));

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "cron.delete", resourceType: "cron_job", resourceId: id, details: {},
  });

  return NextResponse.json({ success: true });
});

export const POST = withRBAC("SETTINGS", 20, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Job ID required", "MISSING_ID", 400);

  const result = await runJobNow(id, auth.tenantId);

  await createAuditEntry({
    tenantId: auth.tenantId, userId: auth.userId,
    action: "cron.run_now", resourceType: "cron_job", resourceId: id,
    details: { success: result.success },
  });

  return NextResponse.json(result);
});
