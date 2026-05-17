import type { ToolDefinition, ToolResult, ToolExecutionContext } from '@ais/types';
export type { ToolDefinition, ToolResult, ToolExecutionContext };

export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolResult>;

/**
 * A registered tool in the core registry.
 *
 * The Phase 6 platform rebuild added the capability flags in this
 * interface. Every new field is optional so existing builtin tools
 * and plugins compile unchanged; the registry treats missing flags
 * as conservative defaults.
 */
export interface ToolRegistration {
  definition: ToolDefinition;
  executor: ToolExecutor;
  source: 'builtin' | 'mcp' | 'cli_plugin' | 'http_plugin';
  category?: 'read' | 'write' | 'execute' | 'destructive';

  // ── Concurrency & cancellation ───────────────────────────
  /**
   * Whether this tool is safe to run concurrently with other
   * concurrent-safe tools in the same round. Read-only tools (read_file,
   * grep, web_fetch, etc.) are safe; tools with side effects (exec,
   * write_file, send_telegram) are not.
   *
   * Defaults to `false` (sequential) when omitted — fail-safe.
   */
  concurrencySafe?: boolean;
  /**
   * What should happen if the parent turn is interrupted while this
   * tool is running.
   *
   * - `'cancel'` (default): the tool receives the AbortSignal and is
   *   expected to clean up and return quickly.
   * - `'block'`: the interrupt waits until the tool finishes naturally.
   *   Use for tools whose partial completion would corrupt state
   *   (e.g. a database write in progress).
   */
  interruptBehavior?: 'cancel' | 'block';

  // ── Safety classification ────────────────────────────────
  /** True if this tool never modifies state. UI hint, not an enforced gate. */
  isReadOnly?: boolean;
  /**
   * True if this tool performs a destructive action (file delete, DB
   * drop, message send, etc.). UI hint — shows a warning icon in the
   * admin session viewer. Does NOT gate execution.
   */
  isDestructive?: boolean;

  // ── Context economy ──────────────────────────────────────
  /**
   * Maximum result size in bytes before the result is persisted to
   * disk and replaced with a `persisted_reference` content block in
   * the LLM's view. Pass `Infinity` to skip persistence even for
   * large outputs.
   *
   * If omitted, the session-wide default (16 KB) applies.
   */
  maxResultSizeChars?: number;
  /**
   * When to persist this tool's output.
   *
   * - `'threshold'` (default): persist only when `maxResultSizeChars`
   *   is exceeded.
   * - `'always'`: always persist, regardless of size (for tools whose
   *   output is authoritative and should be kept on disk).
   * - `'never'`: never persist, even if over budget.
   */
  persistOn?: 'threshold' | 'always' | 'never';

  // ── Validation & dedup hooks ─────────────────────────────
  /**
   * Optional input validator that runs before execution. Return
   * `{ok: true}` to proceed, or `{ok: false, error}` to surface a
   * clean error message to the LLM without running the tool.
   *
   * Use this for semantic checks that JSON Schema can't express
   * (e.g. "old_string and new_string must differ", "path must exist").
   */
  validateInput?: (input: unknown) => { ok: true } | { ok: false; error: string };
  /**
   * Optional equality check for two argument sets. Used by the loop
   * detector to decide whether two calls are "the same" for loop
   * tripping. Defaults to deep-equal if omitted.
   */
  inputsEquivalent?: (a: unknown, b: unknown) => boolean;

  // ── UI hints ─────────────────────────────────────────────
  /**
   * Short human-readable description of what this tool call is doing,
   * shown in the admin session viewer and channel-side progress
   * indicators. Returns a string given the input args.
   */
  getActivityDescription?: (input: unknown) => string;
}
