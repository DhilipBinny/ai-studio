import { z } from "zod";

export const createCronJobSchema = z.object({
  name: z.string().min(1).max(255),
  triggerType: z.enum(["agent", "workflow"]),
  agentId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  scheduleType: z.string().min(1).max(50),
  scheduleValue: z.string().min(1).max(255),
  timezone: z.string().max(100).optional(),
  prompt: z.string().min(1).max(50000),
});

export const updateCronJobSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  triggerType: z.enum(["agent", "workflow"]).optional(),
  agentId: z.string().uuid().optional().nullable(),
  workflowId: z.string().uuid().optional().nullable(),
  scheduleType: z.string().min(1).max(50).optional(),
  scheduleValue: z.string().min(1).max(255).optional(),
  timezone: z.string().max(100).optional().nullable(),
  prompt: z.string().min(1).max(50000).optional(),
  enabled: z.boolean().optional(),
});
