/**
 * Streaming timeout utility — TTFT + idle timer pattern.
 *
 * Replaces the single wall-clock timeout that kills long-form generation.
 * Two timers protect against dead connections without aborting active streams:
 *
 * 1. TTFT (time-to-first-token): fires if no data arrives at all
 * 2. Idle: resets on every chunk, fires only if the connection goes silent
 */

export interface StreamingTimeoutOptions {
  /** Max ms to wait for the first streaming event (default: 60s). */
  ttftMs?: number;
  /** Max ms of silence between consecutive events (default: 120s). */
  idleMs?: number;
  /** External abort signal to compose with (e.g. from caller). */
  signal?: AbortSignal;
}

const DEFAULT_TTFT_MS = 60_000;
const DEFAULT_IDLE_MS = 120_000;

export interface StreamingTimeout {
  /** The composed AbortSignal — pass to the HTTP/SDK request. */
  signal: AbortSignal;
  /** Call on every received streaming event to reset the idle timer. */
  onActivity(): void;
  /** Call when the stream completes (success or error) to clear timers. */
  clear(): void;
}

export function createStreamingTimeout(opts: StreamingTimeoutOptions = {}): StreamingTimeout {
  const ttftMs = opts.ttftMs ?? DEFAULT_TTFT_MS;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;

  const abortController = new AbortController();

  if (opts.signal) {
    opts.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  let timerId: ReturnType<typeof setTimeout> | null = null;

  // Start with TTFT timer
  timerId = setTimeout(() => abortController.abort(), ttftMs);

  function onActivity(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    // Switch to idle timer (resets on each call)
    timerId = setTimeout(() => abortController.abort(), idleMs);
  }

  function clear(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  return {
    signal: abortController.signal,
    onActivity,
    clear,
  };
}
