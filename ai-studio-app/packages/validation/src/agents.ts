import { z } from "zod";

const personaSchema = z.object({
  identity: z.string().max(2000).optional(),
  instructions: z.string().max(5000).optional(),
  tone: z.string().max(2000).optional(),
  context: z.string().max(5000).optional(),
}).optional();

export const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z][a-z0-9-]*$/, "Slug must be lowercase with hyphens"),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(32000).optional(),
  persona: personaSchema,
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
  systemPrompt: z.string().max(32000).optional(),
  persona: personaSchema,
  rules: z.array(z.object({ rule: z.string(), priority: z.number().int().optional() })).optional(),
  modelConfig: z.record(z.unknown()).optional(),
  providerModelId: z.string().uuid().optional().nullable(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  maxTokensPerTurn: z.number().int().positive().optional(),
  status: z.enum(["draft", "active", "disabled", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
});

export const assignToolSchema = z.object({
  toolId: z.string().uuid(),
  toolConfig: z.record(z.unknown()).optional(),
  isRequired: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
});

export const assignConnectorSchema = z.object({
  connectorId: z.string().uuid(),
});

export const assignKnowledgeBaseSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  searchConfig: z.record(z.unknown()).optional(),
});

export const agentSessionSchema = z.object({
  message: z.string().min(1).max(50000),
  metadata: z.record(z.unknown()).optional(),
  channel: z.enum(["studio", "workflow", "cron"]).optional(),
  async: z.boolean().optional(),
});
