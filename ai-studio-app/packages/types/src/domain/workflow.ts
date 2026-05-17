export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: string;
  version: number;
  createdAt: string;
}

export interface WorkflowNode {
  id: string;
  nodeType: string;
  name: string;
  config: Record<string, unknown>;
  errorPolicy?: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

export interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionLabel: string | null;
  conditionExpr: string | null;
  edgeType?: string;
  sortOrder: number;
}

export interface WorkflowRun {
  id: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface RunStep {
  id: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: string;
  output: Record<string, unknown> | null;
  durationMs: number | null;
  startedAt: string | null;
}
