"use client";

import { Handle, Position } from "@xyflow/react";
import { Play } from "lucide-react";
import { NODE_COLOR_MAP, NODE_LABEL_MAP, NODE_ICON_MAP } from "./canvas-types";

// ---------------------------------------------------------------------------
// Custom Node Component
// ---------------------------------------------------------------------------

export function getNodeSubtitle(nodeType: string, config: Record<string, unknown>, agentName?: string): string | null {
  switch (nodeType) {
    case "agent": return agentName || null;
    case "llm": return config.userMessage ? String(config.userMessage).slice(0, 45) : null;
    case "condition": return config.expression ? String(config.expression).slice(0, 40) : null;
    case "switch": return config.value ? String(config.value).slice(0, 40) : null;
    case "http_request": return config.url ? `${config.method || "GET"} ${String(config.url).slice(0, 30)}` : null;
    case "loop": return config.mode === "for_count" ? `${config.maxCount || 0} iterations` : "while condition";
    case "iteration": return config.arrayPath ? `${config.parallel ? "parallel" : "seq"} · ${String(config.arrayPath).slice(0, 25)}` : null;
    case "delay": return config.delayMs ? `${Number(config.delayMs) / 1000}s` : "dynamic";
    case "code": return config.code ? String(config.code).split("\n")[0]?.slice(0, 35) || "empty" : null;
    case "aggregate": return (config.strategy as string) || "merge";
    default: return null;
  }
}

export function CustomNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const nodeType = data.nodeType as string;
  const color = NODE_COLOR_MAP[nodeType] || "#6b7280";
  const Icon = NODE_ICON_MAP[nodeType] || Play;
  const label = data.label as string;
  const config = (data.config || {}) as Record<string, unknown>;
  const agentName = data.agentName as string | undefined;
  const runStatus = data.runStatus as string | undefined;
  const subtitle = getNodeSubtitle(nodeType, config, agentName);

  const statusRing = runStatus === "completed" ? "ring-2 ring-green-500/60"
    : runStatus === "running" ? "ring-2 ring-blue-500/60 animate-pulse"
    : runStatus === "failed" ? "ring-2 ring-red-500/60"
    : runStatus === "skipped" ? "opacity-40"
    : "";

  return (
    <div
      className={`rounded-xl bg-card min-w-[200px] max-w-[260px] border border-border transition-shadow ${statusRing} ${selected ? "shadow-lg" : "shadow-sm"}`}
      style={{ borderTopColor: color, borderTopWidth: 3 }}
    >
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full" style={{ backgroundColor: color }} />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg" style={{ backgroundColor: `${color}15` }}>
            <Icon className="w-3.5 h-3.5" style={{ color }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-tight truncate">{label}</div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
              {NODE_LABEL_MAP[nodeType] || nodeType}
            </div>
          </div>
          {runStatus && (
            <div className={`shrink-0 w-2 h-2 rounded-full ${
              runStatus === "completed" ? "bg-green-500" :
              runStatus === "running" ? "bg-blue-500 animate-pulse" :
              runStatus === "failed" ? "bg-red-500" : "bg-gray-400"
            }`} />
          )}
        </div>
        {subtitle && (
          <div className="mt-1.5 text-[10px] text-muted-foreground font-mono bg-muted/40 rounded-md px-2 py-1 truncate leading-relaxed">
            {subtitle}
          </div>
        )}
        {(data.durationMs as number) > 0 && (
          <div className="mt-1 text-[9px] text-muted-foreground/50 tabular-nums">{Number(data.durationMs)}ms</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full" style={{ backgroundColor: color }} />
    </div>
  );
}
