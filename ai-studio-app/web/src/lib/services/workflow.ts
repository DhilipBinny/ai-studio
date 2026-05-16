import { getDb } from "@ais-app/database";
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  workflowRunSteps,
} from "@ais-app/database";
import { eq, and, count, desc, asc, sql } from "drizzle-orm";
import { createAuditEntry } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaginationOpts {
  page: number;
  pageSize: number;
}

interface CreateWorkflowData {
  name: string;
  description?: string;
  triggerConfig?: Record<string, unknown>;
}

interface UpdateWorkflowData {
  name?: string;
  description?: string;
  triggerConfig?: Record<string, unknown>;
  status?: string;
}

interface NodeInput {
  id?: string;
  nodeType: string;
  name: string;
  config: Record<string, unknown>;
  errorPolicy?: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

interface EdgeInput {
  fromNodeId: string;
  toNodeId: string;
  conditionLabel?: string;
  conditionExpr?: string;
  edgeType?: string;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// getWorkflows — paginated list
// ---------------------------------------------------------------------------

export async function getWorkflows(tenantId: string, opts: PaginationOpts) {
  const db = getDb();
  const where = and(
    eq(workflows.tenantId, tenantId),
    eq(workflows.isActive, true),
  );

  const [data, [{ total }]] = await Promise.all([
    db
      .select()
      .from(workflows)
      .where(where)
      .orderBy(desc(workflows.createdAt))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ total: count() }).from(workflows).where(where),
  ]);

  return {
    data,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    totalPages: Math.ceil(total / opts.pageSize),
  };
}

// ---------------------------------------------------------------------------
// getWorkflowDetail — with nodes/edges
// ---------------------------------------------------------------------------

export async function getWorkflowDetail(
  tenantId: string,
  workflowId: string,
) {
  const db = getDb();

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(
      and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)),
    )
    .limit(1);

  if (!workflow) return null;

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, workflowId),
        eq(workflowNodes.tenantId, tenantId),
      ),
    );

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, workflowId),
        eq(workflowEdges.tenantId, tenantId),
      ),
    );

  return { ...workflow, nodes, edges };
}

// ---------------------------------------------------------------------------
// createWorkflow — create
// ---------------------------------------------------------------------------

export async function createWorkflow(
  tenantId: string,
  data: CreateWorkflowData,
  userId: string,
) {
  const db = getDb();

  let workflow;
  try {
    [workflow] = await db
      .insert(workflows)
      .values({
        tenantId,
        name: data.name,
        description: data.description || "",
        triggerConfig: data.triggerConfig || { type: "manual" },
        createdBy: userId,
      })
      .returning();
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      throw new WorkflowNameExistsError();
    }
    throw err;
  }

  await createAuditEntry({
    tenantId,
    userId,
    action: "workflow.create",
    resourceType: "workflow",
    resourceId: workflow.id,
    details: { name: data.name },
  });

  return workflow;
}

// ---------------------------------------------------------------------------
// updateWorkflow — update with version increment
// ---------------------------------------------------------------------------

export async function updateWorkflow(
  tenantId: string,
  workflowId: string,
  data: UpdateWorkflowData,
  userId: string,
) {
  const db = getDb();

  const updateData: Record<string, unknown> = {
    version: sql`${workflows.version} + 1`,
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.triggerConfig !== undefined)
    updateData.triggerConfig = data.triggerConfig;
  if (data.status !== undefined) updateData.status = data.status;

  const [updated] = await db
    .update(workflows)
    .set(updateData)
    .where(
      and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)),
    )
    .returning();

  if (!updated) throw new WorkflowNotFoundError();

  await createAuditEntry({
    tenantId,
    userId,
    action: "workflow.update",
    resourceType: "workflow",
    resourceId: workflowId,
    details: { fields: Object.keys(updateData) },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// updateWorkflowNodes — save nodes (delete-and-replace)
// ---------------------------------------------------------------------------

export async function updateWorkflowNodes(
  tenantId: string,
  workflowId: string,
  nodes: NodeInput[],
  userId: string,
) {
  const db = getDb();

  // Validate workflow exists
  const [workflow] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId)),
    )
    .limit(1);

  if (!workflow) throw new WorkflowNotFoundError();

  // Validate unique node names
  const nodeNames = nodes.map((n) =>
    n.name?.replace(/\s+/g, "_").toLowerCase(),
  );
  const uniqueNames = new Set(nodeNames);
  if (uniqueNames.size !== nodeNames.length) {
    throw new DuplicateNodeNameError(
      "Node names must be unique (names are compared case-insensitively with spaces as underscores)",
    );
  }

  // Delete existing nodes and re-insert within a transaction
  const inserted = await db.transaction(async (tx) => {
    await tx
      .delete(workflowNodes)
      .where(
        and(
          eq(workflowNodes.workflowId, workflowId),
          eq(workflowNodes.tenantId, tenantId),
        ),
      );

    const results = await tx
      .insert(workflowNodes)
      .values(
        nodes.map((node) => ({
          tenantId,
          workflowId,
          nodeType:
            node.nodeType as (typeof workflowNodes.nodeType.enumValues)[number],
          name: node.name,
          config: node.config || {},
          errorPolicy: node.errorPolicy || {
            onError: "stop",
            maxRetries: 0,
            retryDelayMs: 1000,
            retryBackoff: "fixed",
            timeoutMs: 0,
          },
          positionX: node.positionX,
          positionY: node.positionY,
        })),
      )
      .returning();
    return results;
  });

  await createAuditEntry({
    tenantId,
    userId,
    action: "workflow.update_nodes",
    resourceType: "workflow",
    resourceId: workflowId,
    details: { nodeCount: inserted.length },
  });

  return { data: inserted };
}

