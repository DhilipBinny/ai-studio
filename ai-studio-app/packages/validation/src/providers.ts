import { z } from "zod";

export const createProviderSchema = z.object({
  name: z.string().min(1).max(255),
  providerType: z.enum(["anthropic", "openai", "ollama", "azure_openai", "google", "custom", "openai_compatible"]),
  baseUrl: z.string().url().optional().nullable(),
  apiKeyRef: z.string().optional().nullable(),
  config: z.record(z.unknown()).optional(),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  baseUrl: z.string().url().optional().nullable(),
  apiKeyRef: z.string().optional().nullable(),
  config: z.record(z.unknown()).optional(),
  status: z.enum(["active", "inactive", "error"]).optional(),
});

export const createModelSchema = z.object({
  modelId: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
  capabilities: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().optional().nullable(),
  maxOutputTokens: z.number().int().positive().optional().nullable(),
  costPerInputToken: z.string().optional(),
  costPerOutputToken: z.string().optional(),
});

export const updateModelSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  capabilities: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().optional().nullable(),
  maxOutputTokens: z.number().int().positive().optional().nullable(),
  costPerInputToken: z.string().optional(),
  costPerOutputToken: z.string().optional(),
  isActive: z.boolean().optional(),
});
