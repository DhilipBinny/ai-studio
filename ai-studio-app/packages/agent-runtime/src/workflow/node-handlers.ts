import { getDb } from "@ais-app/database";
import { providerModels, providers } from "@ais-app/database";
import { eq, and } from "drizzle-orm";
import { runSession } from "../session-runner";
import { callLLM } from "../llm-caller";
import { getModelPricing, calculateCost } from "../model-pricing";
import { executeTool, createLoopDetector, loadToolDefinitions } from "../tool-executor";
import { progressBus } from "../progress-bus";
import { ensureWorkspace } from "@ais/tools-common";
import type { WorkspaceConfig } from "@ais/tools-common";
import type { ToolCall, ToolContext } from "../tool-executor";
import type { ProviderConfig } from "../types";
import type { WorkflowState, NodeConfig, GraphNode, GraphEdge, ExecutionGraph, NodeResult } from "./types";
import dns from "node:dns";
import { resolveTemplate, evaluateCondition, normalizeKey } from "./expression-engine";
import { isPrivateIP } from "../ssrf-utils";

// Lazy import to avoid circular dependency with workflow-engine
let _triggerWorkflow: typeof import("../workflow-engine").triggerWorkflow | null = null;
async function getTriggerWorkflow() {
  if (!_triggerWorkflow) {
    const mod = await import("../workflow-engine");
    _triggerWorkflow = mod.triggerWorkflow;
  }
  return _triggerWorkflow;
}

// ---------------------------------------------------------------------------
// Step Recorder type (shared by main loop, loop nodes, iteration nodes)
// ---------------------------------------------------------------------------

export type StepRecorder = (
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
) => Promise<NodeResult & { attempt: number }>;

// ---------------------------------------------------------------------------
// Individual Node Type Executors
// ---------------------------------------------------------------------------

async function executeAgentNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
  nodeSpanId?: string,
): Promise<NodeResult> {
  const config = node.config;
  if (!config.agentId) throw new Error(`Agent node "${node.name}" has no agentId`);
  const message = config.message ? resolveTemplate(config.message, state) : "Process the input.";
  const projectId = config.projectId
    ? resolveTemplate(config.projectId, state)
    : (state.input as Record<string, unknown>)?.projectId as string | undefined;
  const result = await runSession({
    agentId: config.agentId, tenantId, userId: userId || "", message,
    channel: "workflow", sessionId: config.sessionId ? resolveTemplate(config.sessionId, state) : undefined,
    metadata: { workflowRunId: runId, nodeName: node.name, parentSpanId: nodeSpanId, projectId },
  });
  return {
    output: { response: result.response, sessionId: result.sessionId, status: result.status, usage: result.usage, error: result.error || null },
    paused: false,
  };
}

async function executeLLMNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
): Promise<NodeResult> {
  const config = node.config;
  if (!config.providerModelId) throw new Error(`LLM node "${node.name}" has no providerModelId`);
  const db = getDb();
  const [modelRow] = await db.select({
    modelId: providerModels.modelId, providerType: providers.providerType,
    apiKeyRef: providers.apiKeyRef, baseUrl: providers.baseUrl, providerConfig: providers.config,
    displayName: providerModels.displayName,
    costPerInputToken: providerModels.costPerInputToken, costPerOutputToken: providerModels.costPerOutputToken,
  }).from(providerModels).innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(and(eq(providerModels.id, config.providerModelId), eq(providerModels.tenantId, tenantId), eq(providerModels.isActive, true), eq(providers.isActive, true))).limit(1);

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

async function executeHttpRequestNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
): Promise<NodeResult> {
  const config = node.config;
  if (!config.url) throw new Error(`HTTP node "${node.name}" has no URL`);
  const url = resolveTemplate(config.url, state);

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) allowed");
    const host = parsed.hostname;
    if (host === "localhost" || host === "0.0.0.0" || host === "::1"
      || host.endsWith(".internal") || host.endsWith(".local")
      || isPrivateIP(host)) {
      throw new Error("SSRF blocked: private/internal addresses not allowed");
    }
    // DNS rebinding check: resolve hostname and validate the resolved IP
    try {
      const { address } = await dns.promises.lookup(host);
      if (isPrivateIP(address)) {
        throw new Error("SSRF blocked: hostname resolves to private address");
      }
    } catch (dnsErr) {
      if ((dnsErr as Error).message.includes("SSRF")) throw dnsErr;
      throw new Error(`DNS resolution failed for ${host}: ${(dnsErr as Error).message}`);
    }
  } catch (e) {
    if ((e as Error).message.includes("SSRF") || (e as Error).message.includes("Only HTTP") || (e as Error).message.includes("DNS resolution"))
      throw e;
    throw new Error(`Invalid URL: ${url}`);
  }
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

