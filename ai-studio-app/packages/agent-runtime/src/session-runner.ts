import { getDb } from "@ais-app/database";
import { agents, agentSessions, agentSessionMessages, providers, providerModels, usageRecords } from "@ais-app/database";
import { eq, and, asc, sql } from "drizzle-orm";
import { buildSystemPrompt } from "./prompt-builder";
import { callLLM } from "./llm-caller";
import { loadToolDefinitions, executeTool, createLoopDetector } from "./tool-executor";
import { checkAndCompact } from "./compaction";
import { sanitizeInput, detectPromptInjection } from "@ais/security";
import { getModelPricing, calculateCost } from "./model-pricing";
import { progressBus, truncatePreview } from "./progress-bus";
import { textDeltaBus } from "./text-delta-bus";
import type { SessionInput, SessionResult, AgentConfig, ProviderConfig } from "./types";
import type { ToolCall, ToolContext } from "./tool-executor";

import { getConfigSync } from "./config";

interface ToolCallBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface LoadedAgentAndProvider {
  agentConfig: AgentConfig;
  providerConfig: ProviderConfig;
  modelRow: {
    providerModelId: string;
    modelId: string;
    displayName: string;
    costPerInputToken: string | null;
    costPerOutputToken: string | null;
    providerType: string;
    apiKeyRef: string | null;
    baseUrl: string | null;
    providerConfig: unknown;
  };
  agent: {
    providerModelId: string | null;
    modelConfig: unknown;
  };
}

interface PreparedSession {
  sessionId: string;
  systemPrompt: string;
  toolDefs: Awaited<ReturnType<typeof loadToolDefinitions>>["definitions"];
  mcpConnectorMap: Awaited<ReturnType<typeof loadToolDefinitions>>["mcpConnectorMap"];
  workspaceConfig: Awaited<ReturnType<typeof loadToolDefinitions>>["workspaceConfig"];
  loopDetector: ReturnType<typeof createLoopDetector>;
  toolContext: ToolContext;
  pricing: ReturnType<typeof getModelPricing>;
  traceId: string;
  agentSpan: ReturnType<typeof progressBus.emit>;
  workflowRunId: string | undefined;
  parentSpanId: string | undefined;
}

interface ToolLoopTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  totalCost: number;
  finalText: string;
}

// ---------------------------------------------------------------------------
// Step 1: Load agent and provider
// ---------------------------------------------------------------------------

async function loadAgentAndProvider(input: SessionInput): Promise<LoadedAgentAndProvider | SessionResult> {
  const db = getDb();

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, input.agentId), eq(agents.tenantId, input.tenantId)))
    .limit(1);

  if (!agent) return fail("Agent not found");
  if (agent.status !== "active") return fail("Agent is not active");
  if (!agent.providerModelId) return fail("No model configured for this agent");

  const [modelRow] = await db
    .select({
      providerModelId: providerModels.id,
      modelId: providerModels.modelId,
      displayName: providerModels.displayName,
      costPerInputToken: providerModels.costPerInputToken,
      costPerOutputToken: providerModels.costPerOutputToken,
      providerType: providers.providerType,
      apiKeyRef: providers.apiKeyRef,
      baseUrl: providers.baseUrl,
      providerConfig: providers.config,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(and(
      eq(providerModels.id, agent.providerModelId),
      eq(providerModels.tenantId, input.tenantId),
      eq(providerModels.isActive, true),
      eq(providers.isActive, true),
    ))
    .limit(1);

  if (!modelRow) return fail("Provider model not found or inactive");

  const providerConfig: ProviderConfig = {
    providerType: modelRow.providerType,
    apiKeyRef: modelRow.apiKeyRef,
    baseUrl: modelRow.baseUrl,
    config: (modelRow.providerConfig as Record<string, unknown>) || {},
    modelId: modelRow.modelId,
    displayName: modelRow.displayName,
  };

  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    description: agent.description || "",
    systemPrompt: agent.systemPrompt,
    persona: (agent.persona as Record<string, string>) || {},
    rules: (agent.rules as Array<{ rule: string; priority?: number }>) || [],
    providerModelId: agent.providerModelId,
    temperature: agent.temperature || "0.7",
    maxTurns: agent.maxTurns || 25,
    maxTokensPerTurn: agent.maxTokensPerTurn || getConfigSync().DEFAULT_MAX_TOKENS_PER_TURN,
  };

  return {
    agentConfig,
    providerConfig,
    modelRow,
    agent: { providerModelId: agent.providerModelId, modelConfig: agent.modelConfig },
  };
}

