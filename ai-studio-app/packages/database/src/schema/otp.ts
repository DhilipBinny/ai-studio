import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

export const otp = pgTable(
  "otp",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    etus: text("etus").notNull().unique(),
    otpCode: text("otp_code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_otp_user").on(table.userId),
    index("idx_otp_etus").on(table.etus),
  ]
);
