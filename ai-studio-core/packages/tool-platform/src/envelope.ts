/**
 * Tool-result envelope helpers.
 *
 * Shared builders used by builtin tools to return the Phase 6
 * content-block envelope shape. Every tool should funnel its success
 * return through one of these so the registry can run persistence,
 * budget accounting, and envelope rendering uniformly.
 *
 * Error-shaped returns (`{ error: string }`) stay as legacy — the
 * registry passes them through unchanged and the agent loop renders
 * them via `JSON.stringify` fallback, which surfaces a clean
 * `{"error":"..."}` that the LLM can read.
 */

import type { ContentBlock, ToolResultEnvelope } from '@ais/types';

/**
 * Build a single-text-block envelope. The most common shape — use this
 * for any tool whose output is naturally a string.
 */
export function textEnvelope(text: string): ToolResultEnvelope {
  return { content: [{ type: 'text', text }] };
}

/**
 * Build a single-image-block envelope. Used by tools that return a
 * screenshot / generated image / inspected media. `data` is base64,
 * url, or a filesystem path depending on `kind`.
 */
export function imageEnvelope(
  mediaType: string,
  data: string,
  kind: 'base64' | 'url' | 'path' = 'base64',
): ToolResultEnvelope {
  return {
    content: [{ type: 'image', source: { kind, media_type: mediaType, data } }],
  };
}

/**
 * Build an envelope from an arbitrary block list. Use when a tool
 * produces multiple mixed content types (e.g. a browse screenshot
 * plus the page snapshot text).
 */
export function envelope(blocks: ContentBlock[]): ToolResultEnvelope {
  return { content: blocks };
}
