import { z } from "zod";

const permissionLevel = z.union([z.literal(0), z.literal(10), z.literal(20)]);

const accessRightsSchema = z.object({
  DASHBOARD: permissionLevel,
  AGENTS: permissionLevel,
  TOOLS: permissionLevel,
  KNOWLEDGE: permissionLevel,
  WORKFLOWS: permissionLevel,
  CONNECTORS: permissionLevel,
  RUNS: permissionLevel,
  PROVIDERS: permissionLevel,
  USERS: permissionLevel,
  PROFILES: permissionLevel,
  AUDIT: permissionLevel,
  SETTINGS: permissionLevel,
});

export const createProfileSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(1000).optional(),
  accessRights: accessRightsSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  accessRights: accessRightsSchema.optional(),
});
