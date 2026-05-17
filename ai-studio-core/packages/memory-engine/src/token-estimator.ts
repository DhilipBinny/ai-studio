/**
 * Token estimation — pure functions extracted from compaction.ts.
 *
 * Content-aware heuristic that detects code/JSON density for more
 * accurate estimates without requiring a tokenizer dependency.
 */

import type { AgwLogger } from '@ais/types';
import { noopLogger } from '@ais/types';

/**
 * Minimal message shape needed by estimateMessageTokens.
 * Intentionally narrow — callers can pass any object that has these fields.
 */
export interface TokenEstimatorMessage {
  content: string;
  tool_calls?: string | null;
}

// ── Logger (module-level setter) ──
let log: AgwLogger = noopLogger;

export function setTokenEstimatorLogger(logger: AgwLogger): void {
  log = logger;
}

/**
 * Estimate token count from text using a content-aware heuristic.
 *
 * Code/JSON-heavy content averages ~3.2 chars/token while plain English
 * averages ~3.8 chars/token. We detect code density via punctuation ratio.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const s = String(text);
  // Detect code/JSON density by counting structural punctuation
  const codeChars = (s.match(/[{}[\]();:=<>/\\]/g) || []).length;
  const codeRatio = codeChars / s.length;
  const charsPerToken = codeRatio > 0.05 ? 3.2 : 3.8;
  return Math.ceil(s.length / charsPerToken);
}

/** Estimate total tokens across an array of message rows. */
export function estimateMessageTokens(messages: TokenEstimatorMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    total += estimateTokens(content) + 4; // +4 for message role/formatting overhead
    if (msg.tool_calls) {
      try {
        const toolCalls = JSON.parse(msg.tool_calls) as Array<{
          function?: { name?: string; arguments?: string };
        }>;
        for (const tc of toolCalls) {
          total += estimateTokens(tc.function?.arguments ?? '');
          total += estimateTokens(tc.function?.name ?? '');
        }
      } catch (e) {
        log.debug({ err: e instanceof Error ? e.message : String(e) }, 'Malformed tool_calls JSON in token estimation, counting raw string');
        total += estimateTokens(msg.tool_calls);
      }
    }
  }
  return total;
}
