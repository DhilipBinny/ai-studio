"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ProgressSpan, SpanTreeNode } from "@/hooks/use-progress-stream";
import { useProgressStream } from "@/hooks/use-progress-stream";

const BADGE_STYLES: Record<string, string> = {
  "agent-start": "bg-purple-500/15 text-purple-400",
  "agent-progress": "bg-purple-500/15 text-purple-300",
  "agent-complete": "bg-purple-500/15 text-purple-300",
  "agent-error": "bg-red-500/15 text-red-400",
  "llm-start": "bg-blue-500/15 text-blue-400",
  "llm-complete": "bg-blue-500/15 text-blue-300",
  "llm-error": "bg-red-500/15 text-red-400",
  "tool-start": "bg-indigo-500/15 text-indigo-400",
  "tool-progress": "bg-yellow-500/15 text-yellow-400",
  "tool-complete": "bg-green-500/15 text-green-400",
  "tool-error": "bg-red-500/15 text-red-400",
  "workflow-start": "bg-cyan-500/15 text-cyan-400",
  "workflow-progress": "bg-cyan-500/15 text-cyan-300",
  "workflow-complete": "bg-green-500/15 text-green-300",
  "workflow-error": "bg-red-500/15 text-red-400",
  "node-start": "bg-cyan-500/15 text-cyan-300",
  "node-progress": "bg-cyan-500/15 text-cyan-200",
  "node-complete": "bg-green-500/15 text-green-300",
  "node-error": "bg-red-500/15 text-red-400",
  "approval-start": "bg-amber-500/15 text-amber-400",
  "approval-complete": "bg-amber-500/15 text-amber-300",
};

