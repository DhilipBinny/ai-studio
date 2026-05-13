import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@ais-app/database";
import { workflowRuns, workflowRunSteps, workflowNodes } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { withRBAC, errorResponse } from "@/lib/api-utils";

export const GET = withRBAC("WORKFLOWS", 10, async (_request, auth, params) => {
  const id = params?.id;
  const rid = params?.rid;
  if (!id || !rid) return errorResponse("Workflow and Run IDs required", "MISSING_ID", 400);

  const db = getDb();

  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, rid), eq(workflowRuns.workflowId, id), eq(workflowRuns.tenantId, auth.tenantId)))
    .limit(1);

  if (!run) return errorResponse("Run not found", "NOT_FOUND", 404);

  const steps = await db
    .select({
      id: workflowRunSteps.id,
      nodeId: workflowRunSteps.workflowNodeId,
      nodeName: workflowNodes.name,
      nodeType: workflowNodes.nodeType,
      status: workflowRunSteps.status,
      input: workflowRunSteps.input,
      output: workflowRunSteps.output,
      errorMessage: workflowRunSteps.errorMessage,
      durationMs: workflowRunSteps.durationMs,
      attempt: workflowRunSteps.attempt,
      startedAt: workflowRunSteps.startedAt,
      completedAt: workflowRunSteps.completedAt,
    })
    .from(workflowRunSteps)
    .innerJoin(workflowNodes, eq(workflowRunSteps.workflowNodeId, workflowNodes.id))
    .where(eq(workflowRunSteps.workflowRunId, rid))
    .orderBy(asc(workflowRunSteps.createdAt));

  return NextResponse.json({ ...run, steps });
});
