import { getDb } from "@ais-app/database";
import { workflows, workflowNodes, workflowEdges, workflowRuns, workflowRunSteps } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { runSession } from "./session-runner";

interface WorkflowState {
  [nodeKey: string]: Record<string, unknown>;
}

interface NodeConfig {
  agentId?: string;
  message?: string;
  expression?: string;
  operator?: string;
  value?: string;
  mappings?: Array<{ key: string; value: string }>;
  prompt?: string;
  schema?: Record<string, unknown>;
}

interface GraphNode {
  id: string;
  nodeType: string;
  name: string;
  config: NodeConfig;
}

interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionLabel: string | null;
  conditionExpr: string | null;
  sortOrder: number;
}

function resolveTemplate(template: string, state: WorkflowState): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const parts = path.trim().split(".");
    let current: unknown = state;
    for (const part of parts) {
      if (current === null || current === undefined) return "";
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) return "";
    if (typeof current === "object") return JSON.stringify(current);
    return String(current);
  });
}

function evaluateCondition(expr: string, state: WorkflowState): boolean {
  const resolved = resolveTemplate(expr, state);

  const containsMatch = resolved.match(/^(.+?)\s+contains\s+"([^"]*)"$/i);
  if (containsMatch) return containsMatch[1].includes(containsMatch[2]);

  const equalsMatch = resolved.match(/^(.+?)\s+equals\s+"([^"]*)"$/i);
  if (equalsMatch) return equalsMatch[1].trim() === equalsMatch[2];

  const gtMatch = resolved.match(/^(.+?)\s+greater_than\s+(\d+(?:\.\d+)?)$/i);
  if (gtMatch) return Number(gtMatch[1]) > Number(gtMatch[2]);

  const ltMatch = resolved.match(/^(.+?)\s+less_than\s+(\d+(?:\.\d+)?)$/i);
  if (ltMatch) return Number(ltMatch[1]) < Number(ltMatch[2]);

  return resolved.toLowerCase() === "true" || resolved === "1";
}

function findStartNode(nodes: GraphNode[], edges: GraphEdge[]): GraphNode | null {
  const inputNode = nodes.find((n) => n.nodeType === "input");
  if (inputNode) return inputNode;

  const targetIds = new Set(edges.map((e) => e.toNodeId));
  const roots = nodes.filter((n) => !targetIds.has(n.id));
  return roots[0] || nodes[0] || null;
}

function getNextNodes(currentNodeId: string, edges: GraphEdge[], nodes: GraphNode[], state: WorkflowState): GraphNode[] {
  const outgoing = edges
    .filter((e) => e.fromNodeId === currentNodeId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (outgoing.length === 0) return [];

  const hasConditions = outgoing.some((e) => e.conditionExpr);
  if (hasConditions) {
    for (const edge of outgoing) {
      if (edge.conditionExpr && evaluateCondition(edge.conditionExpr, state)) {
        const target = nodes.find((n) => n.id === edge.toNodeId);
        return target ? [target] : [];
      }
    }
    const defaultEdge = outgoing.find((e) => !e.conditionExpr);
    if (defaultEdge) {
      const target = nodes.find((n) => n.id === defaultEdge.toNodeId);
      return target ? [target] : [];
    }
    return [];
  }

  return outgoing
    .map((e) => nodes.find((n) => n.id === e.toNodeId))
    .filter((n): n is GraphNode => n !== undefined);
}

async function executeNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
): Promise<{ output: Record<string, unknown>; paused: boolean }> {
  const config = node.config;

  switch (node.nodeType) {
    case "input": {
      return { output: state.input || {}, paused: false };
    }

    case "agent": {
      if (!config.agentId) throw new Error(`Agent node "${node.name}" has no agentId configured`);
      const message = config.message ? resolveTemplate(config.message, state) : "Process the input.";

      const result = await runSession({
        agentId: config.agentId,
        tenantId,
        userId: userId || "",
        message,
        channel: "workflow",
        metadata: { workflowRunId: runId, nodeName: node.name },
      });

      return {
        output: {
          response: result.response,
          sessionId: result.sessionId,
          status: result.status,
          usage: result.usage,
          error: result.error || null,
        },
        paused: false,
      };
    }

    case "condition": {
      return { output: { evaluated: true }, paused: false };
    }

    case "transform": {
      const mappings = config.mappings || [];
      const result: Record<string, unknown> = {};
      for (const m of mappings) {
        result[m.key] = resolveTemplate(m.value, state);
      }
      return { output: result, paused: false };
    }

    case "human_review": {
      return {
        output: {
          prompt: config.prompt ? resolveTemplate(config.prompt, state) : "Please review and approve.",
          status: "waiting",
        },
        paused: true,
      };
    }

    case "output": {
      const mappings = config.mappings || [];
      const result: Record<string, unknown> = {};
      for (const m of mappings) {
        result[m.key] = resolveTemplate(m.value, state);
      }
      if (mappings.length === 0) {
        Object.assign(result, state);
      }
      return { output: result, paused: false };
    }

    default:
      throw new Error(`Unknown node type: ${node.nodeType}`);
  }
}

