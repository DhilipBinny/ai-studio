import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required").max(255),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(64, "Password must be at most 64 characters"),
  role: z.enum(["super_admin", "admin", "member", "viewer"]).default("member"),
  profileId: z.string().uuid().optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  role: z.enum(["super_admin", "admin", "member", "viewer"]).optional(),
  profileId: z.string().uuid().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});
