import { pgTable, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { agents } from "./agents";
import { connectors } from "./connectors";

export const agentConnectors = pgTable(
  "agent_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => connectors.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.agentId, table.connectorId),
    index("idx_agent_connectors_agent").on(table.agentId),
    index("idx_agent_connectors_connector").on(table.connectorId),
  ]
);
