import { pgTable, uuid, text, boolean, timestamp, jsonb, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    accessRights: jsonb("access_rights").notNull().default({}),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.name),
    index("idx_profiles_tenant").on(table.tenantId),
  ]
);