// ---------------------------------------------------------------------------
// Step 2: Prepare session (create/resume, validate input, build prompt)
// ---------------------------------------------------------------------------

async function prepareSession(
  input: SessionInput,
  agentConfig: AgentConfig,
  modelRow: LoadedAgentAndProvider["modelRow"],
  agentModelConfig: unknown,
): Promise<PreparedSession | SessionResult> {
  const db = getDb();

  let sessionId = input.sessionId || "";

  if (!sessionId) {
    const [session] = await db
      .insert(agentSessions)
      .values({
        tenantId: input.tenantId,
        agentId: input.agentId,
        channel: input.channel || "studio",
        status: "running",
        modelUsed: modelRow.modelId,
        providerUsed: modelRow.providerType,
        triggeredBy: input.channel === "api" || input.channel === "sub_agent" || !input.userId ? null : input.userId,
        startedAt: new Date(),
        input: input.metadata || {},
      })
      .returning({ id: agentSessions.id });
    sessionId = session.id;
  } else {
    await db
      .update(agentSessions)
      .set({ status: "running" })
      .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.tenantId, input.tenantId)));
  }

  const metaRecord = input.metadata as Record<string, unknown> | undefined;
  const workflowRunId = metaRecord?.workflowRunId as string | undefined;
  const parentSpanId = metaRecord?.parentSpanId as string | undefined;
  const projectId = metaRecord?.projectId as string | undefined;
  const isSubAgent = metaRecord?.isSubAgent as boolean | undefined;

  const sanitized = sanitizeInput(input.message);
  const injection = detectPromptInjection(sanitized);
  if (injection.suspicious && injection.maxSeverity === "block") {
    await db
      .update(agentSessions)
      .set({ status: "failed", errorMessage: "Message blocked by security policy" })
      .where(eq(agentSessions.id, sessionId));
    return { sessionId, response: "", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, status: "failed", error: "Message blocked by security policy" };
  }

  await db.insert(agentSessionMessages).values({
    tenantId: input.tenantId,
    agentSessionId: sessionId,
    role: "user",
    content: sanitized,
  });

  const { definitions: toolDefs, mcpConnectorMap, workspaceConfig: rawWorkspaceConfig } = await loadToolDefinitions(input.agentId, input.tenantId, sessionId, workflowRunId, isSubAgent);
  const workspaceConfig = rawWorkspaceConfig
    ? { ...rawWorkspaceConfig, projectId, execTimeoutMs: (agentConfig as unknown as Record<string, unknown>).execTimeoutMs as number | undefined }
    : null;
  const timezone = (agentModelConfig as Record<string, unknown>)?.timezone as string || "UTC";
  const systemPrompt = buildSystemPrompt(agentConfig, { timezone });
  const loopDetector = createLoopDetector();
  const toolContext: ToolContext = { agentId: input.agentId, tenantId: input.tenantId, sessionId };

  const pricing = getModelPricing(
    modelRow.providerType,
    modelRow.modelId,
    modelRow.costPerInputToken,
    modelRow.costPerOutputToken,
  );

  const traceId = workflowRunId || sessionId;
  const agentSpan = progressBus.emit({
    traceId, parentId: parentSpanId || null, tenantId: input.tenantId,
    spanKind: "agent", phase: "start", name: agentConfig.name,
    message: `Agent session started`,
    agentId: input.agentId, agentName: agentConfig.name, sessionId, modelId: modelRow.modelId,
  });

  return {
    sessionId,
    systemPrompt,
    toolDefs,
    mcpConnectorMap,
    workspaceConfig,
    loopDetector,
    toolContext,
    pricing,
    traceId,
    agentSpan,
    workflowRunId,
    parentSpanId,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Execute tool loop (main LLM call + tool execution rounds)
// ---------------------------------------------------------------------------

async function executeToolLoop(
  input: SessionInput,
  sessionId: string,
  agentConfig: AgentConfig,
  providerConfig: ProviderConfig,
  modelRow: LoadedAgentAndProvider["modelRow"],
  agent: LoadedAgentAndProvider["agent"],
  systemPrompt: string,
  toolDefs: PreparedSession["toolDefs"],
  mcpConnectorMap: PreparedSession["mcpConnectorMap"],
  workspaceConfig: PreparedSession["workspaceConfig"],
  loopDetector: PreparedSession["loopDetector"],
  toolContext: ToolContext,
  pricing: PreparedSession["pricing"],
  traceId: string,
  agentSpan: ReturnType<typeof progressBus.emit>,
): Promise<ToolLoopTotals> {
  const db = getDb();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalToolCalls = 0;
  let totalCost = 0;
  let finalText = "";

  // Heartbeat: update last_heartbeat_at every 30s so recovery sweep knows we're alive
  const heartbeatInterval = setInterval(async () => {
    try {
      await db.update(agentSessions).set({ lastHeartbeatAt: new Date() }).where(eq(agentSessions.id, sessionId));
    } catch { /* non-fatal */ }
  }, 30_000);
  // Initial heartbeat immediately
  await db.update(agentSessions).set({ lastHeartbeatAt: new Date() }).where(eq(agentSessions.id, sessionId));

  const skipCompaction = ["sub_agent", "workflow", "cron"].includes(input.channel || "");
  for (let round = 0; round < getConfigSync().MAX_TOOL_ROUNDS; round++) {
    if (agent.providerModelId && !skipCompaction) {
      await checkAndCompact(sessionId, input.tenantId, agent.providerModelId, providerConfig);
    }

    const history = await db
      .select({
        role: agentSessionMessages.role,
        content: agentSessionMessages.content,
        toolCalls: agentSessionMessages.toolCalls,
        toolCallId: agentSessionMessages.toolCallId,
      })
      .from(agentSessionMessages)
      .where(and(eq(agentSessionMessages.agentSessionId, sessionId), eq(agentSessionMessages.tenantId, input.tenantId)))
      .orderBy(asc(agentSessionMessages.createdAt));

    const messages = history.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId || undefined };
      }
      if (m.role === "assistant" && m.toolCalls) {
        const blocks = m.toolCalls as ToolCallBlock[];
        const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
        const toolCalls = blocks
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: b.id || "", function: { name: b.name || "", arguments: JSON.stringify(b.input || {}) } }));
        return {
          role: "assistant" as const,
          content: textParts || m.content,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
      }
      return {
        role: m.role as "user" | "assistant",
        content: m.content,
      };
    });

    const llmStartSpan = progressBus.emit({
      traceId, parentId: agentSpan.id, tenantId: input.tenantId,
      spanKind: "llm", phase: "start", name: modelRow.modelId,
      message: `Round ${round + 1}`,
      agentId: input.agentId, agentName: agentConfig.name, sessionId, modelId: modelRow.modelId,
    });
    const llmCallStart = Date.now();

    const response = await callLLM(providerConfig, systemPrompt, messages, {
      temperature: parseFloat(agentConfig.temperature),
      maxTokens: agentConfig.maxTokensPerTurn,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      onDelta: (delta) => textDeltaBus.emit(traceId, input.tenantId, delta),
    });

    totalInputTokens += response.inputTokens;
    totalOutputTokens += response.outputTokens;

    const roundCost = calculateCost(pricing, response.inputTokens, response.outputTokens);
    totalCost += roundCost;

    const { preview: respPreview, len: respLen } = truncatePreview(response.text);
    progressBus.emit({
      traceId, parentId: agentSpan.id, tenantId: input.tenantId,
      spanKind: "llm", phase: "complete", name: modelRow.modelId,
      message: response.stopReason === "tool_use" ? `Tool use requested (${response.toolCalls.length} calls)` : "Response complete",
      durationMs: Date.now() - llmCallStart,
      tokens: response.inputTokens + response.outputTokens,
      inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: roundCost,
      resultPreview: respPreview, resultLen: respLen,
      agentId: input.agentId, agentName: agentConfig.name, sessionId, modelId: modelRow.modelId,
    });

    await db.insert(usageRecords).values({
      tenantId: input.tenantId,
      userId: input.userId || null,
      agentId: input.agentId,
      agentSessionId: sessionId,
      providerModelId: modelRow.providerModelId,
      model: modelRow.modelId,
      provider: modelRow.providerType,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: roundCost.toFixed(6),
      requestType: "chat",
    });

    if (response.toolCalls.length > 0) {
      const toolCallBlocks: ToolCallBlock[] = [];
      if (response.text) {
        toolCallBlocks.push({ type: "text", text: response.text });
      }
      for (const tc of response.toolCalls) {
        toolCallBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }

      await db.insert(agentSessionMessages).values({
        tenantId: input.tenantId,
        agentSessionId: sessionId,
        role: "assistant",
        content: response.text || "",
        toolCalls: toolCallBlocks,
      });

      for (const tc of response.toolCalls) {
        totalToolCalls++;
        const { preview: argsP, len: argsL } = truncatePreview(tc.input);
        progressBus.emit({
          traceId, parentId: llmStartSpan.id, tenantId: input.tenantId,
          spanKind: "tool", phase: "start", name: tc.name,
          toolName: tc.name, argsPreview: argsP, argsLen: argsL,
          agentId: input.agentId, agentName: agentConfig.name, sessionId,
        });
        const toolStart = Date.now();

        const toolResult = await executeTool(
          { id: tc.id, name: tc.name, input: tc.input } as ToolCall,
          input.tenantId,
          sessionId,
          loopDetector,
          toolContext,
          mcpConnectorMap,
          workspaceConfig,
        );

        const toolDuration = Date.now() - toolStart;
        const { preview: resP, len: resL } = truncatePreview(toolResult.content);
        progressBus.emit({
          traceId, parentId: llmStartSpan.id, tenantId: input.tenantId,
          spanKind: "tool", phase: toolResult.is_error ? "error" : "complete",
          name: tc.name, toolName: tc.name,
          message: toolResult.is_error ? toolResult.content.slice(0, 200) : undefined,
          durationMs: toolDuration, resultPreview: resP, resultLen: resL,
          agentId: input.agentId, agentName: agentConfig.name, sessionId,
        });

        await db.insert(agentSessionMessages).values({
          tenantId: input.tenantId,
          agentSessionId: sessionId,
          role: "tool",
          content: toolResult.content,
          toolCallId: tc.id,
        });
      }

      continue;
    }

    finalText = response.text;
    await db.insert(agentSessionMessages).values({
      tenantId: input.tenantId,
      agentSessionId: sessionId,
      role: "assistant",
      content: response.text,
    });
    break;
  }

  clearInterval(heartbeatInterval);
  return { totalInputTokens, totalOutputTokens, totalToolCalls, totalCost, finalText };
}

