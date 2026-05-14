import { pgTable, bigserial, varchar, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const revokedTokens = pgTable(
  "revoked_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jti: varchar("jti", { length: 64 }).notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 50 }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_revoked_tokens_jti").on(table.jti),
    index("idx_revoked_tokens_expires").on(table.expiresAt),
  ]
);
