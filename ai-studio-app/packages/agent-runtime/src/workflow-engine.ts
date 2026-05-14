import { getDb } from "@ais-app/database";
import { workflows, workflowNodes, workflowEdges, workflowRuns, workflowRunSteps, providerModels, providers } from "@ais-app/database";
import { eq, and, asc, lt, isNotNull } from "drizzle-orm";
import { runSession } from "./session-runner";
import { callLLM } from "./llm-caller";
import { createProvider } from "./provider-factory";
import { getModelPricing, calculateCost } from "./model-pricing";
import { executeTool, createLoopDetector, loadToolDefinitions } from "./tool-executor";
import type { ToolCall, ToolContext } from "./tool-executor";
import type { ProviderConfig } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowState {
  [key: string]: unknown;
}

interface NodeErrorPolicy {
  onError: "stop" | "continue" | "error_branch";
  maxRetries: number;
  retryDelayMs: number;
  retryBackoff: "fixed" | "exponential";
  timeoutMs: number;
}

const DEFAULT_ERROR_POLICY: NodeErrorPolicy = {
  onError: "stop", maxRetries: 0, retryDelayMs: 1000, retryBackoff: "fixed", timeoutMs: 0,
};

interface NodeConfig {
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
}

interface GraphNode {
  id: string;
  nodeType: string;
  name: string;
  config: NodeConfig;
  errorPolicy: NodeErrorPolicy;
}

interface GraphEdge {
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

interface ExecutionGraph {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
  reverseAdj: Map<string, string[]>;
  inDegree: Map<string, number>;
  startNodeId: string;
}

interface NodeResult {
  output: Record<string, unknown>;
  paused: boolean;
  useErrorBranch?: boolean;
}

// ---------------------------------------------------------------------------
// Template / Expression Engine
// ---------------------------------------------------------------------------

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function resolveTemplate(template: string, state: WorkflowState): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const trimmed = expr.trim();

    const pipeIdx = trimmed.indexOf("|");
    const path = pipeIdx > -1 ? trimmed.slice(0, pipeIdx).trim() : trimmed;
    const filter = pipeIdx > -1 ? trimmed.slice(pipeIdx + 1).trim() : null;

    const parts = path.split(".");
    let current: unknown = state;
    for (const part of parts) {
      if (current === null || current === undefined) return "";
      if (BLOCKED_KEYS.has(part)) return "";
      current = (current as Record<string, unknown>)[part];
    }
    if (current === null || current === undefined) return "";

    let result = typeof current === "object" ? JSON.stringify(current) : String(current);

    if (filter) {
      const filterName = filter.split(":")[0].trim();
      const filterArg = filter.includes(":") ? filter.split(":")[1].trim() : null;
      switch (filterName) {
        case "upper": result = result.toUpperCase(); break;
        case "lower": result = result.toLowerCase(); break;
        case "trim": result = result.trim(); break;
        case "length": result = String(typeof current === "string" ? current.length : Array.isArray(current) ? current.length : 0); break;
        case "number": result = String(Number(result) || 0); break;
        case "round": { const digits = parseInt(filterArg || "0"); result = String(Number(Number(result).toFixed(digits))); break; }
        case "json": result = typeof current === "object" ? JSON.stringify(current) : result; break;
      }
    }

    return result;
  });
}

function evaluateCondition(expr: string, state: WorkflowState): boolean {
  const resolved = resolveTemplate(expr, state);

  const containsMatch = resolved.match(/^(.+?)\s+contains\s+"([^"]*)"$/i);
  if (containsMatch) return containsMatch[1].includes(containsMatch[2]);

  const notContainsMatch = resolved.match(/^(.+?)\s+not_contains\s+"([^"]*)"$/i);
  if (notContainsMatch) return !notContainsMatch[1].includes(notContainsMatch[2]);

  const equalsMatch = resolved.match(/^(.+?)\s+equals\s+"([^"]*)"$/i);
  if (equalsMatch) return equalsMatch[1].trim() === equalsMatch[2];

  const notEqualsMatch = resolved.match(/^(.+?)\s+not_equals\s+"([^"]*)"$/i);
  if (notEqualsMatch) return notEqualsMatch[1].trim() !== notEqualsMatch[2];

  const gtMatch = resolved.match(/^(.+?)\s+greater_than\s+(\d+(?:\.\d+)?)$/i);
  if (gtMatch) return Number(gtMatch[1]) > Number(gtMatch[2]);

  const ltMatch = resolved.match(/^(.+?)\s+less_than\s+(\d+(?:\.\d+)?)$/i);
  if (ltMatch) return Number(ltMatch[1]) < Number(ltMatch[2]);

  const gteMatch = resolved.match(/^(.+?)\s+gte\s+(\d+(?:\.\d+)?)$/i);
  if (gteMatch) return Number(gteMatch[1]) >= Number(gteMatch[2]);

  const lteMatch = resolved.match(/^(.+?)\s+lte\s+(\d+(?:\.\d+)?)$/i);
  if (lteMatch) return Number(lteMatch[1]) <= Number(lteMatch[2]);

  const isEmptyMatch = resolved.match(/^(.+?)\s+is_empty$/i);
  if (isEmptyMatch) { const v = isEmptyMatch[1].trim(); return v === "" || v === "null" || v === "undefined" || v === "[]" || v === "{}"; }

  const isNotEmptyMatch = resolved.match(/^(.+?)\s+is_not_empty$/i);
  if (isNotEmptyMatch) { const v = isNotEmptyMatch[1].trim(); return v !== "" && v !== "null" && v !== "undefined" && v !== "[]" && v !== "{}"; }

  return resolved.toLowerCase() === "true" || resolved === "1";
}