// ---------------------------------------------------------------------------
// Step 4: Finalize session (update totals, set status, emit end span)
// ---------------------------------------------------------------------------

async function finalizeSession(
  sessionId: string,
  input: SessionInput,
  agentConfig: AgentConfig,
  traceId: string,
  parentSpanId: string | undefined,
  agentSpan: ReturnType<typeof progressBus.emit>,
  totals: ToolLoopTotals,
): Promise<SessionResult> {
  const db = getDb();

  const [currentStatus] = await db
    .select({ status: agentSessions.status })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1);

  const oneShotChannels = ["sub_agent", "workflow", "cron"];
  const isOneShot = oneShotChannels.includes(input.channel || "");
  const nextStatus = currentStatus?.status === "waiting_approval"
    ? "waiting_approval"
    : isOneShot ? "completed" : "waiting";

  const updates: Record<string, unknown> = {
    status: nextStatus,
    totalInputTokens: sql`${agentSessions.totalInputTokens} + ${totals.totalInputTokens}`,
    totalOutputTokens: sql`${agentSessions.totalOutputTokens} + ${totals.totalOutputTokens}`,
    totalTurns: sql`${agentSessions.totalTurns} + 1`,
    totalToolCalls: sql`${agentSessions.totalToolCalls} + ${totals.totalToolCalls}`,
    totalCostUsd: sql`${agentSessions.totalCostUsd} + ${totals.totalCost.toFixed(6)}::numeric`,
  };
  if (isOneShot) {
    updates.completedAt = new Date();
  }

  await db
    .update(agentSessions)
    .set(updates)
    .where(eq(agentSessions.id, sessionId));

  progressBus.emit({
    traceId, parentId: parentSpanId || null, tenantId: input.tenantId,
    spanKind: "agent", phase: "complete", name: agentConfig.name,
    message: `Completed — ${totals.totalToolCalls} tool calls`,
    durationMs: Date.now() - agentSpan.timestamp,
    tokens: totals.totalInputTokens + totals.totalOutputTokens,
    inputTokens: totals.totalInputTokens, outputTokens: totals.totalOutputTokens, costUsd: totals.totalCost,
    agentId: input.agentId, agentName: agentConfig.name, sessionId,
  });

  return {
    sessionId,
    response: totals.finalText,
    usage: { inputTokens: totals.totalInputTokens, outputTokens: totals.totalOutputTokens, costUsd: totals.totalCost },
    status: isOneShot ? "completed" : "waiting",
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runSession(input: SessionInput): Promise<SessionResult> {
  const loadResult = await loadAgentAndProvider(input);
  if ("status" in loadResult && loadResult.status === "failed") return loadResult as SessionResult;

  const { agentConfig, providerConfig, modelRow, agent } = loadResult as LoadedAgentAndProvider;

  const prepareResult = await prepareSession(input, agentConfig, modelRow, agent.modelConfig);
  if ("status" in prepareResult && prepareResult.status === "failed") return prepareResult as SessionResult;

  const {
    sessionId, systemPrompt, toolDefs, mcpConnectorMap, workspaceConfig,
    loopDetector, toolContext, pricing, traceId, agentSpan, workflowRunId, parentSpanId,
  } = prepareResult as PreparedSession;

  try {
    const totals = await executeToolLoop(
      input, sessionId, agentConfig, providerConfig, modelRow, agent,
      systemPrompt, toolDefs, mcpConnectorMap, workspaceConfig,
      loopDetector, toolContext, pricing, traceId, agentSpan,
    );

    return await finalizeSession(sessionId, input, agentConfig, traceId, parentSpanId, agentSpan, totals);
  } catch (e) {
    const db = getDb();
    const errorMsg = (e as Error).message || "Unknown error";
    await db
      .update(agentSessions)
      .set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(agentSessions.id, sessionId));

    progressBus.emit({
      traceId: workflowRunId || sessionId, parentId: parentSpanId || null, tenantId: input.tenantId,
      spanKind: "agent", phase: "error", name: agentConfig.name,
      message: errorMsg.slice(0, 500),
      agentId: input.agentId, agentName: agentConfig.name, sessionId,
    });

    return { sessionId, response: "", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, status: "failed", error: errorMsg };
  }
}

function fail(error: string): SessionResult {
  return { sessionId: "", response: "", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, status: "failed", error };
}
