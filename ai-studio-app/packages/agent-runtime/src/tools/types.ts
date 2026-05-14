export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolContext {
  agentId: string;
  tenantId: string;
  sessionId: string;
}

export type ToolExecutorFn = (args: Record<string, unknown>) => Promise<string>;
export type ContextAwareExecutorFn = (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

export interface LoadedTools {
  definitions: ToolDefinition[];
  mcpConnectorMap: Map<string, string>;
  workspaceConfig: import("@ais/tools-common").WorkspaceConfig | null;
}
