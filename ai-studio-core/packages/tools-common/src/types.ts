export interface WorkspaceConfig {
  dataRoot: string;
  tenantId: string;
  agentId: string;
  sessionId: string;
  workflowRunId?: string;
}

export interface BuiltinToolContext {
  workspace: WorkspaceConfig;
  braveApiKey?: string;
}
