/**
 * Per-session tool-call loop detector.
 *
 * Maintains a ring buffer of the most recent tool calls keyed by a
 * stable fingerprint (tool name + normalised args hash). If the same
 * fingerprint appears `tripThreshold` or more times within the last
 * `windowSize` calls, the detector trips and the registry throws a
 * loop-break error back to the agent, asking it to try a different
 * approach.
 *
 * This is distinct from the global `maxToolRounds` cap — that's a
 * budget, this is a signature check. It catches "agent stuck in the
 * same grep pattern on the same file" before it burns through 25
 * rounds doing nothing useful.
 */

import crypto from 'node:crypto';

export const DEFAULT_WINDOW_SIZE = 5;
export const DEFAULT_TRIP_THRESHOLD = 3;

export class LoopDetector {
  private buffer: string[] = [];
  private readonly windowSize: number;
  private readonly tripThreshold: number;

  constructor(windowSize: number = DEFAULT_WINDOW_SIZE, tripThreshold: number = DEFAULT_TRIP_THRESHOLD) {
    this.windowSize = windowSize;
    this.tripThreshold = tripThreshold;
  }

  /**
   * Record a tool call and check if the loop is tripped.
   *
   * Returns `null` if the call is fine to execute, or a human-readable
   * error string the registry should return to the agent as the tool
   * result. The error tells the LLM it's in a loop and should break out.
   */
  record(toolName: string, args: Record<string, unknown>): string | null {
    const fingerprint = LoopDetector.fingerprint(toolName, args);

    // Ring buffer append
    this.buffer.push(fingerprint);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }

    // Count occurrences of this fingerprint in the current window
    let count = 0;
    for (const fp of this.buffer) {
      if (fp === fingerprint) count++;
    }

    if (count >= this.tripThreshold) {
      return (
        `Tool call loop detected: "${toolName}" has been called with the same arguments ` +
        `${count} times in the last ${this.buffer.length} calls. ` +
        `Break out of the loop — try different arguments, use a different tool, ` +
        `or ask the user to clarify. Repeating the same call will not produce a different result.`
      );
    }

    return null;
  }

  /** Forget the history (e.g. at session reset). */
  reset(): void {
    this.buffer = [];
  }

  /** Current window contents (for diagnostics / logging). */
  get window(): ReadonlyArray<string> {
    return this.buffer;
  }

  /**
   * Build a stable fingerprint for a tool call.
   *
   * Normalises argument order so that `{a: 1, b: 2}` and `{b: 2, a: 1}`
   * produce the same fingerprint. Hashes to a short hex string so the
   * ring buffer stays cheap.
   */
  static fingerprint(toolName: string, args: Record<string, unknown>): string {
    const keys = Object.keys(args).sort();
    const normalised = JSON.stringify(args, keys);
    return crypto.createHash('sha256').update(`${toolName}:${normalised}`).digest('hex').slice(0, 16);
  }
}
