import { pgTable, uuid, text, boolean, timestamp, jsonb, numeric, integer, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { providerTypeEnum, providerStatusEnum } from "./enums";

export const providers = pgTable(
  "providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerType: providerTypeEnum("provider_type").notNull(),
    baseUrl: text("base_url"),
    apiKeyRef: text("api_key_ref"),
    config: jsonb("config").notNull().default({}),
    status: providerStatusEnum("status").notNull().default("active"),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.name),
    index("idx_providers_tenant").on(table.tenantId),
    index("idx_providers_status").on(table.tenantId, table.status),
  ]
);

export const providerModels = pgTable(
  "provider_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").notNull().references(() => providers.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    capabilities: jsonb("capabilities").notNull().default([]),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    costPerInputToken: numeric("cost_per_input_token", { precision: 12, scale: 10 }).default("0"),
    costPerOutputToken: numeric("cost_per_output_token", { precision: 12, scale: 10 }).default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.providerId, table.modelId),
    index("idx_provider_models_tenant").on(table.tenantId),
    index("idx_provider_models_provider").on(table.providerId),
  ]
);
