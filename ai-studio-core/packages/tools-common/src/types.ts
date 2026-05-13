export interface WorkspaceConfig {
  dataRoot: string;
  tenantId: string;
  agentId: string;
  sessionId: string;
}

export interface BuiltinToolContext {
  workspace: WorkspaceConfig;
  braveApiKey?: string;
}