// ---------------------------------------------------------------------------
// Graph Builder
// ---------------------------------------------------------------------------

function buildExecutionGraph(nodes: GraphNode[], edges: GraphEdge[]): ExecutionGraph {
  const nodeMap = new Map<string, GraphNode>();
  const adjacency = new Map<string, GraphEdge[]>();
  const reverseAdj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    adjacency.set(node.id, []);
    reverseAdj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (edge.edgeType === "loop_back") continue;
    adjacency.get(edge.fromNodeId)?.push(edge);
    reverseAdj.get(edge.toNodeId)?.push(edge.fromNodeId);
    inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
  }

  let startNodeId = "";
  const inputNode = nodes.find((n) => n.nodeType === "input");
  if (inputNode) {
    startNodeId = inputNode.id;
  } else {
    const root = nodes.find((n) => (inDegree.get(n.id) || 0) === 0);
    startNodeId = root?.id || nodes[0]?.id || "";
  }

  return { nodes: nodeMap, adjacency, reverseAdj, inDegree, startNodeId };
}

// ---------------------------------------------------------------------------
// Node Executors
// ---------------------------------------------------------------------------

async function executeNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
): Promise<NodeResult> {
  const config = node.config;

  switch (node.nodeType) {
    case "input":
      return { output: (state.input as Record<string, unknown>) || {}, paused: false };

    case "output": {
      const mappings = config.mappings || [];
      if (mappings.length === 0) return { output: { ...state } as Record<string, unknown>, paused: false };
      const result: Record<string, unknown> = {};
      for (const m of mappings) result[m.key] = resolveTemplate(m.value, state);
      return { output: result, paused: false };
    }

    case "agent": {
      if (!config.agentId) throw new Error(`Agent node "${node.name}" has no agentId`);
      const message = config.message ? resolveTemplate(config.message, state) : "Process the input.";
      const result = await runSession({
        agentId: config.agentId, tenantId, userId: userId || "", message,
        channel: "workflow", sessionId: config.sessionId ? resolveTemplate(config.sessionId, state) : undefined,
        metadata: { workflowRunId: runId, nodeName: node.name },
      });
      return {
        output: { response: result.response, sessionId: result.sessionId, status: result.status, usage: result.usage, error: result.error || null },
        paused: false,
      };
    }

    case "llm": {
      if (!config.providerModelId) throw new Error(`LLM node "${node.name}" has no providerModelId`);
      const db = getDb();
      const [modelRow] = await db.select({
        modelId: providerModels.modelId, providerType: providers.providerType,
        apiKeyRef: providers.apiKeyRef, baseUrl: providers.baseUrl, providerConfig: providers.config,
        displayName: providerModels.displayName,
        costPerInputToken: providerModels.costPerInputToken, costPerOutputToken: providerModels.costPerOutputToken,
      }).from(providerModels).innerJoin(providers, eq(providerModels.providerId, providers.id))
        .where(and(eq(providerModels.id, config.providerModelId), eq(providerModels.isActive, true), eq(providers.isActive, true))).limit(1);

      if (!modelRow) throw new Error(`Model not found or inactive for LLM node "${node.name}"`);

      const providerConfig: ProviderConfig = {
        providerType: modelRow.providerType, apiKeyRef: modelRow.apiKeyRef, baseUrl: modelRow.baseUrl,
        config: (modelRow.providerConfig as Record<string, unknown>) || {}, modelId: modelRow.modelId, displayName: modelRow.displayName,
      };

      const systemPrompt = config.systemPrompt ? resolveTemplate(config.systemPrompt, state) : "";
      const userMessage = config.userMessage ? resolveTemplate(config.userMessage, state) : "";
      const messages = [{ role: "user" as const, content: userMessage }];

      const response = await callLLM(providerConfig, systemPrompt, messages, {
        temperature: config.temperature, maxTokens: config.maxTokens,
      });

      const pricing = getModelPricing(modelRow.providerType, modelRow.modelId, modelRow.costPerInputToken, modelRow.costPerOutputToken);
      const costUsd = calculateCost(pricing, response.inputTokens, response.outputTokens);

      let parsedResponse: unknown = response.text;
      if (config.responseFormat === "json") {
        try { parsedResponse = JSON.parse(response.text); } catch { /* keep as string */ }
      }

      return {
        output: { response: parsedResponse, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd },
        paused: false,
      };
    }

    case "tool": {
      if (!config.toolName) throw new Error(`Tool node "${node.name}" has no toolName`);
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config.arguments || {})) {
        args[k] = resolveTemplate(String(v), state);
      }
      const loopDetector = createLoopDetector();
      const ctx: ToolContext = { agentId: "", tenantId, sessionId: runId };
      const toolCall: ToolCall = { id: `wf-${Date.now()}`, name: config.toolName, input: args };
      const result = await executeTool(toolCall, tenantId, runId, loopDetector, ctx, new Map(), undefined);
      return { output: { result: result.content, isError: result.is_error || false }, paused: false };
    }

    case "condition":
      return { output: { evaluated: true }, paused: false };

    case "switch": {
      const val = config.value ? resolveTemplate(config.value, state).trim() : "";
      let matched = config.defaultCase || "default";
      for (const c of config.cases || []) {
        if (val === c.condition || evaluateCondition(`${val} equals "${c.condition}"`, state)) {
          matched = c.label;
          break;
        }
      }
      return { output: { matched, value: val }, paused: false };
    }

    case "transform": {
      const result: Record<string, unknown> = {};
      for (const m of config.mappings || []) result[m.key] = resolveTemplate(m.value, state);
      return { output: result, paused: false };
    }

    case "delay": {
      const ms = config.delayExpression
        ? Number(resolveTemplate(config.delayExpression, state)) || 0
        : config.delayMs || 0;
      const clamped = Math.min(Math.max(ms, 0), 300_000);
      if (clamped > 0) await new Promise((r) => setTimeout(r, clamped));
      return { output: { delayed: true, durationMs: clamped }, paused: false };
    }

    case "human_review":
      return {
        output: {
          prompt: config.prompt ? resolveTemplate(config.prompt, state) : "Please review and approve.",
          reviewType: config.reviewType || "approve_deny",
          choices: config.choices,
          formFields: config.formFields,
          status: "waiting",
        },
        paused: true,
      };

    case "http_request": {
      if (!config.url) throw new Error(`HTTP node "${node.name}" has no URL`);
      const url = resolveTemplate(config.url, state);
      const resolvedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.headers || {})) {
        resolvedHeaders[k] = resolveTemplate(v, state);
      }
      const bodyStr = config.body ? resolveTemplate(config.body, state) : undefined;
      const timeoutMs = config.timeoutMs || 30_000;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          method: config.method || "GET",
          headers: resolvedHeaders,
          body: config.method !== "GET" ? bodyStr : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        let responseBody: unknown;
        if (config.responseType === "json") {
          try { responseBody = await resp.json(); } catch { responseBody = await resp.text(); }
        } else {
          responseBody = await resp.text();
        }

        return { output: { status: resp.status, body: responseBody }, paused: false };
      } catch (e) {
        clearTimeout(timer);
        throw new Error(`HTTP request failed: ${(e as Error).message}`);
      }
    }

    case "code": {
      if (!config.code) throw new Error(`Code node "${node.name}" has no code`);
      const { runInNewContext } = await import("node:vm");
      const sandbox = {
        state: JSON.parse(JSON.stringify(state)),
        result: {} as Record<string, unknown>,
        console: { log: () => {}, warn: () => {}, error: () => {} },
        JSON, Math, String, Number, Boolean, Array, Object, Date,
        parseInt, parseFloat, isNaN, isFinite,
      };
      const wrappedCode = `(function(state) { ${config.code} })(state)`;
      try {
        const returned = runInNewContext(wrappedCode, sandbox, { timeout: 5000 });
        const output = (returned && typeof returned === "object") ? returned as Record<string, unknown> : sandbox.result;
        return { output, paused: false };
      } catch (e) {
        throw new Error(`Code execution failed: ${(e as Error).message}`);
      }
    }

    case "aggregate":
      return { output: {}, paused: false };

    case "sub_workflow": {
      if (!config.workflowId) throw new Error(`Sub-workflow node "${node.name}" has no workflowId`);
      const subInput: Record<string, unknown> = {};
      for (const m of config.inputMappings || []) subInput[m.key] = resolveTemplate(m.value, state);
      const subResult = await triggerWorkflow(config.workflowId, tenantId, userId, subInput, runId);
      if (subResult.status === "failed") throw new Error(`Sub-workflow failed: ${subResult.error}`);
      return { output: subResult.output || {}, paused: false };
    }

    case "loop":
    case "iteration":
      return { output: {}, paused: false };

    default:
      throw new Error(`Unknown node type: ${node.nodeType}`);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(stepId: number): ReturnType<typeof setInterval> {
  const db = getDb();
  return setInterval(async () => {
    try {
      await db.update(workflowRunSteps).set({ lastHeartbeatAt: new Date() }).where(eq(workflowRunSteps.id, stepId));
    } catch { /* heartbeat failure is non-fatal */ }
  }, 15_000);
}