export interface WorkflowRunResult {
  runId: string;
  status: string;
  output: Record<string, unknown> | null;
  stepsCompleted: number;
  error?: string;
}

export async function triggerWorkflow(
  workflowId: string,
  tenantId: string,
  userId: string | null,
  input: Record<string, unknown>,
): Promise<WorkflowRunResult> {
  const db = getDb();

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)))
    .limit(1);

  if (!workflow) throw new Error("Workflow not found");
  if (workflow.status !== "active") throw new Error("Workflow is not active");

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId))
    .orderBy(asc(workflowNodes.createdAt));

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, workflowId));

  if (nodes.length === 0) throw new Error("Workflow has no nodes");

  const [run] = await db
    .insert(workflowRuns)
    .values({
      tenantId,
      workflowId,
      triggerType: "manual",
      triggerData: {},
      status: "running",
      input,
      startedAt: new Date(),
      triggeredBy: userId,
    })
    .returning();

  const state: WorkflowState = { input };
  let stepsCompleted = 0;

  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id,
    nodeType: n.nodeType,
    name: n.name,
    config: (n.config || {}) as NodeConfig,
  }));

  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    conditionLabel: e.conditionLabel,
    conditionExpr: e.conditionExpr,
    sortOrder: e.sortOrder,
  }));

  try {
    let currentNode = findStartNode(graphNodes, graphEdges);
    if (!currentNode) throw new Error("No start node found");

    const visited = new Set<string>();
    const maxSteps = 50;

    while (currentNode && stepsCompleted < maxSteps) {
      if (visited.has(currentNode.id)) throw new Error(`Loop detected at node "${currentNode.name}"`);
      visited.add(currentNode.id);

      const stepStart = Date.now();

      await db.insert(workflowRunSteps).values({
        tenantId,
        workflowRunId: run.id,
        workflowNodeId: currentNode.id,
        status: "running",
        input: state,
        startedAt: new Date(),
      });

      const { output, paused } = await executeNode(currentNode, state, tenantId, run.id, userId);

      const nodeKey = currentNode.name.replace(/\s+/g, "_").toLowerCase();
      state[nodeKey] = output;
      stepsCompleted++;

      await db
        .update(workflowRunSteps)
        .set({
          status: paused ? "waiting_human" : "completed",
          output,
          durationMs: Date.now() - stepStart,
          completedAt: new Date(),
        })
        .where(and(
          eq(workflowRunSteps.workflowRunId, run.id),
          eq(workflowRunSteps.workflowNodeId, currentNode.id),
        ));

      await db
        .update(workflowRuns)
        .set({ output: state })
        .where(eq(workflowRuns.id, run.id));

      if (paused) {
        await db
          .update(workflowRuns)
          .set({ status: "waiting" })
          .where(eq(workflowRuns.id, run.id));

        return { runId: run.id, status: "waiting", output: state, stepsCompleted };
      }

      if (currentNode.nodeType === "output") break;

      const nextNodes = getNextNodes(currentNode.id, graphEdges, graphNodes, state);
      currentNode = nextNodes[0] || null;
    }

    await db
      .update(workflowRuns)
      .set({ status: "completed", output: state, completedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));

    return { runId: run.id, status: "completed", output: state, stepsCompleted };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await db
      .update(workflowRuns)
      .set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));

    return { runId: run.id, status: "failed", output: null, stepsCompleted, error: errorMsg };
  }
}

