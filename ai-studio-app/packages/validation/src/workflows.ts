import { z } from "zod";

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["draft", "active", "disabled", "archived"]).optional(),
});

export const updateNodesSchema = z.array(
  z.object({
    nodeType: z.enum([
      "agent",
      "tool",
      "llm",
      "condition",
      "loop",
      "human_review",
      "output",
      "input",
      "transform",
      "delay",
      "switch",
      "iteration",
      "sub_workflow",
      "knowledge_search",
      "http_request",
      "code",
      "aggregate",
    ]),
    name: z.string().min(1).max(255),
    config: z.record(z.unknown()),
    errorPolicy: z.record(z.unknown()).optional(),
    positionX: z.number(),
    positionY: z.number(),
  })
);

export const updateEdgesSchema = z.array(
  z.object({
    fromNodeId: z.string().uuid(),
    toNodeId: z.string().uuid(),
    conditionLabel: z.string().max(255).optional(),
    conditionExpr: z.string().max(5000).optional(),
    edgeType: z.string().max(50).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
);

export const triggerWorkflowSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

export const resumeWorkflowSchema = z.object({
  decision: z.record(z.unknown()),
});
