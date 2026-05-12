import { z } from "zod";

export const createToolSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[a-z][a-z0-9_]*$/, "Name must be lowercase with underscores"),
  displayName: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  toolType: z.enum(["builtin", "custom", "mcp", "api", "code"]).default("custom"),
  category: z.string().max(100).optional(),
  parametersSchema: z.record(z.unknown()).optional(),
  returnsSchema: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
});

export const updateToolSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  parametersSchema: z.record(z.unknown()).optional(),
  returnsSchema: z.record(z.unknown()).optional(),
  config: z.record(z.unknown()).optional(),
});
