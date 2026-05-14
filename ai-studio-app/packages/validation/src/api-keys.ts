import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopedAgentIds: z.array(z.string().uuid()).optional(),
  rateLimitRpm: z.number().int().positive().optional(),
});
