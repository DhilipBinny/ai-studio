import { getDb } from "@ais-app/database";
import { workflowRuns, workflowRunSteps, agentSessions } from "@ais-app/database";
import { eq, and, lt, isNotNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Recovery Sweep — cleans up orphaned workflow steps and agent sessions
// ---------------------------------------------------------------------------

export async function recoverStaleWorkflowRuns(): Promise<number> {
  const db = getDb();
  const staleThreshold = new Date(Date.now() - 90_000).toISOString();
  let recovered = 0;

  const staleSteps = await db.select({
    id: workflowRunSteps.id,
    runId: workflowRunSteps.workflowRunId,
    nodeId: workflowRunSteps.workflowNodeId,
    attempt: workflowRunSteps.attempt,
  }).from(workflowRunSteps)
    .where(and(
      eq(workflowRunSteps.status, "running"),
      sql`(${workflowRunSteps.lastHeartbeatAt} < ${staleThreshold}::timestamptz OR ${workflowRunSteps.lastHeartbeatAt} IS NULL)`,
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

  // Recover orphaned agent sessions using heartbeat (60s stale = definitely dead)
  const sessionStaleThreshold = new Date(Date.now() - 60_000).toISOString();
  const staleSessionRows = await db.execute(sql`
    SELECT id FROM agent_sessions
    WHERE status = 'running'
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at < ${sessionStaleThreshold}::timestamptz
  `);

  for (const row of staleSessionRows) {
    await db.update(agentSessions).set({
      status: "failed",
      errorMessage: "Session interrupted (server restart)",
      completedAt: new Date(),
    }).where(eq(agentSessions.id, (row as { id: string }).id));
    recovered++;
  }

  return recovered;
}
