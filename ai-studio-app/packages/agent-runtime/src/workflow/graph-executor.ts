import { getDb } from "@ais-app/database";
import { workflowRuns, workflowRunSteps } from "@ais-app/database";
import { eq } from "drizzle-orm";
import type { WorkflowState, GraphNode, GraphEdge, ExecutionGraph } from "./types";
import { normalizeKey } from "./expression-engine";
import { getNextNodes, executeLoopNode, executeIterationNode, resolveAggregate } from "./node-handlers";
import { createStepRecorder } from "./step-recorder";

// ---------------------------------------------------------------------------
// Main Executor
// ---------------------------------------------------------------------------

const MAX_STEPS = 200;
const MAX_PARALLEL = 10;

export async function executeGraph(
  graph: ExecutionGraph,
  allEdges: GraphEdge[],
  state: WorkflowState,
  runId: string,
  tenantId: string,
  userId: string | null,
  resumeFromNodeIds?: string[],
  timeoutAt?: Date | null,
): Promise<{ stepsCompleted: number; paused: boolean }> {
  const db = getDb();
  const recordStep = createStepRecorder();
  const completed = new Set<string>();
  const processed = new Set<string>();
  const pendingInDegree = new Map(graph.inDegree);
  const nodeOutputs = new Map<string, Record<string, unknown>>();
  let stepsCompleted = 0;

  if (resumeFromNodeIds && resumeFromNodeIds.length > 0) {
    for (const [nodeId, node] of graph.nodes) {
      const key = normalizeKey(node.name);
      if (state[key] !== undefined && !resumeFromNodeIds.includes(nodeId)) {
        completed.add(nodeId);
        if (typeof state[key] === "object" && state[key] !== null) {
          nodeOutputs.set(nodeId, state[key] as Record<string, unknown>);
        }
      }
    }
  }

  let ready: GraphNode[] = [];
  if (resumeFromNodeIds && resumeFromNodeIds.length > 0) {
    ready = resumeFromNodeIds.map((id) => graph.nodes.get(id)).filter((n): n is GraphNode => !!n);
  } else {
    const startNode = graph.nodes.get(graph.startNodeId);
    if (startNode) ready.push(startNode);
  }

  while (ready.length > 0 && stepsCompleted < MAX_STEPS) {
    if (timeoutAt && Date.now() > timeoutAt.getTime()) {
      throw new Error("Workflow execution timed out (wall-clock limit exceeded)");
    }

    const sequential: GraphNode[] = [];
    const parallel: GraphNode[] = [];

    for (const node of ready) {
      if (node.nodeType === "aggregate") {
        const preds = graph.reverseAdj.get(node.id) || [];
        if (!preds.every((p) => completed.has(p))) {
          continue;
        }
      }

      const outEdges = graph.adjacency.get(node.id) || [];
      const peers = ready.filter((n) => n.id !== node.id);
      const isParallelPeer = peers.length > 0 && ready.length > 1 && node.nodeType !== "loop" && node.nodeType !== "iteration";

      if (isParallelPeer && node.nodeType !== "aggregate") {
        parallel.push(node);
      } else {
        sequential.push(node);
      }
    }

    const toExecute = parallel.length > 1
      ? parallel.slice(0, MAX_PARALLEL)
      : sequential.length > 0 ? [sequential[0]] : parallel.slice(0, 1);

    const remaining = ready.filter((n) => !toExecute.some((t) => t.id === n.id));

    if (toExecute.length > 1) {
      const results = await Promise.allSettled(
        toExecute.map(async (node) => {
          if (node.nodeType === "loop") {
            return { node, output: await executeLoopNode(node, { ...state }, tenantId, runId, userId, allEdges, graph.nodes, recordStep), paused: false, useErrorBranch: false };
          }
          if (node.nodeType === "iteration") {
            return { node, output: await executeIterationNode(node, { ...state }, tenantId, runId, userId, allEdges, graph.nodes, recordStep), paused: false, useErrorBranch: false };
          }
          const stepResult = await recordStep(node, state, tenantId, runId, userId);
          stepsCompleted++;
          return { node, output: stepResult.output, paused: stepResult.paused, useErrorBranch: stepResult.useErrorBranch || false };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          const { node, output, paused, useErrorBranch } = r.value;
          const key = normalizeKey(node.name);
          state[key] = output;
          nodeOutputs.set(node.id, output);
          completed.add(node.id);
          processed.add(node.id);

          if (paused) {
            await db.update(workflowRuns).set({ status: "waiting", output: state }).where(eq(workflowRuns.id, runId));
            return { stepsCompleted, paused: true };
          }
        } else {
          const failedNode = toExecute.find((_, i) => results[i] === r);
          if (failedNode) {
            completed.add(failedNode.id);
            processed.add(failedNode.id);
            state[normalizeKey(failedNode.name)] = { _error: true, message: (r.reason as Error).message };
            if (failedNode.errorPolicy.onError === "error_branch") {
              const errorNext = getNextNodes(failedNode, graph, state, true);
              remaining.push(...errorNext);
            }
          }
        }
      }
    } else if (toExecute.length === 1) {
      const node = toExecute[0];

      if (node.nodeType === "loop") {
        const output = await executeLoopNode(node, state, tenantId, runId, userId, allEdges, graph.nodes, recordStep);
        state[normalizeKey(node.name)] = output;
        nodeOutputs.set(node.id, output);
        completed.add(node.id);
        processed.add(node.id);
        stepsCompleted++;
      } else if (node.nodeType === "iteration") {
        const output = await executeIterationNode(node, state, tenantId, runId, userId, allEdges, graph.nodes, recordStep);
        state[normalizeKey(node.name)] = output;
        nodeOutputs.set(node.id, output);
        completed.add(node.id);
        processed.add(node.id);
        stepsCompleted++;
      } else if (node.nodeType === "aggregate") {
        const predIds = graph.reverseAdj.get(node.id) || [];
        const predOutputs = new Map<string, Record<string, unknown>>();
        for (const pid of predIds) {
          const pOutput = nodeOutputs.get(pid);
          if (pOutput) predOutputs.set(pid, pOutput);
        }
        const aggregated = resolveAggregate(node, predOutputs);
        state[normalizeKey(node.name)] = aggregated;
        nodeOutputs.set(node.id, aggregated);
        completed.add(node.id);
        processed.add(node.id);

        const [step] = await db.insert(workflowRunSteps).values({
          tenantId, workflowRunId: runId, workflowNodeId: node.id,
          status: "completed", input: state, output: aggregated,
          startedAt: new Date(), completedAt: new Date(), durationMs: 0, lastHeartbeatAt: new Date(),
        }).returning({ id: workflowRunSteps.id });
        stepsCompleted++;
      } else {
        const stepResult = await recordStep(node, state, tenantId, runId, userId);
        state[normalizeKey(node.name)] = stepResult.output;
        nodeOutputs.set(node.id, stepResult.output);
        completed.add(node.id);
        processed.add(node.id);
        stepsCompleted++;

        if (stepResult.paused) {
          await db.update(workflowRuns).set({ status: "waiting", output: state }).where(eq(workflowRuns.id, runId));
          return { stepsCompleted, paused: true };
        }

        if (stepResult.useErrorBranch) {
          const errorNext = getNextNodes(node, graph, state, true);
          remaining.push(...errorNext);
        }
      }
    }

    await db.update(workflowRuns).set({ output: state }).where(eq(workflowRuns.id, runId));

    if (toExecute.some((n) => n.nodeType === "output")) break;

    ready = [...remaining];
    for (const doneNode of toExecute) {
      if (!completed.has(doneNode.id)) continue;
      const useErrBranch = (state[normalizeKey(doneNode.name)] as Record<string, unknown>)?._error === true
        && doneNode.errorPolicy.onError === "error_branch";
      const nextNodes = getNextNodes(doneNode, graph, state, useErrBranch);
      for (const next of nextNodes) {
        if (processed.has(next.id) || completed.has(next.id) || ready.some((r) => r.id === next.id)) continue;

        const preds = graph.reverseAdj.get(next.id) || [];
        const normalPreds = preds.filter((pid) => {
          const edges = allEdges.filter((e) => e.fromNodeId === pid && e.toNodeId === next.id);
          return edges.some((e) => e.edgeType === "normal" || e.edgeType === "loop_done" || e.edgeType === "error");
        });

        if (next.nodeType === "aggregate") {
          if (normalPreds.every((p) => completed.has(p))) ready.push(next);
        } else {
          ready.push(next);
        }
      }
    }
  }

  const hasOutput = Array.from(completed).some((id) => graph.nodes.get(id)?.nodeType === "output");
  if (!hasOutput && graph.nodes.size > 0) {
    const unvisited = Array.from(graph.nodes.keys()).filter((id) => !completed.has(id));
    if (unvisited.length > 0) {
      const names = unvisited.map((id) => graph.nodes.get(id)?.name).filter(Boolean).join(", ");
      (state as Record<string, unknown>)._warnings = [
        ...((state._warnings as string[]) || []),
        `Nodes not reached: ${names}`,
      ];
    }
  }

  return { stepsCompleted, paused: false };
}
