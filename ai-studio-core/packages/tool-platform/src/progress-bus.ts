/**
 * Progress bus — per-session pub/sub for live tool-execution events.
 *
 * The registry emits `tool.start` / `tool.complete` / `tool.error`
 * events around every tool call. Tools can additionally call
 * `context.progress(...)` to emit `tool.progress` events mid-execution
 * (e.g. "fetched 50 KB", "processed page 3/10"). The registry wraps
 * the per-call progress callback so tool authors don't need to pass
 * their own name/callId — that gets injected automatically.
 *
 * Consumers subscribe via the SSE endpoint at
 * `GET /api/v1/sessions/:id/progress`. Each subscriber gets a live
 * stream of events for exactly one session. Multiple subscribers per
 * session are supported (admin UI tab + CLI tailing + future webchat
 * broadcaster can all attach).
 *
 * In-memory only — events are ephemeral. No persistence, no history,
 * no catch-up for clients that connect mid-turn. If a later phase
 * wants replayable progress it can add a ring buffer per session; for
 * now the live view is enough.
 */

export interface ProgressEvent {
  /** Target session for routing. */
  sessionId: string;
  /** Monotonic epoch ms so clients can order + measure gaps. */
  timestamp: number;
  /**
   * Event kind. Known kinds emitted by the registry:
   *   - `tool.start`    — a tool is about to execute
   *   - `tool.progress` — tool is reporting in-progress state (from context.progress)
   *   - `tool.complete` — tool finished successfully
   *   - `tool.error`    — tool returned an error or threw
   * Other subsystems may emit additional kinds in the future
   * (e.g. `agent.round`, `compaction.start`); consumers should
   * treat the field as an opaque string and fall back to rendering
   * the `message` field.
   */
  kind: 'tool.start' | 'tool.progress' | 'tool.complete' | 'tool.error' | string;
  /** Tool name when the event relates to a tool call. */
  toolName?: string;
  /** Stable callId for this tool invocation (for pairing start → complete). */
  toolCallId?: string;
  /** Short human-readable status line. */
  message?: string;
  /** Optional 0-1 completion fraction for mid-turn progress. */
  fraction?: number;
  /** Optional structured payload — tool-specific. */
  data?: unknown;
  /** Set on tool.complete / tool.error. */
  durationMs?: number;
  /**
   * JSON-stringified tool arguments, truncated to 500 chars with `…`
   * if longer. Set on tool.start so the admin UI can show the LLM's
   * actual input without needing a separate fetch.
   */
  argsPreview?: string;
  /** Total length of the serialized args before truncation. */
  argsLen?: number;
  /**
   * Rendered tool result text, truncated to 500 chars with `…` if
   * longer. Handles all three result shapes:
   *   - strings → as-is
   *   - content-block envelopes → text blocks joined, non-text blocks
   *     summarised as `[image/jpeg]` / `[persisted 84KB]` / `[link: …]`
   *   - legacy objects → JSON.stringify
   * Set on tool.complete / tool.error.
   */
  resultPreview?: string;
  /** Total length of the rendered result before truncation. */
  resultLen?: number;
  /**
   * True when the tool result was persisted to disk by the registry
   * (i.e. its envelope.content was replaced with a persisted_reference
   * block). Signals to the UI that the full content lives on disk and
   * not in the event stream.
   */
  resultPersisted?: boolean;
}

/**
 * A subscriber receives events for one session. Returns the unsubscribe
 * function — call it on client disconnect to free the slot.
 */
export type ProgressSubscriber = (event: ProgressEvent) => void;

/** TC-4: max events kept in the replay ring buffer. */
const HISTORY_RING_SIZE = 200;

/**
 * Per-process progress bus. One instance at the top of `index.ts`
 * (module-level singleton is fine — this is per-process state).
 */
export class ProgressBus {
  /** session id → active subscribers */
  private bySession = new Map<string, Set<ProgressSubscriber>>();
  /** wildcard subscribers — receive every event regardless of session */
  private wildcardSubs = new Set<ProgressSubscriber>();
  /** total events emitted (diagnostics only). */
  private totalEmitted = 0;
  /**
   * TC-4 replay ring buffer. Holds the last `HISTORY_RING_SIZE`
   * events across all sessions in chronological order. Every new
   * SSE subscription gets the matching slice replayed before it
   * enters live mode, so opening `/admin/progress` immediately
   * shows the last ~200 events instead of an empty state.
   *
   * Implemented as a plain array with a head pointer + length. We
   * never resize past the cap — once full, we overwrite the oldest
   * slot. Readers walk from the oldest slot forward.
   */
  private history: ProgressEvent[] = [];
  private historyHead = 0;