async function executeCodeNode(
  node: GraphNode,
  state: WorkflowState,
): Promise<NodeResult> {
  const config = node.config;
  if (!config.code) throw new Error(`Code node "${node.name}" has no code`);
  const { runInNewContext } = await import("node:vm");
  const frozenState = JSON.parse(JSON.stringify(state));
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.state = frozenState;
  sandbox.result = Object.create(null) as Record<string, unknown>;
  sandbox.console = Object.create(null) as Record<string, unknown>;
  sandbox.console = { log: () => {}, warn: () => {}, error: () => {} };
  Object.setPrototypeOf(sandbox.console, null);

  const safeJSON = Object.create(null) as Record<string, unknown>;
  safeJSON.parse = function (s: string) { return JSON.parse(s); };
  safeJSON.stringify = function (v: unknown) { return JSON.stringify(v); };
  Object.setPrototypeOf(safeJSON.parse, null);
  Object.setPrototypeOf(safeJSON.stringify, null);
  sandbox.JSON = safeJSON;

  const safeMath = Object.create(null) as Record<string, unknown>;
  for (const key of ["abs", "ceil", "floor", "round", "max", "min", "pow", "sqrt", "random", "log", "log2", "log10", "sign", "trunc", "PI", "E"] as const) {
    safeMath[key] = typeof Math[key] === "function" ? (...args: number[]) => (Math[key] as (...a: number[]) => number)(...args) : Math[key];
  }
  sandbox.Math = safeMath;

  sandbox.parseInt = (s: string, r?: number) => parseInt(s, r);
  sandbox.parseFloat = (s: string) => parseFloat(s);
  sandbox.isNaN = (v: unknown) => isNaN(v as number);
  sandbox.isFinite = (v: unknown) => isFinite(v as number);
  Object.setPrototypeOf(sandbox.parseInt, null);
  Object.setPrototypeOf(sandbox.parseFloat, null);
  Object.setPrototypeOf(sandbox.isNaN, null);
  Object.setPrototypeOf(sandbox.isFinite, null);

  const wrappedCode = `"use strict"; (function(state) { ${config.code} })(state)`;
  try {
    const returned = runInNewContext(wrappedCode, sandbox, { timeout: 5000, microtaskMode: "afterEvaluate" });
    const output = (returned && typeof returned === "object" && !Array.isArray(returned))
      ? JSON.parse(JSON.stringify(returned)) as Record<string, unknown>
      : JSON.parse(JSON.stringify(sandbox.result)) as Record<string, unknown>;
    return { output, paused: false };
  } catch (e) {
    throw new Error(`Code execution failed: ${(e as Error).message}`);
  }
}

async function executeKnowledgeSearchNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
): Promise<NodeResult> {
  const config = node.config;
  if (!config.knowledgeBaseId) throw new Error(`Knowledge search node "${node.name}" has no knowledgeBaseId`);
  const query = config.query ? resolveTemplate(config.query, state) : "";
  if (!query) throw new Error(`Knowledge search node "${node.name}" resolved to empty query`);
  const { searchKnowledge } = await import("../knowledge-search");
  const results = await searchKnowledge(tenantId, config.knowledgeBaseId, query, {
    topK: config.topK || 5,
    similarityThreshold: config.scoreThreshold || 0.3,
  });
  return { output: { results, query, count: results.length }, paused: false };
}

// ---------------------------------------------------------------------------
// Main Node Executor (thin switch that delegates)
// ---------------------------------------------------------------------------