// ---------------------------------------------------------------------------
// Retry Wrapper
// ---------------------------------------------------------------------------

async function executeNodeWithRetry(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
  stepId: number,
): Promise<{ result: NodeResult; attempt: number }> {
  const policy = node.errorPolicy;
  let attempt = 0;

  while (attempt <= policy.maxRetries) {
    attempt++;
    const heartbeat = startHeartbeat(stepId);

    try {
      const timeoutMs = policy.timeoutMs || 600_000;
      const result = await Promise.race([
        executeNode(node, state, tenantId, runId, userId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Node "${node.name}" timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      clearInterval(heartbeat);
      return { result, attempt };
    } catch (error) {
      clearInterval(heartbeat);

      if (attempt <= policy.maxRetries) {
        const delay = policy.retryBackoff === "exponential"
          ? policy.retryDelayMs * Math.pow(2, attempt - 1)
          : policy.retryDelayMs;

        const db = getDb();
        await db.update(workflowRunSteps).set({
          status: "retrying",
          errorMessage: `Attempt ${attempt} failed: ${(error as Error).message}. Retrying in ${delay}ms...`,
          attempt,
        }).where(eq(workflowRunSteps.id, stepId));

        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      switch (policy.onError) {
        case "continue":
          return {
            result: { output: { _error: true, message: (error as Error).message, attempt }, paused: false },
            attempt,
          };
        case "error_branch":
          return {
            result: {
              output: { _error: true, message: (error as Error).message, nodeId: node.id, attempt },
              paused: false,
              useErrorBranch: true,
            },
            attempt,
          };
        default:
          throw error;
      }
    }
  }

  throw new Error("Unreachable");
}

// ---------------------------------------------------------------------------
// Edge Resolution
// ---------------------------------------------------------------------------

function getNextNodes(
  currentNode: GraphNode,
  graph: ExecutionGraph,
  state: WorkflowState,
  useErrorBranch: boolean,
): GraphNode[] {
  const outEdges = (graph.adjacency.get(currentNode.id) || [])
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (outEdges.length === 0) return [];

  if (useErrorBranch) {
    const errorEdges = outEdges.filter((e) => e.edgeType === "error");
    if (errorEdges.length > 0) {
      return errorEdges.map((e) => graph.nodes.get(e.toNodeId)).filter((n): n is GraphNode => !!n);
    }
    return [];
  }

  const normalEdges = outEdges.filter((e) => e.edgeType === "normal" || e.edgeType === "loop_done");

  if (currentNode.nodeType === "switch") {
    const switchOutput = state[normalizeKey(currentNode.name)] as Record<string, unknown> | undefined;
    const matched = (switchOutput?.matched as string) || "";
    for (const edge of normalEdges) {
      if (edge.conditionLabel === matched) {
        const target = graph.nodes.get(edge.toNodeId);
        return target ? [target] : [];
      }
    }
    const defaultEdge = normalEdges.find((e) => e.conditionLabel === "default" || !e.conditionExpr);
    if (defaultEdge) {
      const target = graph.nodes.get(defaultEdge.toNodeId);
      return target ? [target] : [];
    }
    return [];
  }

  const hasConditions = normalEdges.some((e) => e.conditionExpr);
  if (hasConditions) {
    for (const edge of normalEdges) {
      if (edge.conditionExpr && evaluateCondition(edge.conditionExpr, state)) {
        const target = graph.nodes.get(edge.toNodeId);
        return target ? [target] : [];
      }
    }
    const defaultEdge = normalEdges.find((e) => !e.conditionExpr);
    if (defaultEdge) {
      const target = graph.nodes.get(defaultEdge.toNodeId);
      return target ? [target] : [];
    }
    return [];
  }

  return normalEdges.map((e) => graph.nodes.get(e.toNodeId)).filter((n): n is GraphNode => !!n);
}

function normalizeKey(name: string): string {
  return name.replace(/\s+/g, "_").toLowerCase();
}

// ---------------------------------------------------------------------------
// Loop / Iteration Execution
// ---------------------------------------------------------------------------

function getLoopBodyNodes(loopNode: GraphNode, allEdges: GraphEdge[], allNodes: Map<string, GraphNode>): Set<string> {
  const bodyEdges = allEdges.filter((e) => e.fromNodeId === loopNode.id && e.edgeType === "loop_body");
  const bodyNodeIds = new Set<string>();
  const queue = bodyEdges.map((e) => e.toNodeId);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (bodyNodeIds.has(id) || id === loopNode.id) continue;
    bodyNodeIds.add(id);
    const outgoing = allEdges.filter((e) => e.fromNodeId === id && e.edgeType !== "loop_back");
    for (const edge of outgoing) {
      if (!bodyNodeIds.has(edge.toNodeId) && edge.toNodeId !== loopNode.id) {
        queue.push(edge.toNodeId);
      }
    }
  }

  return bodyNodeIds;
}

async function executeLoopNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
  allEdges: GraphEdge[],
  allNodes: Map<string, GraphNode>,
  recordStep: StepRecorder,
): Promise<Record<string, unknown>> {
  const config = node.config;
  const maxIter = config.maxIterations || 100;
  const bodyNodeIds = getLoopBodyNodes(node, allEdges, allNodes);
  let counter = 0;
  let lastResult: Record<string, unknown> | null = null;

  while (counter < maxIter) {
    (state as Record<string, unknown>)._loop = { counter, previous: lastResult };

    if (config.mode === "while" && config.condition) {
      if (!evaluateCondition(config.condition, state)) break;
    }
    if (config.mode === "for_count" && counter >= (config.maxCount || 0)) break;

    for (const bodyNodeId of bodyNodeIds) {
      const bodyNode = allNodes.get(bodyNodeId);
      if (!bodyNode) continue;
      const stepResult = await recordStep(bodyNode, state, tenantId, runId, userId);
      state[normalizeKey(bodyNode.name)] = stepResult.output;
      lastResult = stepResult.output;
    }

    counter++;
  }

  delete (state as Record<string, unknown>)._loop;
  return { iterations: counter, lastResult: lastResult || {} };
}

async function executeIterationNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
  allEdges: GraphEdge[],
  allNodes: Map<string, GraphNode>,
  recordStep: StepRecorder,
): Promise<Record<string, unknown>> {
  const config = node.config;
  if (!config.arrayPath) throw new Error(`Iteration node "${node.name}" has no arrayPath`);

  const resolved = resolveTemplate(config.arrayPath, state);
  let items: unknown[];
  try { items = JSON.parse(resolved); } catch { items = []; }
  if (!Array.isArray(items)) throw new Error(`Iteration node "${node.name}": arrayPath did not resolve to an array`);

  const maxItems = config.maxItems || 1000;
  items = items.slice(0, maxItems);

  const bodyNodeIds = getLoopBodyNodes(node, allEdges, allNodes);
  const results: Array<Record<string, unknown>> = [];
  const batchSize = config.batchSize || 5;

  async function processItem(item: unknown, index: number): Promise<Record<string, unknown>> {
    const itemState: WorkflowState = { ...state, _iteration: { index, item, total: items.length } };
    let lastOutput: Record<string, unknown> = {};
    for (const bodyNodeId of bodyNodeIds) {
      const bodyNode = allNodes.get(bodyNodeId);
      if (!bodyNode) continue;
      const stepResult = await recordStep(bodyNode, itemState, tenantId, runId, userId);
      itemState[normalizeKey(bodyNode.name)] = stepResult.output;
      lastOutput = stepResult.output;
    }
    return lastOutput;
  }

  if (config.parallel) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((item, batchIdx) => processItem(item, i + batchIdx))
      );
      for (const r of batchResults) {
        results.push(r.status === "fulfilled" ? r.value : { _error: true, message: (r.reason as Error).message });
      }
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      results.push(await processItem(items[i], i));
    }
  }

  delete (state as Record<string, unknown>)._iteration;
  return { results, count: results.length };
}

