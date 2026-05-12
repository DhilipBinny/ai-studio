import { pgTable, uuid, text, timestamp, jsonb, bigserial, inet, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    details: jsonb("details").notNull().default({}),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    prevHash: text("prev_hash").notNull().default(""),
    entryHash: text("entry_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_audit_tenant").on(table.tenantId),
    index("idx_audit_tenant_created").on(table.tenantId, table.createdAt),
    index("idx_audit_action").on(table.action),
    index("idx_audit_resource").on(table.resourceType, table.resourceId),
    index("idx_audit_user").on(table.userId),
  ]
);
