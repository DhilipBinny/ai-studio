"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

export interface ProgressSpan {
  id: string;
  seq: number;
  traceId: string;
  parentId: string | null;
  tenantId: string;
  spanKind: string;
  phase: string;
  timestamp: number;
  durationMs?: number;
  name: string;
  message?: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  argsPreview?: string;
  argsLen?: number;
  resultPreview?: string;
  resultLen?: number;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  nodeId?: string;
  modelId?: string;
  toolName?: string;
}

export interface SpanTreeNode {
  span: ProgressSpan;
  children: SpanTreeNode[];
}

const MAX_SPANS = 500;

function buildTree(spans: ProgressSpan[]): SpanTreeNode[] {
  const nodeMap = new Map<string, SpanTreeNode>();
  const roots: SpanTreeNode[] = [];

  for (const span of spans) {
    nodeMap.set(span.id, { span, children: [] });
  }

  for (const span of spans) {
    const node = nodeMap.get(span.id)!;
    if (span.parentId) {
      const parent = nodeMap.get(span.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  return roots;
}

export function useProgressStream(traceId: string | null, enabled = true) {
  const [spans, setSpans] = useState<ProgressSpan[]>([]);
  const [connected, setConnected] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clearSpans = useCallback(() => setSpans([]), []);

  useEffect(() => {
    if (!traceId || !enabled) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    const url = `/api/progress?traceId=${encodeURIComponent(traceId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("open", () => {
      if (!cancelled) setConnected(true);
    });

    es.addEventListener("replay.start", () => {
      if (!cancelled) setReplaying(true);
    });

    es.addEventListener("replay.end", () => {
      if (!cancelled) setReplaying(false);
    });

    es.addEventListener("span", (event: MessageEvent) => {
      if (cancelled) return;
      try {
        const span = JSON.parse(event.data) as ProgressSpan;
        setSpans((prev) => {
          if (prev.some((s) => s.id === span.id)) return prev;
          const next = [...prev, span];
          return next.length > MAX_SPANS ? next.slice(next.length - MAX_SPANS) : next;
        });
      } catch {
        // ignore malformed events
      }
    });

    es.addEventListener("error", () => {
      if (!cancelled) setConnected(false);
    });

    return () => {
      cancelled = true;
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [traceId, enabled]);

  const tree = useMemo(() => buildTree(spans), [spans]);

  return {
    spans,
    tree,
    connected,
    replaying,
    clearSpans,
    latestSpan: spans.length > 0 ? spans[spans.length - 1] : null,
  };
}
