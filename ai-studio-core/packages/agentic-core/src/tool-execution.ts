/**
 * Tool execution orchestration — parallel/sequential strategy with
 * budget caps, loop detection, and media collection.
 *
 * Injectable: no DB imports, no concrete repositories.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
  Message,
  ToolCall,
  MediaAttachment,
  AgentCallbacks,
} from '@ais/types';
import type { AgwLogger, noopLogger } from '@ais/types';
import { renderToolResultForLLM } from './messages';

/** Injected recorder for tool call persistence. */
export interface ToolCallRecorder {
  record(entry: {
    id: string;
    sessionId: string;
    tenantId: string;
    userId?: string;
    toolName: string;
    arguments: Record<string, unknown>;
    result: unknown;
    status: string;
    durationMs: number;
  }): Promise<void>;
}

/** Parsed tool call ready for execution. */
export interface ParsedToolCall {
  tc: ToolCall;
  toolName: string;
  toolArgs: Record<string, unknown>;
  skipped?: string;
}

/** Context needed by tool execution. */
export interface ToolExecContext {
  sessionId: string;
  tenantId: string;
  userId?: string;
  executeTool?: (name: string, args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
  isToolConcurrencySafe?: (name: string) => boolean;
  toolExecExtra?: Record<string, unknown>;
  toolCallRecorder?: ToolCallRecorder;
  callbacks?: AgentCallbacks;
  logger: AgwLogger;
  maxToolResultChars: number;
  maxTotalToolResults: number;
  toolLoopThreshold: number;
}

/** Execute a single tool call. Returns the tool result message content. */
export async function executeSingleTool(
  p: ParsedToolCall,
  ctx: ToolExecContext,
  collectedMedia: MediaAttachment[],
  toolCallCounts: Map<string, number>,
): Promise<{ toolCallId: string; content: string }> {
  if (p.skipped) return { toolCallId: p.tc.id, content: p.skipped };

  if (ctx.callbacks?.onToolStart) {
    try { ctx.callbacks.onToolStart(p.toolName, p.toolArgs); } catch { /* ignore */ }
  }

  const toolStartTime = Date.now();
  let result: unknown;
  let toolStatus = 'success';

  try {
    if (ctx.executeTool) {
      result = await ctx.executeTool(p.toolName, p.toolArgs, ctx.toolExecExtra ?? {});
    } else {
      result = { error: 'No tool executor configured' };
      toolStatus = 'error';
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    ctx.logger.error({ tool: p.toolName, err: errMsg, category: 'tool' }, 'Tool execution failed');
    result = { error: `Tool execution failed: ${errMsg}` };
    toolStatus = 'error';
  }

  const durationMs = Date.now() - toolStartTime;

  if (ctx.toolCallRecorder) {
    try {
      await ctx.toolCallRecorder.record({
        id: p.tc.id || crypto.randomUUID(),
        sessionId: ctx.sessionId, tenantId: ctx.tenantId,
        userId: ctx.userId, toolName: p.toolName,
        arguments: p.toolArgs, result, status: toolStatus, durationMs,
      });
    } catch (e: unknown) {
      ctx.logger.warn({ err: e instanceof Error ? e.message : String(e), tool: p.toolName }, 'Failed to record tool call (non-critical)');
    }
  }

  // Collect _media attachments
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultObj = result as Record<string, unknown>;
    const mediaArr = resultObj._media;
    if (Array.isArray(mediaArr)) {
      for (const item of mediaArr) {
        if (!item || typeof item !== 'object') continue;
        const m = item as Record<string, unknown>;
        if (typeof m.filePath === 'string' && typeof m.fileName === 'string' &&
            typeof m.mimeType === 'string' && typeof m.type === 'string' && fs.existsSync(m.filePath)) {
          const attachment = item as MediaAttachment;
          collectedMedia.push(attachment);
          if (ctx.callbacks?.onMedia) {
            try { ctx.callbacks.onMedia(attachment); } catch { /* ignore */ }
          }
        }
      }
      delete resultObj._media;
    }
  }

  const resultStr = renderToolResultForLLM(result);
  ctx.logger.info({ tool: p.toolName, resultPreview: resultStr.slice(0, 200), resultLen: resultStr.length, durationMs, category: 'tool' }, 'Tool completed');

  if (ctx.callbacks?.onToolEnd) {
    try { ctx.callbacks.onToolEnd(p.toolName, resultStr.slice(0, 500)); } catch { /* ignore */ }
  }

  let cappedResult = resultStr;
  if (cappedResult.length > ctx.maxToolResultChars) {
    cappedResult = cappedResult.slice(0, ctx.maxToolResultChars) +
      `\n\n[... truncated ${resultStr.length - ctx.maxToolResultChars} chars. Ask the user to narrow the query if more detail is needed.]`;
  }

  return { toolCallId: p.tc.id, content: `<tool_result name="${p.toolName}">\n${cappedResult}\n</tool_result>` };
}

/**
 * Parse tool calls from LLM response, apply loop detection,
 * and execute with parallel/sequential concurrency strategy.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  messages: Message[],
  collectedMedia: MediaAttachment[],
  toolCallCounts: Map<string, number>,
  ctx: ToolExecContext,
): Promise<void> {
  let totalToolResultSize = 0;

  // Parse and check for loops
  const parsed: ParsedToolCall[] = [];
  for (const tc of toolCalls) {
    const toolName = tc.function?.name || 'unknown';
    let toolArgs: Record<string, unknown>;
    try {
      toolArgs = JSON.parse(tc.function?.arguments || '{}') as Record<string, unknown>;
    } catch (e) {
      ctx.logger.warn({ tool: toolName, err: e instanceof Error ? e.message : String(e) }, 'Invalid tool arguments JSON');
      toolArgs = {};
    }
    if (typeof toolArgs !== 'object' || toolArgs === null) toolArgs = {};

    const argSummary = Object.entries(toolArgs).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
    ctx.logger.info({ tool: toolName, args: argSummary, category: 'tool' }, 'Tool called');

    const toolHash = `${toolName}:${JSON.stringify(toolArgs).slice(0, 100)}`;
    const callCount = (toolCallCounts.get(toolHash) ?? 0) + 1;
    toolCallCounts.set(toolHash, callCount);
    if (callCount > ctx.toolLoopThreshold) {
      ctx.logger.warn({ tool: toolName, callCount, threshold: ctx.toolLoopThreshold }, 'Tool loop detected — skipping execution');
      parsed.push({ tc, toolName, toolArgs, skipped: `[Tool loop detected: "${toolName}" called ${callCount} times with similar arguments. Try a different approach or tool.]` });
    } else {
      parsed.push({ tc, toolName, toolArgs });
    }
  }

  // Execute with concurrency strategy
  const isSafe = (name: string) => ctx.isToolConcurrencySafe?.(name) ?? false;
  let i = 0;
  while (i < parsed.length) {
    if (!parsed[i].skipped && isSafe(parsed[i].toolName)) {
      const batch: ParsedToolCall[] = [];
      while (i < parsed.length && (parsed[i].skipped || isSafe(parsed[i].toolName))) {
        batch.push(parsed[i]);
        i++;
      }
      if (batch.length > 1) {
        ctx.logger.info({ tools: batch.map(b => b.toolName), count: batch.length, category: 'tool' }, 'Executing tools in parallel');
      }
      const results = await Promise.all(batch.map(p => executeSingleTool(p, ctx, collectedMedia, toolCallCounts)));
      for (const r of results) {
        if (totalToolResultSize + r.content.length > ctx.maxTotalToolResults) {
          r.content = `[Result omitted — total tool output budget (${ctx.maxTotalToolResults / 1000}KB) exceeded this round. Summarize what you have so far and ask the user if they need more.]`;
        }
        totalToolResultSize += r.content.length;
        messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      }
    } else {
      const r = await executeSingleTool(parsed[i], ctx, collectedMedia, toolCallCounts);
      if (totalToolResultSize + r.content.length > ctx.maxTotalToolResults) {
        r.content = `[Result omitted — total tool output budget (${ctx.maxTotalToolResults / 1000}KB) exceeded this round. Summarize what you have so far and ask the user if they need more.]`;
      }
      totalToolResultSize += r.content.length;
      messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
      i++;
    }
  }
}
