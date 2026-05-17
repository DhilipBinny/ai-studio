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

export interface RuntimeLimits {
  execMaxStdout: number;
  execMaxStderr: number;
  execMaxTimeoutSeconds: number;
  execDefaultTimeoutSeconds: number;
  fileMaxWriteBytes: number;
}

export interface BuiltinToolContext {
  workspace: WorkspaceConfig;
  braveApiKey?: string;
  limits?: RuntimeLimits;
}
