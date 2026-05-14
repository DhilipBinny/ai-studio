import { getDb } from "@ais-app/database";
import { workflows, workflowNodes, workflowEdges, workflowRuns, workflowRunSteps } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { progressBus } from "../progress-bus";
import type { WorkflowState, GraphNode, GraphEdge, NodeConfig, NodeErrorPolicy, WorkflowRunResult } from "./types";
import { DEFAULT_ERROR_POLICY } from "./types";
import { buildExecutionGraph } from "./graph-builder";
import { normalizeKey } from "./expression-engine";
import { executeGraph } from "./graph-executor";

export type { WorkflowRunResult } from "./types";
export { recoverStaleWorkflowRuns } from "./recovery";

export async function triggerWorkflow(
  workflowId: string,
  tenantId: string,
  userId: string | null,
  input: Record<string, unknown>,
  parentRunId?: string,
): Promise<WorkflowRunResult> {
  const db = getDb();

  const [workflow] = await db.select().from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId))).limit(1);
  if (!workflow) throw new Error("Workflow not found");
  if (workflow.status !== "active") throw new Error("Workflow is not active");

  const nodes = await db.select().from(workflowNodes)
    .where(and(eq(workflowNodes.workflowId, workflowId), eq(workflowNodes.tenantId, tenantId)))
    .orderBy(asc(workflowNodes.createdAt));
  const edges = await db.select().from(workflowEdges)
    .where(and(eq(workflowEdges.workflowId, workflowId), eq(workflowEdges.tenantId, tenantId)));

  if (nodes.length === 0) throw new Error("Workflow has no nodes");

  const [run] = await db.insert(workflowRuns).values({
    tenantId, workflowId, triggerType: parentRunId ? "sub_workflow" : "manual",
    triggerData: {}, status: "running", input, startedAt: new Date(),
    triggeredBy: userId, parentRunId: parentRunId || null,
    timeoutAt: new Date(Date.now() + 3600_000),
  }).returning();

  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id, nodeType: n.nodeType, name: n.name,
    config: (n.config || {}) as NodeConfig,
    errorPolicy: { ...DEFAULT_ERROR_POLICY, ...((n.errorPolicy || {}) as Partial<NodeErrorPolicy>) },
  }));
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId,
    conditionLabel: e.conditionLabel, conditionExpr: e.conditionExpr,
    edgeType: e.edgeType || "normal", sortOrder: e.sortOrder,
  }));

  const graph = buildExecutionGraph(graphNodes, graphEdges);
  const state: WorkflowState = { input };

  const wfSpan = progressBus.emit({
    traceId: run.id, parentId: null, tenantId,
    spanKind: "workflow", phase: "start", name: workflow.name,
    message: `Workflow started — ${nodes.length} nodes`,
  });

  try {
    const { stepsCompleted, paused } = await executeGraph(graph, graphEdges, state, run.id, tenantId, userId);

    if (paused) {
      progressBus.emit({
        traceId: run.id, parentId: null, tenantId,
        spanKind: "workflow", phase: "progress", name: workflow.name,
        message: "Paused — waiting for human input",
      });
      return { runId: run.id, status: "waiting", output: state as Record<string, unknown>, stepsCompleted };
    }

    await db.update(workflowRuns).set({ status: "completed", output: state, completedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));

    progressBus.emit({
      traceId: run.id, parentId: null, tenantId,
      spanKind: "workflow", phase: "complete", name: workflow.name,
      message: `Completed — ${stepsCompleted} steps`,
      durationMs: Date.now() - wfSpan.timestamp,
    });

    return { runId: run.id, status: "completed", output: state as Record<string, unknown>, stepsCompleted };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await db.update(workflowRuns).set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));

    progressBus.emit({
      traceId: run.id, parentId: null, tenantId,
      spanKind: "workflow", phase: "error", name: workflow.name,
      message: errorMsg.slice(0, 500),
      durationMs: Date.now() - wfSpan.timestamp,
    });

    return { runId: run.id, status: "failed", output: null, stepsCompleted: 0, error: errorMsg };
  }
}

export async function resumeWorkflow(
  runId: string,
  tenantId: string,
  userId: string,
  decision: Record<string, unknown>,
): Promise<WorkflowRunResult> {
  const db = getDb();

  const [run] = await db.update(workflowRuns).set({ status: "running" })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId), eq(workflowRuns.status, "waiting")))
    .returning();
  if (!run) throw new Error("Run not found or not paused");

  const steps = await db.select().from(workflowRunSteps)
    .where(eq(workflowRunSteps.workflowRunId, runId)).orderBy(asc(workflowRunSteps.createdAt));
  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.status !== "waiting_human") throw new Error("No step waiting for human input");

  await db.update(workflowRunSteps).set({ status: "completed", output: decision, completedAt: new Date() })
    .where(eq(workflowRunSteps.id, lastStep.id));

  const state = (run.output || {}) as WorkflowState;
  const pausedNodeId = lastStep.workflowNodeId;

  const nodes = await db.select().from(workflowNodes)
    .where(and(eq(workflowNodes.workflowId, run.workflowId), eq(workflowNodes.tenantId, tenantId)));
  const edges = await db.select().from(workflowEdges)
    .where(and(eq(workflowEdges.workflowId, run.workflowId), eq(workflowEdges.tenantId, tenantId)));

  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id, nodeType: n.nodeType, name: n.name,
    config: (n.config || {}) as NodeConfig,
    errorPolicy: { ...DEFAULT_ERROR_POLICY, ...((n.errorPolicy || {}) as Partial<NodeErrorPolicy>) },
  }));
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId,
    conditionLabel: e.conditionLabel, conditionExpr: e.conditionExpr,
    edgeType: e.edgeType || "normal", sortOrder: e.sortOrder,
  }));

  const pausedNode = graphNodes.find((n) => n.id === pausedNodeId);
  if (!pausedNode) throw new Error("Paused node not found");

  const nodeKey = normalizeKey(pausedNode.name);
  state[nodeKey] = { ...((state[nodeKey] as Record<string, unknown>) || {}), decision };
  await db.update(workflowRuns).set({ output: state }).where(eq(workflowRuns.id, runId));

  const graph = buildExecutionGraph(graphNodes, graphEdges);

  const nextEdges = graphEdges.filter((e) => e.fromNodeId === pausedNodeId && e.edgeType !== "error");
  const nextNodeIds = nextEdges.map((e) => e.toNodeId);

  try {
    const result = await executeGraph(graph, graphEdges, state, runId, tenantId, userId, nextNodeIds);
    const stepsCompleted = steps.length + result.stepsCompleted;

    if (result.paused) {
      return { runId, status: "waiting", output: state as Record<string, unknown>, stepsCompleted };
    }

    await db.update(workflowRuns).set({ status: "completed", output: state, completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    return { runId, status: "completed", output: state as Record<string, unknown>, stepsCompleted };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await db.update(workflowRuns).set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    return { runId, status: "failed", output: null, stepsCompleted: 0, error: errorMsg };
  }
}
