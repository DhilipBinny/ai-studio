import { getDb } from "@ais-app/database";
import { agents, agentSessions, agentSessionMessages, providers, providerModels } from "@ais-app/database";
import { eq, and, asc } from "drizzle-orm";
import { buildSystemPrompt } from "./prompt-builder";
import { callLLM } from "./llm-caller";
import { loadToolDefinitions, executeTool, createLoopDetector } from "./tool-executor";
import { checkAndCompact } from "./compaction";
import { sanitizeInput, detectPromptInjection } from "@ais/security";
import type { SessionInput, SessionResult, AgentConfig, ProviderConfig } from "./types";
import type { ToolCall, ToolContext } from "./tool-executor";

const MAX_TOOL_ROUNDS = 10;

interface ToolCallBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

export async function runSession(input: SessionInput): Promise<SessionResult> {
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
      modelId: providerModels.modelId,
      displayName: providerModels.displayName,
      providerType: providers.providerType,
      apiKeyRef: providers.apiKeyRef,
      baseUrl: providers.baseUrl,
      providerConfig: providers.config,
    })
    .from(providerModels)
    .innerJoin(providers, eq(providerModels.providerId, providers.id))
    .where(and(
      eq(providerModels.id, agent.providerModelId),
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
    maxTokensPerTurn: agent.maxTokensPerTurn || 4096,
  };

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
        triggeredBy: input.channel === "api" ? null : input.userId,
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

  try {
    const sanitized = sanitizeInput(input.message);
    const injection = detectPromptInjection(sanitized);
    if (injection.suspicious && injection.maxSeverity === "block") {
      await db
        .update(agentSessions)
        .set({ status: "failed", errorMessage: "Message blocked by security policy" })
        .where(eq(agentSessions.id, sessionId));
      return { sessionId, response: "", usage: { inputTokens: 0, outputTokens: 0 }, status: "failed", error: "Message blocked by security policy" };
    }

    await db.insert(agentSessionMessages).values({
      tenantId: input.tenantId,
      agentSessionId: sessionId,
      role: "user",
      content: sanitized,
    });

    const toolDefs = await loadToolDefinitions(input.agentId, input.tenantId);
    const systemPrompt = buildSystemPrompt(agentConfig, { timezone: "Asia/Singapore" });
    const loopDetector = createLoopDetector();
    const toolContext: ToolContext = { agentId: input.agentId, tenantId: input.tenantId, sessionId };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalToolCalls = 0;
    let finalText = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (agent.providerModelId) {
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
        .where(eq(agentSessionMessages.agentSessionId, sessionId))
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

      const response = await callLLM(providerConfig, systemPrompt, messages, {
        temperature: parseFloat(agentConfig.temperature),
        maxTokens: agentConfig.maxTokensPerTurn,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
      });

      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;

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
          const toolResult = await executeTool(
            { id: tc.id, name: tc.name, input: tc.input } as ToolCall,
            input.tenantId,
            sessionId,
            loopDetector,
            toolContext,
          );

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

    const [current] = await db
      .select({
        inputTokens: agentSessions.totalInputTokens,
        outputTokens: agentSessions.totalOutputTokens,
        turns: agentSessions.totalTurns,
        toolCallCount: agentSessions.totalToolCalls,
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    await db
      .update(agentSessions)
      .set({
        status: "waiting",
        totalInputTokens: (current?.inputTokens || 0) + totalInputTokens,
        totalOutputTokens: (current?.outputTokens || 0) + totalOutputTokens,
        totalTurns: (current?.turns || 0) + 1,
        totalToolCalls: (current?.toolCallCount || 0) + totalToolCalls,
      })
      .where(eq(agentSessions.id, sessionId));

    return {
      sessionId,
      response: finalText,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      status: "waiting",
    };
  } catch (e) {
    const errorMsg = (e as Error).message || "Unknown error";
    await db
      .update(agentSessions)
      .set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(agentSessions.id, sessionId));

    return { sessionId, response: "", usage: { inputTokens: 0, outputTokens: 0 }, status: "failed", error: errorMsg };
  }
}

function fail(error: string): SessionResult {
  return { sessionId: "", response: "", usage: { inputTokens: 0, outputTokens: 0 }, status: "failed", error };
}