export async function executeNode(
  node: GraphNode,
  state: WorkflowState,
  tenantId: string,
  runId: string,
  userId: string | null,
  nodeSpanId?: string,
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

    case "agent":
      return executeAgentNode(node, state, tenantId, runId, userId, nodeSpanId);

    case "llm":
      return executeLLMNode(node, state, tenantId, runId);

    case "tool": {
      if (!config.toolName) throw new Error(`Tool node "${node.name}" has no toolName`);
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config.arguments || {})) {
        args[k] = resolveTemplate(String(v), state);
      }
      const loopDetector = createLoopDetector();
      const ctx: ToolContext = { agentId: "", tenantId, sessionId: runId };
      const toolCall: ToolCall = { id: `wf-${Date.now()}`, name: config.toolName, input: args };
      const wsCfg: WorkspaceConfig = {
        dataRoot: process.env.DATA_ROOT || ".data",
        tenantId, agentId: "", sessionId: runId, workflowRunId: runId,
      };
      ensureWorkspace(wsCfg);
      const result = await executeTool(toolCall, tenantId, runId, loopDetector, ctx, new Map(), wsCfg);
      return { output: { result: result.content, isError: result.is_error || false }, paused: false };
    }

    case "condition": {
      const expr = config.expression ? resolveTemplate(config.expression, state) : "false";
      const result = evaluateCondition(expr, state);
      return { output: { result, expression: config.expression }, paused: false };
    }

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

    case "http_request":
      return executeHttpRequestNode(node, state, tenantId);

    case "code":
      return executeCodeNode(node, state);

    case "knowledge_search":
      return executeKnowledgeSearchNode(node, state, tenantId);

    case "aggregate":
      return { output: {}, paused: false };

    case "sub_workflow": {
      if (!config.workflowId) throw new Error(`Sub-workflow node "${node.name}" has no workflowId`);
      const subInput: Record<string, unknown> = {};
      for (const m of config.inputMappings || []) subInput[m.key] = resolveTemplate(m.value, state);
      const triggerWorkflow = await getTriggerWorkflow();
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
// Edge Resolution — helper functions
// ---------------------------------------------------------------------------

function resolveSwitchEdges(
  currentNode: GraphNode,
  normalEdges: GraphEdge[],
  graph: ExecutionGraph,
  state: WorkflowState,
): GraphNode[] {
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

function resolveConditionalEdges(
  normalEdges: GraphEdge[],
  graph: ExecutionGraph,
  state: WorkflowState,
): GraphNode[] {
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

export function getNextNodes(
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

  const normalEdges = outEdges.filter((e) =>
    e.edgeType === "normal" || e.edgeType === "loop_done" ||
    e.edgeType === "condition_true" || e.edgeType === "condition_false"
  );

  if (currentNode.nodeType === "switch") {
    return resolveSwitchEdges(currentNode, normalEdges, graph, state);
  }

  // Condition node: route by edgeType based on the node's boolean result
  if (currentNode.nodeType === "condition") {
    const nodeKey = normalizeKey(currentNode.name);
    const condResult = (state[nodeKey] as Record<string, unknown>)?.result;
    const targetType = condResult ? "condition_true" : "condition_false";
    const matchedEdge = normalEdges.find((e) => e.edgeType === targetType);
    if (matchedEdge) {
      const target = graph.nodes.get(matchedEdge.toNodeId);
      return target ? [target] : [];
    }
    return [];
  }

  const hasConditions = normalEdges.some((e) => e.conditionExpr);
  if (hasConditions) {
    return resolveConditionalEdges(normalEdges, graph, state);
  }

  return normalEdges.map((e) => graph.nodes.get(e.toNodeId)).filter((n): n is GraphNode => !!n);
}

// ---------------------------------------------------------------------------
// Loop / Iteration Execution
// ---------------------------------------------------------------------------

export function getLoopBodyNodes(loopNode: GraphNode, allEdges: GraphEdge[], allNodes: Map<string, GraphNode>): Set<string> {
  const bodyEdges = allEdges.filter((e) => e.fromNodeId === loopNode.id && e.edgeType === "loop_body");
  const bodyNodeIds = new Set<string>();
  const queue = bodyEdges.map((e) => e.toNodeId);

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (bodyNodeIds.has(id) || id === loopNode.id) continue;
    bodyNodeIds.add(id);
    const outgoing = allEdges.filter((e) => e.fromNodeId === id && (e.edgeType === "normal" || e.edgeType === "loop_body" || e.edgeType === "loop_done"));
    for (const edge of outgoing) {
      if (!bodyNodeIds.has(edge.toNodeId) && edge.toNodeId !== loopNode.id) {
        queue.push(edge.toNodeId);
      }
    }
  }

  return bodyNodeIds;
}

export async function executeLoopNode(
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

// ---------------------------------------------------------------------------
// Iteration Node — processIterationItems helper
// ---------------------------------------------------------------------------

async function processIterationItems(
  items: unknown[],
  config: NodeConfig,
  state: WorkflowState,
  bodyNodeIds: Set<string>,
  allNodes: Map<string, GraphNode>,
  recordStep: StepRecorder,
  tenantId: string,
  runId: string,
  userId: string | null,
): Promise<Array<Record<string, unknown>>> {
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

  return results;
}

export async function executeIterationNode(
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
  try { items = JSON.parse(resolved); } catch { throw new Error(`Iteration node "${node.name}": arrayPath resolved to invalid JSON: ${resolved.slice(0, 100)}`); }
  if (!Array.isArray(items)) throw new Error(`Iteration node "${node.name}": arrayPath did not resolve to an array`);

  const maxItems = config.maxItems || 1000;
  items = items.slice(0, maxItems);

  const bodyNodeIds = getLoopBodyNodes(node, allEdges, allNodes);

  const results = await processIterationItems(
    items, config, state, bodyNodeIds, allNodes, recordStep, tenantId, runId, userId,
  );

  delete (state as Record<string, unknown>)._iteration;
  return { results, count: results.length };
}

// ---------------------------------------------------------------------------
// Aggregate Node Resolution
// ---------------------------------------------------------------------------

export function resolveAggregate(
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
