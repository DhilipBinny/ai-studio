import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, bigserial, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { toolTypeEnum, toolPermissionLevelEnum } from "./enums";

export const tools = pgTable(
  "tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull().default(""),
    toolType: toolTypeEnum("tool_type").notNull().default("custom"),
    category: text("category").default("general"),
    parametersSchema: jsonb("parameters_schema").notNull().default({}),
    returnsSchema: jsonb("returns_schema").default({}),
    config: jsonb("config").notNull().default({}),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.name),
    index("idx_tools_tenant").on(table.tenantId),
    index("idx_tools_type").on(table.tenantId, table.toolType),
    index("idx_tools_category").on(table.tenantId, table.category),
  ]
);

export const toolPermissions = pgTable(
  "tool_permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    toolPattern: text("tool_pattern").notNull(),
    permission: toolPermissionLevelEnum("permission").notNull().default("allow"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_tool_perms_tenant").on(table.tenantId),
    index("idx_tool_perms_lookup").on(table.tenantId, table.role),
  ]
);
