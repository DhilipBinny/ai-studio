/**
 * Tool-result persistence.
 *
 * When a tool's output is large enough to push the session's result
 * budget over its cap (or exceeds the tool's own `maxResultSizeChars`
 * threshold), the full output is written to disk and the agent sees a
 * `persisted_reference` content block instead — a short preview plus
 * the absolute path so a follow-up read can pull the full content when
 * actually needed.
 *
 * Files live at:
 *
 *   workspace/scopes/<scopeKey>/tool-results/<sessionId>/<toolUseId>.json
 *
 * GC is owned by session archival — when a session is archived, its
 * tool-result directory is removed via `cleanup()`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ContentBlock } from '@ais/types';

export interface ResultStorageOptions {
  /** Workspace root (e.g. `~/.agw/workspace`). */
  workspaceDir: string;
  /** Scope key for the current session, or `null` for unscoped. */
  scopeKey: string | null;
  /** Session ID — subdirectory under `tool-results/`. */
  sessionId: string;
  /**
   * Bytes above which the content is persisted to disk by default.
   * Individual tools can override via their `maxResultSizeChars`
   * registration field. Defaults to 16 KB.
   */
  defaultThresholdBytes?: number;
}

export const DEFAULT_PERSIST_THRESHOLD_BYTES = 16 * 1024;
export const PREVIEW_CHARS = 1024;

export class ResultStorage {
  private readonly dir: string;
  private readonly workspaceDir: string;
  private readonly defaultThreshold: number;

  constructor(opts: ResultStorageOptions) {
    const scopeSeg = opts.scopeKey ?? 'global';
    this.workspaceDir = opts.workspaceDir;
    this.dir = path.join(opts.workspaceDir, 'scopes', scopeSeg, 'tool-results', opts.sessionId);
    this.defaultThreshold = opts.defaultThresholdBytes ?? DEFAULT_PERSIST_THRESHOLD_BYTES;
    // Lazy-create the directory on first persist — no point making empty dirs
    // for sessions that never persist anything.
  }

  /**
   * Maybe persist the content to disk.
   *
   * If the content is under the threshold, returns `null` — the caller
   * should use the original content unchanged. If over, writes the full
   * content to a JSON file and returns a replacement content array
   * consisting of a single `persisted_reference` block with a preview.
   *
   * @param content Tool result content blocks
   * @param toolUseId Stable ID for this tool call (used as the filename)
   * @param thresholdBytes Per-call override of the default threshold; pass
   *                       `Infinity` to skip persistence unconditionally.
   */
  maybePersist(
    content: ContentBlock[],
    toolUseId: string,
    thresholdBytes?: number,
  ): ContentBlock[] | null {
    const threshold = thresholdBytes ?? this.defaultThreshold;
    if (!isFinite(threshold)) return null;

    const totalBytes = this.calculateBytes(content);
    if (totalBytes <= threshold) return null;

    // Ensure the dir exists right before writing
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      /* fallthrough — writeFile will error with a clearer message if needed */
    }

    const fileName = `${this.sanitiseId(toolUseId)}.json`;
    let filePath = path.join(this.dir, fileName);

    try {
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Collision — append a random suffix and retry
        const suffix = crypto.randomBytes(4).toString('hex');
        filePath = path.join(this.dir, `${this.sanitiseId(toolUseId)}.${suffix}.json`);
        fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
      } else {
        // On any other write failure, fall back to the unpersisted content —
        // we don't want persistence failures to break tool execution.
        return null;
      }
    }

    const preview = this.extractPreview(content, PREVIEW_CHARS);

    // Return a workspace-relative path so the LLM never sees the
    // server's absolute filesystem layout. The agent loop and any
    // re-read tool can resolve this against the same workspaceDir.
    const relativePath = path.relative(this.workspaceDir, filePath);

    return [
      {
        type: 'persisted_reference',
        path: relativePath,
        preview,
        sizeBytes: totalBytes,
      },
    ];
  }

  /**
   * Calculate the total byte size of a content-block array.
   *
   * Text blocks count as UTF-8 bytes. Image blocks count the base64
   * payload length (the LLM pays for the encoded form). Resource links
   * and persisted references count their serialised JSON.
   */
  calculateBytes(content: ContentBlock[]): number {
    let total = 0;
    for (const block of content) {
      if (block.type === 'text') {
        total += Buffer.byteLength(block.text, 'utf8');
      } else if (block.type === 'image') {
        total += Buffer.byteLength(block.source.data, 'utf8');
      } else if (block.type === 'resource_link') {
        total += Buffer.byteLength(JSON.stringify(block), 'utf8');
      } else if (block.type === 'persisted_reference') {
        // A persisted_reference is itself small — count its own JSON form.
        total += Buffer.byteLength(JSON.stringify(block), 'utf8');
      }
    }
    return total;
  }

  /**
   * Extract a text preview from a content-block array for the
   * `persisted_reference.preview` field.
   *
   * Concatenates the text of every `text` block and truncates to the
   * given number of characters. Images, resource links, and nested
   * references are summarised as `[image/jpeg]` / `[link: …]` / etc.
   */
  extractPreview(content: ContentBlock[], maxChars: number): string {
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text') {
        parts.push(block.text);
      } else if (block.type === 'image') {
        parts.push(`[${block.source.media_type} image]`);
      } else if (block.type === 'resource_link') {
        parts.push(`[link: ${block.title || block.uri}]`);
      } else if (block.type === 'persisted_reference') {
        parts.push(`[persisted ${block.sizeBytes} bytes]`);
      }
    }
    const joined = parts.join('\n');
    if (joined.length <= maxChars) return joined;
    return joined.slice(0, maxChars) + '\n…[truncated, full content at reference]';
  }

  /**
   * Remove all persisted results for this session. Called when the
   * session is archived or explicitly cleaned up.
   */
  cleanup(): void {
    try {
      fs.rmSync(this.dir, { recursive: true, force: true });
    } catch {
      /* ignore — cleanup is best-effort */
    }
  }

  /**
   * Strip characters that aren't safe for filenames. Tool use IDs are
   * usually UUIDs but we can't assume that — a malicious or
   * misbehaving plugin could pass anything.
   */
  private sanitiseId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 100);
  }

  /** The storage directory for this session. */
  get directory(): string {
    return this.dir;
  }
}
