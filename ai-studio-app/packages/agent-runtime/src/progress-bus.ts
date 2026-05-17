import { randomUUID } from "node:crypto";
import type {
  ProgressSpan,
  EmitSpanOptions,
  ProgressSubscriber,
  ProgressBusStats,
} from "./progress-types";

const RING_BUFFER_SIZE = 200;
const MAX_SUBSCRIBERS_PER_TRACE = 20;
const BACKPRESSURE_HIGH_WATER = 50;
const TRACE_TTL_MS = 30 * 60 * 1000;

interface TraceState {
  ring: (ProgressSpan | null)[];
  head: number;
  count: number;
  seq: number;
  subscribers: Set<ProgressSubscriber>;
  tenantId: string;
  createdAt: number;
}

export class ProgressBus {
  private traces = new Map<string, TraceState>();
  private wildcardSubs = new Map<string, Set<ProgressSubscriber>>();
  private globalSubs = new Set<ProgressSubscriber>();
  private totalEmitted = 0;

  emit(options: EmitSpanOptions): ProgressSpan {
    const state = this.getOrCreateTrace(options.traceId, options.tenantId);
    const seq = ++state.seq;

    const span: ProgressSpan = {
      id: randomUUID(),
      seq,
      traceId: options.traceId,
      parentId: options.parentId ?? null,
      tenantId: options.tenantId,
      spanKind: options.spanKind,
      phase: options.phase,
      timestamp: Date.now(),
      name: options.name,
      message: options.message,
      durationMs: options.durationMs,
      tokens: options.tokens,
      inputTokens: options.inputTokens,
      outputTokens: options.outputTokens,
      costUsd: options.costUsd,
      argsPreview: options.argsPreview,
      argsLen: options.argsLen,
      resultPreview: options.resultPreview,
      resultLen: options.resultLen,
      agentId: options.agentId,
      agentName: options.agentName,
      sessionId: options.sessionId,
      nodeId: options.nodeId,
      modelId: options.modelId,
      toolName: options.toolName,
    };

    state.ring[state.head] = span;
    state.head = (state.head + 1) % RING_BUFFER_SIZE;
    if (state.count < RING_BUFFER_SIZE) state.count++;
    this.totalEmitted++;

    for (const fn of state.subscribers) {
      try {
        fn(span);
      } catch {
        // subscriber error isolation — never crash the emitter
      }
    }

    const tenantWildcards = this.wildcardSubs.get(options.tenantId);
    if (tenantWildcards) {
      for (const fn of tenantWildcards) {
        try {
          fn(span);
        } catch {
          // subscriber error isolation
        }
      }
    }

    for (const fn of this.globalSubs) {
      try {
        fn(span);
      } catch {
        // global subscriber error isolation
      }
    }

    return span;
  }

  subscribe(traceId: string, tenantId: string, fn: ProgressSubscriber): () => void {
    const state = this.getOrCreateTrace(traceId, tenantId);

    if (state.subscribers.size >= MAX_SUBSCRIBERS_PER_TRACE) {
      throw new Error(`Max subscribers (${MAX_SUBSCRIBERS_PER_TRACE}) reached for trace ${traceId}`);
    }

    state.subscribers.add(fn);

    return () => {
      state.subscribers.delete(fn);
      this.maybeCleanupTrace(traceId);
    };
  }

  subscribeGlobal(fn: ProgressSubscriber): () => void {
    this.globalSubs.add(fn);
    return () => { this.globalSubs.delete(fn); };
  }

  subscribeAll(tenantId: string, fn: ProgressSubscriber): () => void {
    let subs = this.wildcardSubs.get(tenantId);
    if (!subs) {
      subs = new Set();
      this.wildcardSubs.set(tenantId, subs);
    }
    subs.add(fn);

    return () => {
      subs!.delete(fn);
      if (subs!.size === 0) this.wildcardSubs.delete(tenantId);
    };
  }

  getHistory(traceId: string, afterSeq?: number): ProgressSpan[] {
    const state = this.traces.get(traceId);
    if (!state) return [];

    const result: ProgressSpan[] = [];
    const start = state.count < RING_BUFFER_SIZE ? 0 : state.head;

    for (let i = 0; i < state.count; i++) {
      const idx = (start + i) % RING_BUFFER_SIZE;
      const span = state.ring[idx];
      if (!span) continue;
      if (afterSeq !== undefined && span.seq <= afterSeq) continue;
      result.push(span);
    }

    return result;
  }

  clearTrace(traceId: string): void {
    this.traces.delete(traceId);
  }

  getStats(): ProgressBusStats {
    let totalSubs = this.globalSubs.size;
    for (const state of this.traces.values()) {
      totalSubs += state.subscribers.size;
    }
    for (const subs of this.wildcardSubs.values()) {
      totalSubs += subs.size;
    }
    return {
      activeTraces: this.traces.size,
      totalSubscribers: totalSubs,
      totalSpansEmitted: this.totalEmitted,
    };
  }

  cleanup(): void {
    const now = Date.now();
    for (const [traceId, state] of this.traces) {
      if (state.subscribers.size > 0) continue;
      if (now - state.createdAt > TRACE_TTL_MS) {
        this.traces.delete(traceId);
      }
    }
  }

  private getOrCreateTrace(traceId: string, tenantId: string): TraceState {
    let state = this.traces.get(traceId);
    if (!state) {
      state = {
        ring: new Array(RING_BUFFER_SIZE).fill(null),
        head: 0,
        count: 0,
        seq: 0,
        subscribers: new Set(),
        tenantId,
        createdAt: Date.now(),
      };
      this.traces.set(traceId, state);
    }
    return state;
  }

  private maybeCleanupTrace(traceId: string): void {
    const state = this.traces.get(traceId);
    if (!state) return;
    if (state.subscribers.size === 0 && state.count === 0) {
      this.traces.delete(traceId);
    }
  }
}

export const BACKPRESSURE_LIMIT = BACKPRESSURE_HIGH_WATER;

const globalForBus = globalThis as unknown as { __progressBus?: ProgressBus; __progressBusCleanupInterval?: ReturnType<typeof setInterval> };
export const progressBus: ProgressBus = globalForBus.__progressBus ?? (globalForBus.__progressBus = new ProgressBus());

if (!globalForBus.__progressBusCleanupInterval) {
  globalForBus.__progressBusCleanupInterval = setInterval(() => progressBus.cleanup(), 5 * 60 * 1000);
}

function truncatePreview(value: unknown, maxLen = 500): { preview: string; len: number } {
  let str: string;
  if (typeof value === "string") {
    str = value;
  } else if (value === null || value === undefined) {
    return { preview: "", len: 0 };
  } else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  return {
    preview: str.length > maxLen ? str.slice(0, maxLen) + "..." : str,
    len: str.length,
  };
}

export { truncatePreview };
