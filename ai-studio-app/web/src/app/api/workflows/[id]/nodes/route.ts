import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { workflowNodes, workflows } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const PUT = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await request.json();
  const nodes = body.nodes as Array<{ id?: string; nodeType: string; name: string; config: Record<string, unknown>; positionX: number; positionY: number }>;

  if (!Array.isArray(nodes)) return errorResponse("nodes array required", "VALIDATION_ERROR", 400);

  const db = getDb();

  const [workflow] = await db.select({ id: workflows.id }).from(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, auth.tenantId))).limit(1);
  if (!workflow) return errorResponse("Workflow not found", "NOT_FOUND", 404);

  await db.delete(workflowNodes).where(and(eq(workflowNodes.workflowId, id), eq(workflowNodes.tenantId, auth.tenantId)));

  const inserted = [];
  for (const node of nodes) {
    const [n] = await db.insert(workflowNodes).values({
      tenantId: auth.tenantId,
      workflowId: id,
      nodeType: node.nodeType as typeof workflowNodes.nodeType.enumValues[number],
      name: node.name,
      config: node.config || {},
      positionX: node.positionX,
      positionY: node.positionY,
    }).returning();
    inserted.push(n);
  }

  return NextResponse.json({ data: inserted });
});
