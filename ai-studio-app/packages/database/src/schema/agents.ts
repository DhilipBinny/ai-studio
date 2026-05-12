import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, numeric, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { tools } from "./tools";
import { providerModels } from "./providers";
import { agentStatusEnum } from "./enums";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").default(""),
    systemPrompt: text("system_prompt").notNull().default(""),
    rules: jsonb("rules").notNull().default([]),
    modelConfig: jsonb("model_config").notNull().default({}),
    providerModelId: uuid("provider_model_id").references(() => providerModels.id, { onDelete: "set null" }),
    confidenceThreshold: numeric("confidence_threshold", { precision: 3, scale: 2 }).default("0.85"),
    maxTurns: integer("max_turns").default(25),
    maxTokensPerTurn: integer("max_tokens_per_turn").default(4096),
    temperature: numeric("temperature", { precision: 3, scale: 2 }).default("0.7"),
    status: agentStatusEnum("status").notNull().default("draft"),
    tags: text("tags").array().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.slug),
    index("idx_agents_tenant").on(table.tenantId),
    index("idx_agents_status").on(table.tenantId, table.status),
    index("idx_agents_created_by").on(table.createdBy),
  ]
);

export const agentTools = pgTable(
  "agent_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
    toolConfig: jsonb("tool_config").notNull().default({}),
    isRequired: boolean("is_required").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.agentId, table.toolId),
    index("idx_agent_tools_agent").on(table.agentId),
    index("idx_agent_tools_tool").on(table.toolId),
  ]
);
