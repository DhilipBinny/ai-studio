import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, unique, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { profiles } from "./profiles";
import { userRoleEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("member"),
    avatarUrl: text("avatar_url"),
    settings: jsonb("settings").notNull().default({}),
    isLocked: boolean("is_locked").notNull().default(false),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    requirePasswordChange: boolean("require_password_change").notNull().default(false),
    otpRequestCount: integer("otp_request_count").notNull().default(0),
    otpBlockedUntil: timestamp("otp_blocked_until", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.email),
    index("idx_users_tenant").on(table.tenantId),
    index("idx_users_email").on(table.email),
    index("idx_users_profile").on(table.profileId),
  ]
);
