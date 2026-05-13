import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { workflowEdges } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";
import { createAuditEntry } from "@/lib/services/audit";

export const PUT = withRBAC("WORKFLOWS", 20, async (request, auth, params) => {
  const id = params?.id;
  if (!id) return errorResponse("Workflow ID required", "MISSING_ID", 400);

  const body = await request.json();
  const edges = body.edges as Array<{
    fromNodeId: string;
    toNodeId: string;
    conditionLabel?: string;
    conditionExpr?: string;
    sortOrder?: number;
  }>;

  if (!Array.isArray(edges)) return errorResponse("edges must be an array", "VALIDATION_ERROR", 400);

  const db = getDb();

  await db.delete(workflowEdges).where(and(eq(workflowEdges.workflowId, id), eq(workflowEdges.tenantId, auth.tenantId)));

  const inserted = edges.length > 0
    ? await db.insert(workflowEdges).values(
        edges.map((e, i) => ({
          tenantId: auth.tenantId,
          workflowId: id,
          fromNodeId: e.fromNodeId,
          toNodeId: e.toNodeId,
          conditionLabel: e.conditionLabel || null,
          conditionExpr: e.conditionExpr || null,
          sortOrder: e.sortOrder ?? i,
        }))
      ).returning()
    : [];

  await createAuditEntry({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "workflow.update_edges",
    resourceType: "workflow",
    resourceId: id,
    details: { edgeCount: inserted.length },
  });

  return NextResponse.json({ edges: inserted });
});
