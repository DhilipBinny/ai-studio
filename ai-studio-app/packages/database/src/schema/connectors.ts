import { pgTable, uuid, text, boolean, timestamp, jsonb, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { connectorTypeEnum, connectorStatusEnum } from "./enums";

export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    connectorType: connectorTypeEnum("connector_type").notNull(),
    connectionConfig: jsonb("connection_config").notNull().default({}),
    credentialsRef: text("credentials_ref"),
    healthCheckUrl: text("health_check_url"),
    status: connectorStatusEnum("status").notNull().default("inactive"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastError: text("last_error"),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.name),
    index("idx_connectors_tenant").on(table.tenantId),
    index("idx_connectors_type").on(table.tenantId, table.connectorType),
  ]
);
