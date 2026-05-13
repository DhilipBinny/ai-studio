import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, numeric, bigserial, index } from "drizzle-orm/pg-core";

import { tenants } from "./tenants";
import { users } from "./users";
import { agents } from "./agents";
import { tools } from "./tools";
import { workflowRuns } from "./workflows";
import { runStatusEnum, messageRoleEnum, toolCallStatusEnum } from "./enums";

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("studio"),
    triggerType: text("trigger_type").notNull().default("manual"),
    triggerData: jsonb("trigger_data").notNull().default({}),
    status: runStatusEnum("status").notNull().default("pending"),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output"),
    errorMessage: text("error_message"),
    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    totalToolCalls: integer("total_tool_calls").notNull().default(0),
    totalTurns: integer("total_turns").notNull().default(0),
    modelUsed: text("model_used"),
    providerUsed: text("provider_used"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_agent_sessions_tenant").on(table.tenantId),
    index("idx_agent_sessions_agent").on(table.agentId),
    index("idx_agent_sessions_status").on(table.tenantId, table.status),
    index("idx_agent_sessions_created").on(table.tenantId, table.createdAt),
  ]
);

export const agentSessionMessages = pgTable(
  "agent_session_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentSessionId: uuid("agent_session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls"),
    toolCallId: text("tool_call_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_asm_session").on(table.agentSessionId),
    index("idx_asm_tenant").on(table.tenantId),
  ]
);

export const agentSessionToolCalls = pgTable(
  "agent_session_tool_calls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentSessionId: uuid("agent_session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments").notNull().default({}),
    result: text("result"),
    status: toolCallStatusEnum("status").notNull().default("pending"),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvalStatus: text("approval_status"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_astc_session").on(table.agentSessionId),
    index("idx_astc_tenant").on(table.tenantId),
    index("idx_astc_tool").on(table.toolName),
  ]
);
