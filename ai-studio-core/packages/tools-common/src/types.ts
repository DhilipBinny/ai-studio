export interface WorkspaceConfig {
  dataRoot: string;
  tenantId: string;
  agentId: string;
  sessionId: string;
  workflowRunId?: string;
  projectId?: string;
  projectPath?: string;
  execTimeoutMs?: number;
}

export interface BuiltinToolContext {
  workspace: WorkspaceConfig;
  braveApiKey?: string;
}
