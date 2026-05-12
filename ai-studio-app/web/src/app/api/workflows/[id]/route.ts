import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { workflows, workflowNodes, workflowEdges } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const GET = withRBAC("WORKFLOWS", 10, async (_request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const db = getDb();
  const [workflow] = await db.select().from(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, auth.tenantId))).limit(1);
  if (!workflow) return errorResponse("Workflow not found", "NOT_FOUND", 404);

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));

  return NextResponse.json({ ...workflow, nodes, edges });
});

export const PATCH = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await request.json();
  const db = getDb();

  const [existing] = await db.select({ id: workflows.id, version: workflows.version }).from(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, auth.tenantId))).limit(1);
  if (!existing) return errorResponse("Workflow not found", "NOT_FOUND", 404);

  const updateData: Record<string, unknown> = { version: existing.version + 1 };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.triggerConfig !== undefined) updateData.triggerConfig = body.triggerConfig;
  if (body.status !== undefined) updateData.status = body.status;

  const [updated] = await db.update(workflows).set(updateData).where(and(eq(workflows.id, id), eq(workflows.tenantId, auth.tenantId))).returning();
  await createAuditEntry({ tenantId: auth.tenantId, userId: auth.userId, action: "workflow.update", resourceType: "workflow", resourceId: id, details: { fields: Object.keys(updateData) } });

  return NextResponse.json(updated);
});
