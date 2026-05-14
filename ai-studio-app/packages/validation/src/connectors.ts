import { z } from "zod";

export const createConnectorSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  connectorType: z.enum(["database", "rest_api", "mcp", "webhook", "graphql"]),
  connectionConfig: z.record(z.unknown()),
  healthCheckUrl: z.string().url().optional().nullable(),
});

export const updateConnectorSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  connectorType: z.enum(["database", "rest_api", "mcp", "webhook", "graphql"]).optional(),
  connectionConfig: z.record(z.unknown()).optional(),
  healthCheckUrl: z.string().url().optional().nullable(),
});
