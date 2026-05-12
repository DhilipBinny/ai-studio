/**
 * Message utilities — pure functions for building and normalizing
 * conversation messages. No DB or provider dependencies.
 */

import type { Message, MessageContentPart, ToolCall } from '@ais/types';
import type { AgwLogger } from '@ais/types';
import { noopLogger } from '@ais/types';

// ── Logger (module-level setter, like other extracted packages) ──
let log: AgwLogger = noopLogger;

export function setMessagesLogger(logger: AgwLogger): void {
  log = logger;
}

/**
 * Build user content: plain text or multimodal (text + images).
 * When the model doesn't support vision, appends a note to the text.
 */
export function buildUserContent(
  text: string,
  images: Array<{ data: string; mimeType: string }> | undefined,
  supportsVision: boolean,
  sniffMime?: (base64: string) => { mime: string } | null,
): string | MessageContentPart[] {
  if (!images || images.length === 0) return text;
  if (supportsVision) {
    const parts: MessageContentPart[] = [];
    for (const img of images) {
      const sniffed = sniffMime?.(img.data);
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: sniffed?.mime || img.mimeType, data: img.data },
      });
    }
    parts.push({ type: 'text', text });
    return parts;
  }
  return text +
    '\n\n[Note: Images were sent but the current model does not support vision. Please switch to a vision-capable model like Claude or GPT-4o.]';
}

/**
 * Normalize a message array: filter empty text-only messages and
 * merge consecutive same-role user messages (plain text only).
 */
export function normalizeMessages(
  history: Message[],
  userContent: string | MessageContentPart[],
): Message[] {
  const raw: Message[] = [...history, { role: 'user', content: userContent }];
  const result: Message[] = [];
  for (const msg of raw) {
    if (typeof msg.content === 'string' && !msg.content.trim() && !msg.tool_calls?.length) continue;
    const last = result[result.length - 1];
    if (last && last.role === msg.role && msg.role === 'user' &&
        typeof last.content === 'string' && typeof msg.content === 'string') {
      last.content = last.content + '\n' + msg.content;
    } else {
      result.push({ ...msg });
    }
  }
  return result;
}

/**
 * Render a tool result (string, envelope, or legacy object) into a
 * single string suitable for the LLM's tool-result message content.
 */
export function renderToolResultForLLM(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return JSON.stringify(result);
  }

  const obj = result as Record<string, unknown>;
  const content = obj.content;
  if (!Array.isArray(content)) return JSON.stringify(result);

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const type = b.type;
    if (type === 'text' && typeof b.text === 'string') {
      parts.push(b.text);
    } else if (type === 'image' && b.source && typeof b.source === 'object') {
      parts.push(`[${(b.source as { media_type?: string }).media_type || 'image'} image]`);
    } else if (type === 'resource_link') {
      parts.push(`[link: ${b.title || b.uri || 'resource'}]`);
    } else if (type === 'persisted_reference') {
      parts.push(`[persisted ${b.sizeBytes ?? 0} bytes at ${b.path ?? ''}]\n${b.preview ?? ''}`);
    } else {
      parts.push(JSON.stringify(block));
    }
  }

  if (parts.length === 0) return JSON.stringify(result);
  return parts.join('\n');
}

/** Strip base64 image data from messages to keep debug logs small. */
export function sanitizeMessagesForLog(messages: Message[]): unknown[] {
  return messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    return {
      ...m,
      content: (m.content as MessageContentPart[]).map(p =>
        p.type === 'image'
          ? { type: 'image', source: { type: 'base64', media_type: (p.source as { media_type?: string })?.media_type, data: '[omitted]' } }
          : p,
      ),
    };
  });
}

/** Convert a DB message row to the Message format used by providers. */
export function rowToMessage(row: {
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
}): Message {
  const msg: Message = {
    role: row.role as Message['role'],
    content: row.content,
  };
  if (row.tool_calls) {
    try {
      msg.tool_calls = JSON.parse(row.tool_calls) as ToolCall[];
    } catch (e) { log.debug({ err: e instanceof Error ? e.message : String(e) }, 'Skipped malformed tool_calls JSON in rowToMessage'); }
  }
  if (row.tool_call_id) {
    msg.tool_call_id = row.tool_call_id;
  }
  return msg;
}
