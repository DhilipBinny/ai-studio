import { getDb } from "@ais-app/database";
import { workflowRunSteps } from "@ais-app/database";
import { eq } from "drizzle-orm";
import type { WorkflowState, GraphNode, NodeResult } from "./types";
import { executeNode } from "./node-handlers";

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export function startHeartbeat(stepId: number): ReturnType<typeof setInterval> {
  const db = getDb();
  return setInterval(async () => {
    try {
      await db.update(workflowRunSteps).set({ lastHeartbeatAt: new Date() }).where(eq(workflowRunSteps.id, stepId));
    } catch { /* heartbeat failure is non-fatal */ }
  }, 15_000);
}

// ---------------------------------------------------------------------------
// Retry Wrapper
// ---------------------------------------------------------------------------

export async function executeNodeWithRetry(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
  stepId: number,
  nodeSpanId?: string,
): Promise<{ result: NodeResult; attempt: number }> {
  const policy = node.errorPolicy;
  let attempt = 0;

  while (attempt <= policy.maxRetries) {
    attempt++;
    const heartbeat = startHeartbeat(stepId);
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const { getConfigSync } = await import("../config");
      const timeoutMs = policy.timeoutMs || getConfigSync().WORKFLOW_NODE_TIMEOUT_MS;
      const result = await Promise.race([
        executeNode(node, state, tenantId, runId, userId, nodeSpanId),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error(`Node "${node.name}" timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return { result, attempt };
    } catch (error) {

      if (attempt <= policy.maxRetries) {
        const delay = policy.retryBackoff === "exponential"
          ? policy.retryDelayMs * Math.pow(2, attempt - 1)
          : policy.retryDelayMs;

        const db = getDb();
        await db.update(workflowRunSteps).set({
          status: "retrying",
          errorMessage: `Attempt ${attempt} failed: ${(error as Error).message}. Retrying in ${delay}ms...`,
          attempt,
        }).where(eq(workflowRunSteps.id, stepId));

        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      switch (policy.onError) {
        case "continue":
          return {
            result: { output: { _error: true, message: (error as Error).message, attempt }, paused: false },
            attempt,
          };
        case "error_branch":
          return {
            result: {
              output: { _error: true, message: (error as Error).message, nodeId: node.id, attempt },
              paused: false,
              useErrorBranch: true,
            },
            attempt,
          };
        default:
          throw error;
      }
    } finally {
      clearInterval(heartbeat);
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  throw new Error("Unreachable");
}
