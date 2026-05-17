import { pgTable, uuid, text, timestamp, index, unique, customType } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { agents } from "./agents";

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull().default("general"),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.agentId, table.key),
    index("idx_memories_agent").on(table.agentId),
    index("idx_memories_category").on(table.agentId, table.category),
  ]
);