// ---------------------------------------------------------------------------
// updateWorkflowEdges — save edges (delete-and-replace)
// ---------------------------------------------------------------------------

export async function updateWorkflowEdges(
  tenantId: string,
  workflowId: string,
  edges: EdgeInput[],
  userId: string,
) {
  const db = getDb();

  const inserted = await db.transaction(async (tx) => {
    await tx
      .delete(workflowEdges)
      .where(
        and(
          eq(workflowEdges.workflowId, workflowId),
          eq(workflowEdges.tenantId, tenantId),
        ),
      );

    return edges.length > 0
      ? await tx
          .insert(workflowEdges)
          .values(
            edges.map((e, i) => ({
              tenantId,
              workflowId,
              fromNodeId: e.fromNodeId,
              toNodeId: e.toNodeId,
              conditionLabel: e.conditionLabel || null,
              conditionExpr: e.conditionExpr || null,
              edgeType: e.edgeType || "normal",
              sortOrder: e.sortOrder ?? i,
            })),
          )
          .returning()
      : [];
  });

  await createAuditEntry({
    tenantId,
    userId,
    action: "workflow.update_edges",
    resourceType: "workflow",
    resourceId: workflowId,
    details: { edgeCount: inserted.length },
  });

  return { edges: inserted };
}

// ---------------------------------------------------------------------------
// getWorkflowRuns — run history
// ---------------------------------------------------------------------------

export async function getWorkflowRuns(
  tenantId: string,
  workflowId: string,
  opts: PaginationOpts,
) {
  const db = getDb();
  const where = and(
    eq(workflowRuns.workflowId, workflowId),
    eq(workflowRuns.tenantId, tenantId),
  );

  const [data, [{ total }]] = await Promise.all([
    db
      .select()
      .from(workflowRuns)
      .where(where)
      .orderBy(desc(workflowRuns.createdAt))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ total: count() }).from(workflowRuns).where(where),
  ]);

  return {
    data,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    totalPages: Math.ceil(total / opts.pageSize),
  };
}

// ---------------------------------------------------------------------------
// getWorkflowRunDetail — run with steps
// ---------------------------------------------------------------------------

export async function getWorkflowRunDetail(
  tenantId: string,
  workflowId: string,
  runId: string,
) {
  const db = getDb();

  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.id, runId),
        eq(workflowRuns.workflowId, workflowId),
        eq(workflowRuns.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!run) return null;

  const steps = await db
    .select({
      id: workflowRunSteps.id,
      nodeId: workflowRunSteps.workflowNodeId,
      nodeName: sql<string>`COALESCE(${workflowNodes.name}, ${workflowRunSteps.nodeName}, 'Unknown')`.as("node_name"),
      nodeType: sql<string>`COALESCE(${workflowNodes.nodeType}::text, ${workflowRunSteps.nodeType}, 'unknown')`.as("node_type"),
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
    .leftJoin(
      workflowNodes,
      eq(workflowRunSteps.workflowNodeId, workflowNodes.id),
    )
    .where(eq(workflowRunSteps.workflowRunId, runId))
    .orderBy(asc(workflowRunSteps.createdAt));

  return { ...run, steps };
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

export class WorkflowNotFoundError extends Error {
  constructor() {
    super("Workflow not found");
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowNameExistsError extends Error {
  constructor() {
    super("Name already exists");
    this.name = "WorkflowNameExistsError";
  }
}

export class DuplicateNodeNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateNodeNameError";
  }
}
