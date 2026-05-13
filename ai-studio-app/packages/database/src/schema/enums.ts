import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "admin",
  "member",
  "viewer",
]);

export const agentStatusEnum = pgEnum("agent_status", [
  "draft",
  "active",
  "disabled",
  "archived",
]);

export const toolTypeEnum = pgEnum("tool_type", [
  "builtin",
  "custom",
  "mcp",
  "api",
  "code",
]);

export const toolPermissionLevelEnum = pgEnum("tool_permission_level", [
  "allow",
  "deny",
  "confirm",
  "power_user",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "uploaded",
  "processing",
  "ready",
  "error",
]);

export const connectorTypeEnum = pgEnum("connector_type", [
  "database",
  "rest_api",
  "mcp",
  "webhook",
  "graphql",
]);

export const connectorStatusEnum = pgEnum("connector_status", [
  "active",
  "inactive",
  "error",
  "testing",
]);

export const workflowStatusEnum = pgEnum("workflow_status", [
  "draft",
  "active",
  "disabled",
  "archived",
]);

export const workflowNodeTypeEnum = pgEnum("workflow_node_type", [
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
]);

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "waiting",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "timeout",
]);

export const runStepStatusEnum = pgEnum("run_step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "waiting_human",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "pending",
  "success",
  "error",
  "denied",
  "timeout",
]);

export const providerTypeEnum = pgEnum("provider_type", [
  "anthropic",
  "openai",
  "ollama",
  "azure_openai",
  "google",
  "custom",
  "openai_compatible",
]);

export const providerStatusEnum = pgEnum("provider_status", [
  "active",
  "inactive",
  "error",
]);