// ---------------------------------------------------------------------------
// Step Recorder (shared by main loop, loop nodes, iteration nodes)
// ---------------------------------------------------------------------------

type StepRecorder = (
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
) => Promise<NodeResult & { attempt: number }>;

function createStepRecorder(): StepRecorder {
  return async (node, state, tenantId, runId, userId) => {
    const db = getDb();
    const stepStart = Date.now();

    const [step] = await db.insert(workflowRunSteps).values({
      tenantId, workflowRunId: runId, workflowNodeId: node.id,
      status: "running", input: state, startedAt: new Date(), lastHeartbeatAt: new Date(),
    }).returning({ id: workflowRunSteps.id });

    try {
      const { result, attempt } = await executeNodeWithRetry(node, state, tenantId, runId, userId, step.id);

      await db.update(workflowRunSteps).set({
        status: result.paused ? "waiting_human" : "completed",
        output: result.output, durationMs: Date.now() - stepStart,
        completedAt: new Date(), attempt,
      }).where(eq(workflowRunSteps.id, step.id));

      return { ...result, attempt };
    } catch (error) {
      await db.update(workflowRunSteps).set({
        status: "failed", errorMessage: (error as Error).message,
        durationMs: Date.now() - stepStart, completedAt: new Date(),
      }).where(eq(workflowRunSteps.id, step.id));
      throw error;
    }
  };
}

