import { getDb } from "@ais-app/database";
import { workflowRuns, workflowRunSteps } from "@ais-app/database";
import { eq, and, lt, isNotNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Recovery Sweep
// ---------------------------------------------------------------------------

export async function recoverStaleWorkflowRuns(): Promise<number> {
  const db = getDb();
  const staleThreshold = new Date(Date.now() - 90_000);
  let recovered = 0;

  const staleSteps = await db.select({
    id: workflowRunSteps.id,
    runId: workflowRunSteps.workflowRunId,
    nodeId: workflowRunSteps.workflowNodeId,
    attempt: workflowRunSteps.attempt,
  }).from(workflowRunSteps)
    .where(and(
      eq(workflowRunSteps.status, "running"),
      sql`(${workflowRunSteps.lastHeartbeatAt} < ${staleThreshold} OR ${workflowRunSteps.lastHeartbeatAt} IS NULL)`,
    ));

  for (const step of staleSteps) {
    await db.update(workflowRunSteps).set({
      status: "failed",
      errorMessage: "Execution interrupted (server restart or timeout)",
      completedAt: new Date(),
    }).where(eq(workflowRunSteps.id, step.id));

    await db.update(workflowRuns).set({
      status: "failed",
      errorMessage: `Step interrupted: node execution did not complete`,
      completedAt: new Date(),
    }).where(and(eq(workflowRuns.id, step.runId), eq(workflowRuns.status, "running")));

    recovered++;
  }

  const timedOutRuns = await db.select({ id: workflowRuns.id }).from(workflowRuns)
    .where(and(
      eq(workflowRuns.status, "running"),
      isNotNull(workflowRuns.timeoutAt),
      lt(workflowRuns.timeoutAt, new Date()),
    ));

  for (const run of timedOutRuns) {
    await db.update(workflowRuns).set({
      status: "timeout", errorMessage: "Workflow execution timed out", completedAt: new Date(),
    }).where(eq(workflowRuns.id, run.id));
    recovered++;
  }

  return recovered;
}
