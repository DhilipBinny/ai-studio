import { pgTable, uuid, text, timestamp, integer, numeric, bigint, varchar, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const progressSpans = pgTable(
  "progress_spans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    traceId: uuid("trace_id").notNull(),
    parentId: uuid("parent_id"),
    seq: integer("seq").notNull(),
    spanKind: varchar("span_kind", { length: 20 }).notNull(),
    phase: varchar("phase", { length: 10 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    message: text("message"),
    timestampMs: bigint("timestamp_ms", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms"),
    tokens: integer("tokens"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    argsPreview: text("args_preview"),
    argsLen: integer("args_len"),
    resultPreview: text("result_preview"),
    resultLen: integer("result_len"),
    agentId: uuid("agent_id"),
    agentName: varchar("agent_name", { length: 255 }),
    sessionId: uuid("session_id"),
    nodeId: varchar("node_id", { length: 100 }),
    modelId: varchar("model_id", { length: 100 }),
    toolName: varchar("tool_name", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_progress_spans_trace").on(table.tenantId, table.traceId, table.seq),
    index("idx_progress_spans_created").on(table.createdAt),
    index("idx_progress_spans_session").on(table.sessionId),
  ]
);
