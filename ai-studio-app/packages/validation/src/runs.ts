import { z } from "zod";

export const approveToolCallSchema = z.object({
  toolCallId: z.string(),
  action: z.enum(["approve", "deny"]),
});
