import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z][a-z0-9-]*$/, "Slug must be lowercase with hyphens"),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().optional(),
  rules: z.array(z.object({ rule: z.string(), priority: z.number().int().optional() })).optional(),
  providerModelId: z.string().uuid().optional().nullable(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().optional(),
  rules: z.array(z.object({ rule: z.string(), priority: z.number().int().optional() })).optional(),
  modelConfig: z.record(z.unknown()).optional(),
  providerModelId: z.string().uuid().optional().nullable(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  status: z.enum(["draft", "active", "disabled", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
});
