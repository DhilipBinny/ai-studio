import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, real, bigserial, bigint, numeric, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { workflowStatusEnum, workflowNodeTypeEnum, runStatusEnum, runStepStatusEnum } from "./enums";

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    triggerConfig: jsonb("trigger_config").notNull().default({}),
    status: workflowStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    tags: text("tags").array().default([]),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.name),
    index("idx_workflows_tenant").on(table.tenantId),
    index("idx_workflows_status").on(table.tenantId, table.status),
  ]
);

export const workflowNodes = pgTable(
  "workflow_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    nodeType: workflowNodeTypeEnum("node_type").notNull(),
    name: text("name").notNull().default(""),
    config: jsonb("config").notNull().default({}),
    positionX: real("position_x").notNull().default(0),
    positionY: real("position_y").notNull().default(0),
    errorPolicy: jsonb("error_policy").notNull().default({ onError: "stop", maxRetries: 0, retryDelayMs: 1000, retryBackoff: "fixed", timeoutMs: 0 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_wf_nodes_workflow").on(table.workflowId)]
);

export const workflowEdges = pgTable(
  "workflow_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id").notNull().references(() => workflowNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id").notNull().references(() => workflowNodes.id, { onDelete: "cascade" }),
    conditionLabel: text("condition_label"),
    conditionExpr: text("condition_expr"),
    edgeType: text("edge_type").notNull().default("normal"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_wf_edges_workflow").on(table.workflowId),
    index("idx_wf_edges_from").on(table.fromNodeId),
    index("idx_wf_edges_to").on(table.toNodeId),
  ]
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    triggerType: text("trigger_type").notNull().default("manual"),
    triggerData: jsonb("trigger_data").notNull().default({}),
    status: runStatusEnum("status").notNull().default("pending"),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    parentRunId: uuid("parent_run_id"),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_wf_runs_tenant").on(table.tenantId),
    index("idx_wf_runs_workflow").on(table.workflowId),
    index("idx_wf_runs_status").on(table.tenantId, table.status),
    index("idx_wf_runs_created").on(table.tenantId, table.createdAt),
  ]
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    workflowNodeId: uuid("workflow_node_id").notNull(),
    nodeName: text("node_name"),
    nodeType: text("node_type"),
    status: runStepStatusEnum("status").notNull().default("pending"),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    attempt: integer("attempt").notNull().default(1),
    retryOf: bigint("retry_of", { mode: "number" }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_wf_run_steps_run").on(table.workflowRunId),
    index("idx_wf_run_steps_status").on(table.workflowRunId, table.status),
  ]
);
