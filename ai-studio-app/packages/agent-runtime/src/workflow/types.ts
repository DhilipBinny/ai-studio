// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowState {
  [key: string]: unknown;
}

export interface NodeErrorPolicy {
  onError: "stop" | "continue" | "error_branch";
  maxRetries: number;
  retryDelayMs: number;
  retryBackoff: "fixed" | "exponential";
  timeoutMs: number;
}

export const DEFAULT_ERROR_POLICY: NodeErrorPolicy = {
  onError: "stop", maxRetries: 0, retryDelayMs: 1000, retryBackoff: "fixed", timeoutMs: 0,
};

export interface NodeConfig {
  agentId?: string;
  message?: string;
  sessionId?: string;
  maxTurns?: number;
  expression?: string;
  mappings?: Array<{ key: string; value: string }>;
  prompt?: string;
  schema?: Record<string, unknown>;
  // switch
  value?: string;
  cases?: Array<{ label: string; condition: string }>;
  defaultCase?: string;
  // loop
  mode?: "while" | "for_count";
  condition?: string;
  maxCount?: number;
  maxIterations?: number;
  // iteration
  arrayPath?: string;
  itemVariable?: string;
  maxItems?: number;
  parallel?: boolean;
  batchSize?: number;
  // delay
  delayMs?: number;
  delayExpression?: string;
  // sub_workflow
  workflowId?: string;
  inputMappings?: Array<{ key: string; value: string }>;
  outputKey?: string;
  // llm
  providerModelId?: string;
  systemPrompt?: string;
  userMessage?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  // knowledge_search
  knowledgeBaseId?: string;
  query?: string;
  topK?: number;
  scoreThreshold?: number;
  // tool
  toolName?: string;
  arguments?: Record<string, string>;
  // http_request
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  responseType?: "json" | "text";
  // code
  code?: string;
  // aggregate
  strategy?: "merge" | "array" | "first" | "custom";
  customExpression?: string;
  // human_review
  reviewType?: "approve_deny" | "form" | "choice";
  choices?: string[];
  formFields?: Array<{ key: string; label: string; type: string; options?: string[]; required?: boolean }>;
  timeoutMs?: number;
  assignTo?: string;
  // project workspace
  projectId?: string;
}

export interface GraphNode {
  id: string;
  nodeType: string;
  name: string;
  config: NodeConfig;
  errorPolicy: NodeErrorPolicy;
}

export interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionLabel: string | null;
  conditionExpr: string | null;
  edgeType: string;
  sortOrder: number;
}

export interface WorkflowRunResult {
  runId: string;
  status: string;
  output: Record<string, unknown> | null;
  stepsCompleted: number;
  error?: string;
}

export interface ExecutionGraph {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
  reverseAdj: Map<string, string[]>;
  inDegree: Map<string, number>;
  startNodeId: string;
}

export interface NodeResult {
  output: Record<string, unknown>;
  paused: boolean;
  useErrorBranch?: boolean;
}

export const RESERVED_STATE_KEYS = new Set(["_error", "_loop", "_iteration", "_parallel", "_warnings"]);