// ---------------------------------------------------------------------------
// Aggregate Node Resolution
// ---------------------------------------------------------------------------

function resolveAggregate(
  node: GraphNode,
  predecessorOutputs: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const strategy = node.config.strategy || "merge";
  const outputs = Array.from(predecessorOutputs.values());

  switch (strategy) {
    case "merge": {
      const merged: Record<string, unknown> = {};
      for (const o of outputs) Object.assign(merged, o);
      return merged;
    }
    case "array":
      return { items: outputs, count: outputs.length };
    case "first":
      return outputs[0] || {};
    default:
      return { items: outputs, count: outputs.length };
  }
}

// ---------------------------------------------------------------------------
// Main Executor
// ---------------------------------------------------------------------------

const MAX_STEPS = 200;
const MAX_PARALLEL = 10;

async function executeGraph(
  graph: ExecutionGraph,
  allEdges: GraphEdge[],
  state: WorkflowState,
  runId: string,
  tenantId: string,
  userId: string | null,
  resumeFromNodeIds?: string[],
): Promise<{ stepsCompleted: number; paused: boolean }> {
  const db = getDb();
  const recordStep = createStepRecorder();
  const completed = new Set<string>();
  const pendingInDegree = new Map(graph.inDegree);
  const nodeOutputs = new Map<string, Record<string, unknown>>();
  let stepsCompleted = 0;

  if (resumeFromNodeIds && resumeFromNodeIds.length > 0) {
    for (const [nodeId, node] of graph.nodes) {
      const key = normalizeKey(node.name);
      if (state[key] !== undefined && !resumeFromNodeIds.includes(nodeId)) {
        completed.add(nodeId);
        if (typeof state[key] === "object" && state[key] !== null) {
          nodeOutputs.set(nodeId, state[key] as Record<string, unknown>);
        }
      }
    }
  }

  let ready: GraphNode[] = [];
  if (resumeFromNodeIds && resumeFromNodeIds.length > 0) {
    ready = resumeFromNodeIds.map((id) => graph.nodes.get(id)).filter((n): n is GraphNode => !!n);
  } else {
    const startNode = graph.nodes.get(graph.startNodeId);
    if (startNode) ready.push(startNode);
  }

  while (ready.length > 0 && stepsCompleted < MAX_STEPS) {
    const sequential: GraphNode[] = [];
    const parallel: GraphNode[] = [];

    for (const node of ready) {
      if (node.nodeType === "aggregate") {
        const preds = graph.reverseAdj.get(node.id) || [];
        if (!preds.every((p) => completed.has(p))) {
          continue;
        }
      }

      const outEdges = graph.adjacency.get(node.id) || [];
      const peers = ready.filter((n) => n.id !== node.id);
      const isParallelPeer = peers.length > 0 && ready.length > 1 && node.nodeType !== "loop" && node.nodeType !== "iteration";

      if (isParallelPeer && node.nodeType !== "aggregate") {
        parallel.push(node);
      } else {
        sequential.push(node);
      }
    }

    const toExecute = parallel.length > 1
      ? parallel.slice(0, MAX_PARALLEL)
      : sequential.length > 0 ? [sequential[0]] : parallel.slice(0, 1);

    const remaining = ready.filter((n) => !toExecute.some((t) => t.id === n.id));

    if (toExecute.length > 1) {
      const results = await Promise.allSettled(
        toExecute.map(async (node) => {
          if (node.nodeType === "loop") {
            return { node, output: await executeLoopNode(node, { ...state }, tenantId, runId, userId, allEdges, graph.nodes, recordStep), paused: false, useErrorBranch: false };
          }
          if (node.nodeType === "iteration") {
            return { node, output: await executeIterationNode(node, { ...state }, tenantId, runId, userId, allEdges, graph.nodes, recordStep), paused: false, useErrorBranch: false };
          }
          const stepResult = await recordStep(node, state, tenantId, runId, userId);
          stepsCompleted++;
          return { node, output: stepResult.output, paused: stepResult.paused, useErrorBranch: stepResult.useErrorBranch || false };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          const { node, output, paused, useErrorBranch } = r.value;
          const key = normalizeKey(node.name);
          state[key] = output;
          nodeOutputs.set(node.id, output);
          completed.add(node.id);

          if (paused) {
            await db.update(workflowRuns).set({ status: "waiting", output: state }).where(eq(workflowRuns.id, runId));
            return { stepsCompleted, paused: true };
          }
        } else {
          const failedNode = toExecute.find((_, i) => results[i] === r);
          if (failedNode) {
            completed.add(failedNode.id);
            state[normalizeKey(failedNode.name)] = { _error: true, message: (r.reason as Error).message };
          }
        }
      }
    } else if (toExecute.length === 1) {
      const node = toExecute[0];

      if (node.nodeType === "loop") {
        const output = await executeLoopNode(node, state, tenantId, runId, userId, allEdges, graph.nodes, recordStep);
        state[normalizeKey(node.name)] = output;
        nodeOutputs.set(node.id, output);
        completed.add(node.id);
        stepsCompleted++;
      } else if (node.nodeType === "iteration") {
        const output = await executeIterationNode(node, state, tenantId, runId, userId, allEdges, graph.nodes, recordStep);
        state[normalizeKey(node.name)] = output;
        nodeOutputs.set(node.id, output);
        completed.add(node.id);
        stepsCompleted++;
      } else if (node.nodeType === "aggregate") {
        const predIds = graph.reverseAdj.get(node.id) || [];
        const predOutputs = new Map<string, Record<string, unknown>>();
        for (const pid of predIds) {
          const pOutput = nodeOutputs.get(pid);
          if (pOutput) predOutputs.set(pid, pOutput);
        }
        const aggregated = resolveAggregate(node, predOutputs);
        state[normalizeKey(node.name)] = aggregated;
        nodeOutputs.set(node.id, aggregated);
        completed.add(node.id);

        const [step] = await db.insert(workflowRunSteps).values({
          tenantId, workflowRunId: runId, workflowNodeId: node.id,
          status: "completed", input: state, output: aggregated,
          startedAt: new Date(), completedAt: new Date(), durationMs: 0, lastHeartbeatAt: new Date(),
        }).returning({ id: workflowRunSteps.id });
        stepsCompleted++;
      } else {
        const stepResult = await recordStep(node, state, tenantId, runId, userId);
        state[normalizeKey(node.name)] = stepResult.output;
        nodeOutputs.set(node.id, stepResult.output);
        completed.add(node.id);
        stepsCompleted++;

        if (stepResult.paused) {
          await db.update(workflowRuns).set({ status: "waiting", output: state }).where(eq(workflowRuns.id, runId));
          return { stepsCompleted, paused: true };
        }

        if (stepResult.useErrorBranch) {
          const errorNext = getNextNodes(node, graph, state, true);
          remaining.push(...errorNext);
        }
      }
    }

    await db.update(workflowRuns).set({ output: state }).where(eq(workflowRuns.id, runId));

    if (toExecute.some((n) => n.nodeType === "output")) break;

    ready = [...remaining];
    for (const doneNode of toExecute) {
      if (!completed.has(doneNode.id)) continue;
      const useErrBranch = (state[normalizeKey(doneNode.name)] as Record<string, unknown>)?._error === true
        && doneNode.errorPolicy.onError === "error_branch";
      const nextNodes = getNextNodes(doneNode, graph, state, useErrBranch);
      for (const next of nextNodes) {
        if (completed.has(next.id) || ready.some((r) => r.id === next.id)) continue;

        const preds = graph.reverseAdj.get(next.id) || [];
        const normalPreds = preds.filter((pid) => {
          const edges = allEdges.filter((e) => e.fromNodeId === pid && e.toNodeId === next.id);
          return edges.some((e) => e.edgeType === "normal" || e.edgeType === "loop_done" || e.edgeType === "error");
        });

        if (next.nodeType === "aggregate") {
          if (normalPreds.every((p) => completed.has(p))) ready.push(next);
        } else {
          ready.push(next);
        }
      }
    }
  }

  return { stepsCompleted, paused: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function triggerWorkflow(
  workflowId: string,
  tenantId: string,
  userId: string | null,
  input: Record<string, unknown>,
  parentRunId?: string,
): Promise<WorkflowRunResult> {
  const db = getDb();

  const [workflow] = await db.select().from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.tenantId, tenantId))).limit(1);
  if (!workflow) throw new Error("Workflow not found");
  if (workflow.status !== "active") throw new Error("Workflow is not active");

  const nodes = await db.select().from(workflowNodes)
    .where(and(eq(workflowNodes.workflowId, workflowId), eq(workflowNodes.tenantId, tenantId)))
    .orderBy(asc(workflowNodes.createdAt));
  const edges = await db.select().from(workflowEdges)
    .where(and(eq(workflowEdges.workflowId, workflowId), eq(workflowEdges.tenantId, tenantId)));

  if (nodes.length === 0) throw new Error("Workflow has no nodes");

  const [run] = await db.insert(workflowRuns).values({
    tenantId, workflowId, triggerType: parentRunId ? "sub_workflow" : "manual",
    triggerData: {}, status: "running", input, startedAt: new Date(),
    triggeredBy: userId, parentRunId: parentRunId || null,
    timeoutAt: new Date(Date.now() + 3600_000),
  }).returning();

  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id, nodeType: n.nodeType, name: n.name,
    config: (n.config || {}) as NodeConfig,
    errorPolicy: { ...DEFAULT_ERROR_POLICY, ...((n.errorPolicy || {}) as Partial<NodeErrorPolicy>) },
  }));
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId,
    conditionLabel: e.conditionLabel, conditionExpr: e.conditionExpr,
    edgeType: e.edgeType || "normal", sortOrder: e.sortOrder,
  }));

  const graph = buildExecutionGraph(graphNodes, graphEdges);
  const state: WorkflowState = { input };

  try {
    const { stepsCompleted, paused } = await executeGraph(graph, graphEdges, state, run.id, tenantId, userId);

    if (paused) {
      return { runId: run.id, status: "waiting", output: state as Record<string, unknown>, stepsCompleted };
    }

    await db.update(workflowRuns).set({ status: "completed", output: state, completedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));
    return { runId: run.id, status: "completed", output: state as Record<string, unknown>, stepsCompleted };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await db.update(workflowRuns).set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));
    return { runId: run.id, status: "failed", output: null, stepsCompleted: 0, error: errorMsg };
  }
}