  /**
   * Publish an event to every subscriber of its target session AND
   * every wildcard subscriber.
   *
   * Zero cost on the hot path with no subscribers at all. Subscriber
   * callback errors are swallowed so one bad client can't break
   * others.
   *
   * The event is also appended to the replay ring buffer before
   * fan-out so a new subscriber that lands mid-emit can still see
   * the event in its replay.
   */
  emit(event: ProgressEvent): void {
    this.totalEmitted++;
    // Append to ring buffer.
    if (this.history.length < HISTORY_RING_SIZE) {
      this.history.push(event);
    } else {
      this.history[this.historyHead] = event;
      this.historyHead = (this.historyHead + 1) % HISTORY_RING_SIZE;
    }

    const sessionSubs = this.bySession.get(event.sessionId);
    if (sessionSubs && sessionSubs.size > 0) {
      for (const fn of sessionSubs) {
        try { fn(event); } catch { /* swallow */ }
      }
    }
    if (this.wildcardSubs.size > 0) {
      for (const fn of this.wildcardSubs) {
        try { fn(event); } catch { /* swallow */ }
      }
    }
  }

  /**
   * Return the ring buffer's current contents in chronological
   * order (oldest → newest). Used by new SSE subscribers to replay
   * recent activity on connection. Filter by session id if supplied.
   *
   * TC-4 history buffer — without this, `/admin/progress` shows an
   * empty state on load unless events happen to fire right after
   * the subscribe. With it, the page lands on "the last 200 events",
   * which is usually enough to show the most recent turn's tool
   * cascade.
   */
  getHistory(sessionId?: string): ProgressEvent[] {
    if (this.history.length === 0) return [];
    const out: ProgressEvent[] = [];
    // Walk from the oldest slot forward. If the ring isn't full yet,
    // history[0..length-1] is already in chronological order; if it
    // is full, we start from historyHead (the oldest slot) and wrap.
    const full = this.history.length === HISTORY_RING_SIZE;
    const start = full ? this.historyHead : 0;
    for (let i = 0; i < this.history.length; i++) {
      const idx = (start + i) % HISTORY_RING_SIZE;
      const e = this.history[idx];
      if (!e) continue;
      if (sessionId && e.sessionId !== sessionId) continue;
      out.push(e);
    }
    return out;
  }

  /**
   * Register a subscriber for a specific session.
   *
   * Returns an `unsubscribe()` function the caller must invoke on
   * disconnect. If not called, the subscriber leaks (a live reference
   * prevents the session bucket from being GC'd).
   */
  subscribe(sessionId: string, fn: ProgressSubscriber): () => void {
    let subs = this.bySession.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.bySession.set(sessionId, subs);
    }
    subs.add(fn);

    return () => {
      const current = this.bySession.get(sessionId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) {
        this.bySession.delete(sessionId);
      }
    };
  }

  /**
   * Register a wildcard subscriber that receives events from every
   * session in this process. Useful for admin UIs that want to tail
   * everything without picking a specific session.
   *
   * Returns an `unsubscribe()` function the caller must invoke on
   * disconnect.
   */
  subscribeAll(fn: ProgressSubscriber): () => void {
    this.wildcardSubs.add(fn);
    return () => {
      this.wildcardSubs.delete(fn);
    };
  }

  /** Number of active subscribers for a session (diagnostics / UI hints). */
  subscriberCount(sessionId: string): number {
    return this.bySession.get(sessionId)?.size ?? 0;
  }

  /**
   * Forget a session entirely — removes the per-session subscriber
   * bucket and drops every history-buffer event tagged with this
   * session ID. Call this when a session ends, is archived, or is
   * deleted so the bus doesn't carry stale subscriber slots or
   * orphaned event history forward.
   *
   * Wildcard subscribers and history events for other sessions are
   * untouched. Returns the number of subscribers that were dropped
   * (0 if the session had none) for diagnostics.
   */
  clearSession(sessionId: string): number {
    const subs = this.bySession.get(sessionId);
    const subCount = subs?.size ?? 0;
    this.bySession.delete(sessionId);
    // Compact history: keep events from any other session in original
    // chronological order; reset the head pointer to 0 since we have
    // a fresh array shorter than the cap.
    if (this.history.length > 0) {
      const remaining = this.getHistory().filter(e => e.sessionId !== sessionId);
      this.history = remaining;
      this.historyHead = 0;
    }
    return subCount;
  }

  /** Number of wildcard subscribers currently attached. */
  get wildcardSubscriberCount(): number {
    return this.wildcardSubs.size;
  }

  /** Number of sessions with at least one subscriber. */
  get activeSessionCount(): number {
    return this.bySession.size;
  }

  /** Total events emitted since process start (diagnostics). */
  get totalEventsEmitted(): number {
    return this.totalEmitted;
  }
}
