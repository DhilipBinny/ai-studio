import { getDb } from "@ais-app/database";
import { workflowRunSteps } from "@ais-app/database";
import { eq } from "drizzle-orm";
import { progressBus } from "../progress-bus";
import type { WorkflowState, GraphNode, NodeResult } from "./types";
import { executeNodeWithRetry } from "./retry";

// ---------------------------------------------------------------------------
// Step Recorder (shared by main loop, loop nodes, iteration nodes)
// ---------------------------------------------------------------------------

export type StepRecorder = (
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
) => Promise<NodeResult & { attempt: number }>;

export function createStepRecorder(): StepRecorder {
  return async (node, state, tenantId, runId, userId) => {
    const db = getDb();
    const stepStart = Date.now();

    const nodeSpan = progressBus.emit({
      traceId: runId, parentId: null, tenantId,
      spanKind: "node", phase: "start", name: node.name,
      message: `Node type: ${node.nodeType}`, nodeId: node.id,
    });

    const [step] = await db.insert(workflowRunSteps).values({
      tenantId, workflowRunId: runId, workflowNodeId: node.id,
      status: "running", input: state, startedAt: new Date(), lastHeartbeatAt: new Date(),
    }).returning({ id: workflowRunSteps.id });

    try {
      const { result, attempt } = await executeNodeWithRetry(node, state, tenantId, runId, userId, step.id, nodeSpan.id);

      await db.update(workflowRunSteps).set({
        status: result.paused ? "waiting_human" : "completed",
        output: result.output, durationMs: Date.now() - stepStart,
        completedAt: new Date(), attempt,
      }).where(eq(workflowRunSteps.id, step.id));

      progressBus.emit({
        traceId: runId, parentId: null, tenantId,
        spanKind: "node", phase: result.paused ? "progress" : "complete", name: node.name,
        message: result.paused ? "Waiting for human input" : `Completed (attempt ${attempt})`,
        durationMs: Date.now() - stepStart, nodeId: node.id,
      });

      return { ...result, attempt };
    } catch (error) {
      await db.update(workflowRunSteps).set({
        status: "failed", errorMessage: (error as Error).message,
        durationMs: Date.now() - stepStart, completedAt: new Date(),
      }).where(eq(workflowRunSteps.id, step.id));

      progressBus.emit({
        traceId: runId, parentId: null, tenantId,
        spanKind: "node", phase: "error", name: node.name,
        message: (error as Error).message.slice(0, 500),
        durationMs: Date.now() - stepStart, nodeId: node.id,
      });

      throw error;
    }
  };
}
