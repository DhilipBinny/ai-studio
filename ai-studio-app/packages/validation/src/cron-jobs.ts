import { z } from "zod";

export const createCronJobSchema = z.object({
  name: z.string().min(1).max(255),
  triggerType: z.enum(["agent", "workflow"]),
  agentId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  scheduleType: z.enum(["cron", "every", "at"]),
  scheduleValue: z.string().min(1).max(255),
  timezone: z.string().max(100).optional(),
  prompt: z.string().min(1).max(50000),
  workflowInput: z.record(z.unknown()).optional(),
}).refine((data) => {
  if (data.scheduleType === "every") {
    const ms = Number(data.scheduleValue);
    return !isNaN(ms) && ms >= 60000;
  }
  if (data.scheduleType === "at") {
    const d = new Date(data.scheduleValue);
    return !isNaN(d.getTime());
  }
  return true;
}, { message: "Invalid schedule value for the selected schedule type" });

export const updateCronJobSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  triggerType: z.enum(["agent", "workflow"]).optional(),
  agentId: z.string().uuid().optional().nullable(),
  workflowId: z.string().uuid().optional().nullable(),
  scheduleType: z.enum(["cron", "every", "at"]).optional(),
  scheduleValue: z.string().min(1).max(255).optional(),
  timezone: z.string().max(100).optional().nullable(),
  prompt: z.string().min(1).max(50000).optional(),
  enabled: z.boolean().optional(),
  workflowInput: z.record(z.unknown()).optional(),
});