export async function resumeWorkflow(
  runId: string,
  tenantId: string,
  userId: string,
  decision: Record<string, unknown>,
): Promise<WorkflowRunResult> {
  const db = getDb();

  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId)))
    .limit(1);

  if (!run) throw new Error("Run not found");
  if (run.status !== "waiting") throw new Error("Run is not paused");

  const steps = await db
    .select()
    .from(workflowRunSteps)
    .where(eq(workflowRunSteps.workflowRunId, runId))
    .orderBy(asc(workflowRunSteps.createdAt));

  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.status !== "waiting_human") {
    throw new Error("No step waiting for human input");
  }

  await db
    .update(workflowRunSteps)
    .set({ status: "completed", output: decision, completedAt: new Date() })
    .where(eq(workflowRunSteps.id, lastStep.id));

  const state = (run.output || {}) as WorkflowState;
  const pausedNodeId = lastStep.workflowNodeId;

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, run.workflowId));

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, run.workflowId));

  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id, nodeType: n.nodeType, name: n.name, config: (n.config || {}) as NodeConfig,
  }));
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId,
    conditionLabel: e.conditionLabel, conditionExpr: e.conditionExpr, sortOrder: e.sortOrder,
  }));

  const pausedNode = graphNodes.find((n) => n.id === pausedNodeId);
  if (!pausedNode) throw new Error("Paused node not found");

  const nodeKey = pausedNode.name.replace(/\s+/g, "_").toLowerCase();
  state[nodeKey] = { ...((state[nodeKey] as Record<string, unknown>) || {}), decision };

  await db.update(workflowRuns).set({ status: "running", output: state }).where(eq(workflowRuns.id, runId));

  let stepsCompleted = steps.length;
  const visited = new Set<string>();
  const maxSteps = 50;

  try {
    let currentNode: GraphNode | null = getNextNodes(pausedNodeId, graphEdges, graphNodes, state)[0] || null;

    while (currentNode && stepsCompleted < maxSteps) {
      if (visited.has(currentNode.id)) throw new Error(`Loop detected at node "${currentNode.name}"`);
      visited.add(currentNode.id);

      const stepStart = Date.now();
      await db.insert(workflowRunSteps).values({
        tenantId, workflowRunId: runId, workflowNodeId: currentNode.id,
        status: "running", input: state, startedAt: new Date(),
      });

      const { output, paused } = await executeNode(currentNode, state, run.tenantId, runId, userId);
      const key = currentNode.name.replace(/\s+/g, "_").toLowerCase();
      state[key] = output;
      stepsCompleted++;

      await db.update(workflowRunSteps).set({
        status: paused ? "waiting_human" : "completed",
        output, durationMs: Date.now() - stepStart, completedAt: new Date(),
      }).where(and(eq(workflowRunSteps.workflowRunId, runId), eq(workflowRunSteps.workflowNodeId, currentNode.id)));

      await db.update(workflowRuns).set({ output: state }).where(eq(workflowRuns.id, runId));

      if (paused) {
        await db.update(workflowRuns).set({ status: "waiting" }).where(eq(workflowRuns.id, runId));
        return { runId, status: "waiting", output: state, stepsCompleted };
      }
      if (currentNode.nodeType === "output") break;

      const nextNodes = getNextNodes(currentNode.id, graphEdges, graphNodes, state);
      currentNode = nextNodes[0] || null;
    }

    await db.update(workflowRuns).set({ status: "completed", output: state, completedAt: new Date() }).where(eq(workflowRuns.id, runId));
    return { runId, status: "completed", output: state, stepsCompleted };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await db.update(workflowRuns).set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() }).where(eq(workflowRuns.id, runId));
    return { runId, status: "failed", output: null, stepsCompleted, error: errorMsg };
  }
}
