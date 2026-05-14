import { getDb } from "@ais-app/database";
import { progressSpans } from "@ais-app/database";
import { progressBus } from "./progress-bus";
import type { ProgressSpan } from "./progress-types";

const FLUSH_INTERVAL_MS = 500;
const BATCH_SIZE = 50;

let buffer: ProgressSpan[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0, BATCH_SIZE);
  if (batch.length === 0) return;

  try {
    const db = getDb();
    await db.insert(progressSpans).values(
      batch.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        traceId: s.traceId,
        parentId: s.parentId,
        seq: s.seq,
        spanKind: s.spanKind,
        phase: s.phase,
        name: s.name,
        message: s.message ?? null,
        timestampMs: s.timestamp,
        durationMs: s.durationMs ?? null,
        tokens: s.tokens ?? null,
        inputTokens: s.inputTokens ?? null,
        outputTokens: s.outputTokens ?? null,
        costUsd: s.costUsd != null ? s.costUsd.toFixed(6) : null,
        argsPreview: s.argsPreview ?? null,
        argsLen: s.argsLen ?? null,
        resultPreview: s.resultPreview ?? null,
        resultLen: s.resultLen ?? null,
        agentId: s.agentId ?? null,
        agentName: s.agentName ?? null,
        sessionId: s.sessionId ?? null,
        nodeId: s.nodeId ?? null,
        modelId: s.modelId ?? null,
        toolName: s.toolName ?? null,
      })),
    );
  } catch {
    // DB write failure is non-fatal for real-time — spans are already in the ring buffer
  }
}

export function startProgressWriter(): void {
  if (flushTimer) return;

  unsubscribe = progressBus.subscribeGlobal((span: ProgressSpan) => {
    buffer.push(span);
    if (buffer.length >= BATCH_SIZE) {
      flushBuffer().catch(() => {});
    }
  });

  flushTimer = setInterval(() => {
    flushBuffer().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

export function stopProgressWriter(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  flushBuffer().catch(() => {});
}