function getBadgeStyle(span: ProgressSpan): string {
  return BADGE_STYLES[`${span.spanKind}-${span.phase}`] || "bg-muted text-muted-foreground";
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function prettyJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function SpanLine({
  span,
  depth,
  isExpanded,
  isTreeExpanded,
  hasChildren,
  onToggleTree,
  onToggleDetail,
  debugMode,
}: {
  span: ProgressSpan;
  depth: number;
  isExpanded: boolean;
  isTreeExpanded: boolean;
  hasChildren: boolean;
  onToggleTree: () => void;
  onToggleDetail: () => void;
  debugMode: boolean;
}) {
  const hasDetails = !!(span.argsPreview || span.resultPreview);
  const badgeLabel = `${span.spanKind}.${span.phase}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (hasChildren) onToggleTree();
          else if (hasDetails) onToggleDetail();
        }}
        className={cn(
          "flex items-baseline gap-2 w-full px-2 py-1 text-left font-mono text-xs",
          "border-b border-border/20 last:border-0",
          (hasChildren || hasDetails) && "cursor-pointer hover:bg-muted/30",
          isExpanded && "bg-muted/20",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        disabled={!hasChildren && !hasDetails}
      >
        <span className="w-3 shrink-0 text-[11px] text-muted-foreground/50 select-none">
          {hasChildren ? (isTreeExpanded ? "▾" : "▸") : hasDetails ? (isExpanded ? "▾" : "▸") : ""}
        </span>

        <span className="text-[11px] text-muted-foreground/40 shrink-0 tabular-nums">
          {formatTs(span.timestamp)}
        </span>

        <span className={cn(
          "px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider shrink-0",
          getBadgeStyle(span),
        )}>
          {badgeLabel}
        </span>

        {span.agentName && (
          <span className="text-purple-400 font-semibold shrink-0 text-[11px]">
            {span.agentName}
          </span>
        )}

        {span.toolName && (
          <span className="text-primary font-semibold shrink-0 text-[11px]">
            {span.toolName}
          </span>
        )}

        <span className="text-muted-foreground flex-1 min-w-0 truncate">
          {span.message || span.name}
        </span>

        {span.durationMs != null && (
          <span className="text-[11px] text-muted-foreground/50 shrink-0">
            {formatDuration(span.durationMs)}
          </span>
        )}

        {span.tokens != null && span.tokens > 0 && (
          <span className="text-[11px] text-muted-foreground/50 shrink-0">
            {span.tokens.toLocaleString()} tok
          </span>
        )}

        {span.costUsd != null && span.costUsd > 0 && (
          <span className="text-[11px] text-green-400/70 shrink-0 font-mono">
            ${span.costUsd.toFixed(4)}
          </span>
        )}
      </button>

      {isExpanded && hasDetails && (
        <div className="py-2 px-5 space-y-2.5 font-mono" style={{ paddingLeft: `${24 + depth * 16}px` }}>
          {span.argsPreview && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Input args
                {span.argsLen != null && span.argsLen > span.argsPreview.length && (
                  <span className="font-normal normal-case tracking-normal text-muted-foreground/30 ml-1.5">
                    (truncated, full {span.argsLen} chars)
                  </span>
                )}
              </div>
              <pre className="text-[11px] bg-muted/50 border border-border/50 rounded-md px-2.5 py-2 whitespace-pre-wrap break-all max-h-64 overflow-y-auto text-muted-foreground">
                {debugMode ? span.argsPreview : prettyJson(span.argsPreview)}
              </pre>
            </div>
          )}
          {span.resultPreview && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                Result
                {span.resultLen != null && span.resultLen > span.resultPreview.length && (
                  <span className="font-normal normal-case tracking-normal text-muted-foreground/30 ml-1.5">
                    (truncated, full {span.resultLen} chars)
                  </span>
                )}
              </div>
              <pre className="text-[11px] bg-muted/50 border border-border/50 rounded-md px-2.5 py-2 whitespace-pre-wrap break-all max-h-64 overflow-y-auto text-muted-foreground">
                {span.resultPreview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpanTreeRenderer({
  nodes,
  depth,
  expandedTree,
  expandedDetail,
  toggleTree,
  toggleDetail,
  debugMode,
}: {
  nodes: SpanTreeNode[];
  depth: number;
  expandedTree: Set<string>;
  expandedDetail: Set<string>;
  toggleTree: (id: string) => void;
  toggleDetail: (id: string) => void;
  debugMode: boolean;
}) {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.span.id}>
          <SpanLine
            span={node.span}
            depth={depth}
            isExpanded={expandedDetail.has(node.span.id)}
            isTreeExpanded={expandedTree.has(node.span.id)}
            hasChildren={node.children.length > 0}
            onToggleTree={() => toggleTree(node.span.id)}
            onToggleDetail={() => toggleDetail(node.span.id)}
            debugMode={debugMode}
          />
          {node.children.length > 0 && expandedTree.has(node.span.id) && (
            <SpanTreeRenderer
              nodes={node.children}
              depth={depth + 1}
              expandedTree={expandedTree}
              expandedDetail={expandedDetail}
              toggleTree={toggleTree}
              toggleDetail={toggleDetail}
              debugMode={debugMode}
            />
          )}
        </div>
      ))}
    </>
  );
}

export function EventFeed({
  traceId,
  enabled = true,
  height = 400,
  className,
}: {
  traceId: string | null;
  enabled?: boolean;
  height?: number;
  className?: string;
}) {
  const { spans, tree, connected, clearSpans } = useProgressStream(traceId, enabled);
  const [autoScroll, setAutoScroll] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set());
  const [expandedDetail, setExpandedDetail] = useState<Set<string>>(() => new Set());
  const feedRef = useRef<HTMLDivElement>(null);

  const toggleTree = useCallback((id: string) => {
    setExpandedTree((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDetail = useCallback((id: string) => {
    setExpandedDetail((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (autoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [spans.length, autoScroll]);

  useEffect(() => {
    if (tree.length === 0) return;
    setExpandedTree((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const node of tree) {
        if (node.children.length > 0 && !next.has(node.span.id)) {
          next.add(node.span.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [spans.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          {connected && (
            <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
          )}
          <h3 className="text-sm font-semibold">
            {connected ? "Live Execution Log" : "Execution Log"}
          </h3>
          <span className="text-[10px] text-muted-foreground">{spans.length} events</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-primary h-3 w-3"
            />
            Auto-scroll
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
              className="accent-primary h-3 w-3"
            />
            Debug
          </label>
          <button
            type="button"
            onClick={clearSpans}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      </div>

      <div ref={feedRef} className="overflow-y-auto px-0 py-1" style={{ height }}>
        {spans.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {connected ? "Waiting for agent activity..." : "No execution events"}
          </div>
        ) : (
          <SpanTreeRenderer
            nodes={tree}
            depth={0}
            expandedTree={expandedTree}
            expandedDetail={expandedDetail}
            toggleTree={toggleTree}
            toggleDetail={toggleDetail}
            debugMode={debugMode}
          />
        )}
      </div>
    </div>
  );
}

export function CompactStatus({
  traceId,
  enabled = true,
}: {
  traceId: string | null;
  enabled?: boolean;
}) {
  const { latestSpan, connected } = useProgressStream(traceId, enabled);

  if (!connected || !latestSpan) return null;
  if (latestSpan.phase === "complete" && latestSpan.spanKind === "agent") return null;

  let label = latestSpan.message || latestSpan.name;
  if (latestSpan.spanKind === "llm" && latestSpan.phase === "start") {
    label = `Calling ${latestSpan.modelId || latestSpan.name}...`;
  } else if (latestSpan.spanKind === "tool" && latestSpan.phase === "start") {
    label = `Running ${latestSpan.toolName || latestSpan.name}...`;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded-md">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      <span className="truncate">{label}</span>
      {latestSpan.durationMs != null && (
        <span className="shrink-0 tabular-nums">{formatDuration(latestSpan.durationMs)}</span>
      )}
    </div>
  );
}

export function HistoricalEventFeed({
  traceId,
  sessionId,
  height = 400,
  className,
}: {
  traceId?: string;
  sessionId?: string;
  height?: number;
  className?: string;
}) {
  const [spans, setSpans] = useState<ProgressSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set());
  const [expandedDetail, setExpandedDetail] = useState<Set<string>>(() => new Set());

  const queryId = traceId || sessionId;

  useEffect(() => {
    if (!queryId) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (traceId) params.set("traceId", traceId);
    if (sessionId) params.set("sessionId", sessionId);
    fetch(`/api/progress/history?${params.toString()}`)
      .then((r) => r.ok ? r.json() : { spans: [] })
      .then((d) => {
        const loadedSpans = d.spans || [];
        setSpans(loadedSpans);
        const roots = new Set<string>();
        for (const s of loadedSpans) {
          if (!s.parentId) roots.add(s.id);
        }
        setExpandedTree(roots);
      })
      .finally(() => setLoading(false));
  }, [queryId, traceId, sessionId]);

  const toggleTree = useCallback((id: string) => {
    setExpandedTree((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleDetail = useCallback((id: string) => {
    setExpandedDetail((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build tree from flat spans
  const tree = buildTreeFromSpans(spans);

  if (loading) {
    return (
      <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
          Loading execution log...
        </div>
      </div>
    );
  }

  if (spans.length === 0) return null;

  return (
    <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Execution Log</h3>
          <span className="text-[10px] text-muted-foreground">{spans.length} events</span>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
            className="accent-primary h-3 w-3"
          />
          Debug
        </label>
      </div>

      <div className="overflow-y-auto px-0 py-1" style={{ height }}>
        <SpanTreeRenderer
          nodes={tree}
          depth={0}
          expandedTree={expandedTree}
          expandedDetail={expandedDetail}
          toggleTree={toggleTree}
          toggleDetail={toggleDetail}
          debugMode={debugMode}
        />
      </div>
    </div>
  );
}

function buildTreeFromSpans(spans: ProgressSpan[]): SpanTreeNode[] {
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
