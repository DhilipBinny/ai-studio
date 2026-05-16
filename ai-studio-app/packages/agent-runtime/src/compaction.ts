import { getDb } from "@ais-app/database";
import { agentSessionMessages, providerModels } from "@ais-app/database";
import { eq, and, asc, lt } from "drizzle-orm";
import { createProvider } from "./provider-factory";
import type { ProviderConfig } from "./types";

const COMPACTION_THRESHOLD = 0.75;
const KEEP_RECENT_MESSAGES = 6;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface SessionMessage {
  id: number;
  role: string;
  content: string;
  toolCalls: unknown;
  createdAt: Date;
}

export interface CompactionResult {
  compacted: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
  messagesBefore?: number;
  messagesAfter?: number;
}

export async function checkAndCompact(
  sessionId: string,
  tenantId: string,
  providerModelId: string,
  providerConfig: ProviderConfig,
): Promise<CompactionResult> {
  const db = getDb();

  const [model] = await db
    .select({ contextWindow: providerModels.contextWindow })
    .from(providerModels)
    .where(eq(providerModels.id, providerModelId))
    .limit(1);

  const contextWindow = model?.contextWindow || 128000;
  const threshold = contextWindow * COMPACTION_THRESHOLD;

  const messages = await db
    .select({
      id: agentSessionMessages.id,
      role: agentSessionMessages.role,
      content: agentSessionMessages.content,
      toolCalls: agentSessionMessages.toolCalls,
      createdAt: agentSessionMessages.createdAt,
    })
    .from(agentSessionMessages)
    .where(and(eq(agentSessionMessages.agentSessionId, sessionId), eq(agentSessionMessages.tenantId, tenantId)))
    .orderBy(asc(agentSessionMessages.createdAt));

  let totalTokens = 0;
  for (const m of messages) {
    totalTokens += estimateTokens(m.content || "");
    if (m.toolCalls) totalTokens += estimateTokens(JSON.stringify(m.toolCalls));
  }

  if (totalTokens < threshold || messages.length <= KEEP_RECENT_MESSAGES + 2) {
    return { compacted: false };
  }

  const olderMessages = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
  const recentMessages = messages.slice(messages.length - KEEP_RECENT_MESSAGES);

  const conversationLines: string[] = [];
  for (const m of olderMessages) {
    const role = m.role.charAt(0).toUpperCase() + m.role.slice(1);
    if (m.content.trim()) {
      conversationLines.push(`[${role}]: ${m.content.slice(0, 1000)}`);
    }
  }

  const summaryPrompt = `Summarize this conversation concisely. Focus on: what was discussed, key decisions made, facts mentioned, and what the user is working on. Keep under 1500 characters.

<conversation>
${conversationLines.join("\n")}
</conversation>`;

  try {
    const provider = createProvider(providerConfig);
    const response = await provider.chat({
      messages: [{ role: "user" as const, content: summaryPrompt }],
      model: providerConfig.modelId,
      systemPrompt: { cached: "You are a conversation summarizer. Be factual and concise.", dynamic: "" },
    });

    if (!response.text) return { compacted: false };

    const oldestRecentId = recentMessages[0].id;
    await db.transaction(async (tx) => {
      await tx
        .delete(agentSessionMessages)
        .where(
          and(
            eq(agentSessionMessages.agentSessionId, sessionId),
            eq(agentSessionMessages.tenantId, tenantId),
            lt(agentSessionMessages.id, oldestRecentId),
          ),
        );

      await tx.insert(agentSessionMessages).values({
        tenantId,
        agentSessionId: sessionId,
        role: "system",
        content: `[Context Summary]\n${response.text}`,
        metadata: { compacted: true, originalMessageCount: olderMessages.length },
      });
    });

    const newMessages = await db
      .select({ content: agentSessionMessages.content, toolCalls: agentSessionMessages.toolCalls })
      .from(agentSessionMessages)
      .where(eq(agentSessionMessages.agentSessionId, sessionId));

    let tokensAfter = 0;
    for (const m of newMessages) {
      tokensAfter += estimateTokens(m.content || "");
      if (m.toolCalls) tokensAfter += estimateTokens(JSON.stringify(m.toolCalls));
    }

    return {
      compacted: true,
      tokensBefore: totalTokens,
      tokensAfter,
      messagesBefore: messages.length,
      messagesAfter: newMessages.length,
    };
  } catch {
    return { compacted: false };
  }
}
