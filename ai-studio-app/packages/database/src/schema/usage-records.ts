import { pgTable, uuid, text, timestamp, integer, numeric, bigserial, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { agents } from "./agents";
import { agentRuns } from "./agent-runs";
import { providerModels } from "./providers";

export const usageRecords = pgTable(
  "usage_records",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    providerModelId: uuid("provider_model_id").references(() => providerModels.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    requestType: text("request_type").default("chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_usage_tenant").on(table.tenantId),
    index("idx_usage_tenant_date").on(table.tenantId, table.createdAt),
    index("idx_usage_agent").on(table.agentId),
    index("idx_usage_user").on(table.userId),
  ]
);
