/**
 * Per-turn tool-result byte budget.
 *
 * Tracks the running total of bytes tool results have contributed to the
 * LLM conversation context this turn. When the cap is exceeded the
 * registry asks the result-storage layer to persist further results to
 * disk (and return a small preview + reference) even if they would
 * normally fit under their own per-tool threshold.
 *
 * Also fires an optional `onOverBudget` callback that the agent loop can
 * use to trigger an early hard-compaction (the "compaction_pressure"
 * signal from the Phase 6 plan).
 *
 * Implements the `ResultBudget` interface from `@ais/types`.
 */

import type { ResultBudget as ResultBudgetInterface } from '@ais/types';

export const DEFAULT_RESULT_BUDGET_BYTES = 256 * 1024; // 256 KB per turn

export class ResultBudget implements ResultBudgetInterface {
  private used = 0;
  private readonly cap: number;
  private readonly onOverBudget?: () => void;
  private tripped = false;

  constructor(capBytes: number = DEFAULT_RESULT_BUDGET_BYTES, onOverBudget?: () => void) {
    this.cap = capBytes;
    this.onOverBudget = onOverBudget;
  }

  /**
   * Add bytes to the running total.
   *
   * Returns `true` if still under the cap after this addition, `false`
   * if the cap is exceeded. If the cap transitions from under → over
   * as a result of this call, the `onOverBudget` callback fires exactly
   * once (subsequent over-budget adds don't re-fire it).
   */
  add(bytes: number): boolean {
    if (bytes < 0) bytes = 0;
    this.used += bytes;
    const over = this.used > this.cap;
    if (over && !this.tripped) {
      this.tripped = true;
      if (this.onOverBudget) {
        try {
          this.onOverBudget();
        } catch {
          /* swallow — budget callback must never break tool execution */
        }
      }
    }
    return !over;
  }

  /** Current accumulated bytes. */
  current(): number {
    return this.used;
  }

  /** Remaining bytes before the cap. */
  remaining(): number {
    return Math.max(0, this.cap - this.used);
  }

  /** True if the running total has exceeded the cap. */
  isOverBudget(): boolean {
    return this.used > this.cap;
  }

  /** Reset the counter (called at turn boundaries). */
  reset(): void {
    this.used = 0;
    this.tripped = false;
  }

  /** The configured cap (for diagnostics / logging). */
  get capBytes(): number {
    return this.cap;
  }
}
