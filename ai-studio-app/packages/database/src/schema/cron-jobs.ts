import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, bigint, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const cronJobs = pgTable(
  "cron_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull().default(""),
    scheduleType: text("schedule_type").notNull().default("cron"),
    scheduleValue: text("schedule_value").notNull(),
    timezone: text("timezone"),
    prompt: text("prompt").notNull(),
    delivery: jsonb("delivery").notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    lastRun: timestamp("last_run", { withTimezone: true }),
    lastResult: text("last_result"),
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_cron_jobs_tenant").on(table.tenantId),
    index("idx_cron_jobs_user").on(table.userId),
  ]
);

export const backgroundTasks = pgTable(
  "background_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    scopeKey: text("scope_key"),
    task: text("task").notNull(),
    status: text("status").notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
    resultText: text("result_text"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_bgt_tenant").on(table.tenantId),
    index("idx_bgt_scope").on(table.scopeKey),
    index("idx_bgt_status").on(table.status),
  ]
);