export async function resumeWorkflow(
  runId: string,
  tenantId: string,
  userId: string,
  decision: Record<string, unknown>,
): Promise<WorkflowRunResult> {
  const db = getDb();

  const [run] = await db.update(workflowRuns).set({ status: "running" })
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.tenantId, tenantId), eq(workflowRuns.status, "waiting")))
    .returning();
  if (!run) throw new Error("Run not found or not paused");

  const steps = await db.select().from(workflowRunSteps)
    .where(eq(workflowRunSteps.workflowRunId, runId)).orderBy(asc(workflowRunSteps.createdAt));
  const lastStep = steps[steps.length - 1];
  if (!lastStep || lastStep.status !== "waiting_human") throw new Error("No step waiting for human input");

  await db.update(workflowRunSteps).set({ status: "completed", output: decision, completedAt: new Date() })
    .where(eq(workflowRunSteps.id, lastStep.id));

  const state = (run.output || {}) as WorkflowState;
  const pausedNodeId = lastStep.workflowNodeId;

  const nodes = await db.select().from(workflowNodes)
    .where(and(eq(workflowNodes.workflowId, run.workflowId), eq(workflowNodes.tenantId, tenantId)));
  const edges = await db.select().from(workflowEdges)
    .where(and(eq(workflowEdges.workflowId, run.workflowId), eq(workflowEdges.tenantId, tenantId)));

  const graphNodes: GraphNode[] = nodes.map((n) => ({
    id: n.id, nodeType: n.nodeType, name: n.name,
    config: (n.config || {}) as NodeConfig,
    errorPolicy: { ...DEFAULT_ERROR_POLICY, ...((n.errorPolicy || {}) as Partial<NodeErrorPolicy>) },
  }));
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId,
    conditionLabel: e.conditionLabel, conditionExpr: e.conditionExpr,
    edgeType: e.edgeType || "normal", sortOrder: e.sortOrder,
  }));

  const pausedNode = graphNodes.find((n) => n.id === pausedNodeId);
  if (!pausedNode) throw new Error("Paused node not found");

  const nodeKey = normalizeKey(pausedNode.name);
  state[nodeKey] = { ...((state[nodeKey] as Record<string, unknown>) || {}), decision };
  await db.update(workflowRuns).set({ output: state }).where(eq(workflowRuns.id, runId));

  const graph = buildExecutionGraph(graphNodes, graphEdges);

  const nextEdges = graphEdges.filter((e) => e.fromNodeId === pausedNodeId && e.edgeType !== "error");
  const nextNodeIds = nextEdges.map((e) => e.toNodeId);

  try {
    const result = await executeGraph(graph, graphEdges, state, runId, tenantId, userId, nextNodeIds);
    const stepsCompleted = steps.length + result.stepsCompleted;

    if (result.paused) {
      return { runId, status: "waiting", output: state as Record<string, unknown>, stepsCompleted };
    }

    await db.update(workflowRuns).set({ status: "completed", output: state, completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    return { runId, status: "completed", output: state as Record<string, unknown>, stepsCompleted };
  } catch (e) {
    const errorMsg = (e as Error).message;
    await db.update(workflowRuns).set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(workflowRuns.id, runId));
    return { runId, status: "failed", output: null, stepsCompleted: 0, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Recovery Sweep
// ---------------------------------------------------------------------------

export async function recoverStaleWorkflowRuns(): Promise<number> {
  const db = getDb();
  const staleThreshold = new Date(Date.now() - 90_000);
  let recovered = 0;

  const staleSteps = await db.select({
    id: workflowRunSteps.id,
    runId: workflowRunSteps.workflowRunId,
    nodeId: workflowRunSteps.workflowNodeId,
    attempt: workflowRunSteps.attempt,
  }).from(workflowRunSteps)
    .where(and(
      eq(workflowRunSteps.status, "running"),
      lt(workflowRunSteps.lastHeartbeatAt, staleThreshold),
    ));

  for (const step of staleSteps) {
    await db.update(workflowRunSteps).set({
      status: "failed",
      errorMessage: "Execution interrupted (server restart or timeout)",
      completedAt: new Date(),
    }).where(eq(workflowRunSteps.id, step.id));

    await db.update(workflowRuns).set({
      status: "failed",
      errorMessage: `Step interrupted: node execution did not complete`,
      completedAt: new Date(),
    }).where(and(eq(workflowRuns.id, step.runId), eq(workflowRuns.status, "running")));

    recovered++;
  }

  const timedOutRuns = await db.select({ id: workflowRuns.id }).from(workflowRuns)
    .where(and(
      eq(workflowRuns.status, "running"),
      isNotNull(workflowRuns.timeoutAt),
      lt(workflowRuns.timeoutAt, new Date()),
    ));

  for (const run of timedOutRuns) {
    await db.update(workflowRuns).set({
      status: "timeout", errorMessage: "Workflow execution timed out", completedAt: new Date(),
    }).where(eq(workflowRuns.id, run.id));
    recovered++;
  }

  return recovered;
}
