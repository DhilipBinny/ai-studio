"use client";

import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  Play, Check, X, AlertTriangle, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { NODE_COLOR_MAP, NODE_LABEL_MAP, NODE_ICON_MAP, NODE_PORTS_MAP } from "./canvas-types";

// ---------------------------------------------------------------------------
// Detail Level (driven by semantic zoom in canvas.tsx)
// ---------------------------------------------------------------------------

export type DetailLevel = "full" | "compact" | "dot";

// ---------------------------------------------------------------------------
// Cost Overlay Types
// ---------------------------------------------------------------------------

export interface RunCostData {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

function getCostColor(cost: number): string {
  if (cost <= 0.001) return "#22c55e"; // green — cheap
  if (cost <= 0.01) return "#f59e0b";  // amber — moderate
  return "#ef4444";                      // red — expensive
}

// ---------------------------------------------------------------------------
// Handle Architecture
// ---------------------------------------------------------------------------

interface HandleDef {
  type: "source" | "target";
  id: string;
  label?: string;
  position: Position;
}

function calculateHandlePosition(index: number, total: number): number {
  const padding = 20; // % from top and bottom
  const range = 100 - 2 * padding;
  if (total <= 1) return 50;
  return padding + (index * range) / (total - 1);
}

function getNodeHandles(nodeType: string, config: Record<string, unknown>): HandleDef[] {
  const handles: HandleDef[] = [];

  // Target handle (all except input)
  if (nodeType !== "input") {
    handles.push({ type: "target", id: "target", position: Position.Left });
  }

  // Source handles based on port type
  const ports = NODE_PORTS_MAP[nodeType] || "single";

  switch (ports) {
    case "condition":
      handles.push(
        { type: "source", id: "source-true", label: "True", position: Position.Right },
        { type: "source", id: "source-false", label: "False", position: Position.Right },
      );
      break;
    case "switch": {
      const cases = (config.cases as Array<{ label: string }>) || [];
      cases.forEach((c, i) => {
        handles.push({
          type: "source",
          id: `source-case-${i}`,
          label: c.label || `Case ${i}`,
          position: Position.Right,
        });
      });
      handles.push({
        type: "source",
        id: "source-default",
        label: "Default",
        position: Position.Right,
      });
      break;
    }
    case "loop":
      handles.push(
        { type: "source", id: "source-loop-body", label: "Body", position: Position.Right },
        { type: "source", id: "source-loop-back", label: "Back", position: Position.Right },
        { type: "source", id: "source-loop-done", label: "Done", position: Position.Right },
      );
      break;
    default:
      // output node has no source handle; everything else gets a single source
      if (nodeType !== "output") {
        handles.push({ type: "source", id: "source", position: Position.Right });
      }
  }

  return handles;
}

// ---------------------------------------------------------------------------
// Subtitle Helper
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

// ---------------------------------------------------------------------------
// Node Validation
// ---------------------------------------------------------------------------

export type ValidationStatus = "valid" | "warning" | "none";

export function getValidationStatus(nodeType: string, config: Record<string, unknown>): ValidationStatus {
  switch (nodeType) {
    case "agent": return config.agentId ? "valid" : "warning";
    case "llm": return config.providerModelId ? "valid" : "warning";
    case "condition": return config.expression ? "valid" : "warning";
    case "http_request": return config.url ? "valid" : "warning";
    case "code": return config.code ? "valid" : "warning";
    case "knowledge_search": return config.knowledgeBaseId ? "valid" : "warning";
    case "sub_workflow": return config.workflowId ? "valid" : "warning";
    case "switch": return (config.value && Array.isArray(config.cases) && (config.cases as unknown[]).length > 0) ? "valid" : "warning";
    default: return "none";
  }
}

function getValidationMessage(nodeType: string, config: Record<string, unknown>): string {
  switch (nodeType) {
    case "agent": return !config.agentId ? "Agent not selected" : "";
    case "llm": return !config.providerModelId ? "Model not selected" : "";
    case "condition": return !config.expression ? "Expression not set" : "";
    case "http_request": return !config.url ? "URL not set" : "";
    case "code": return !config.code ? "Code not written" : "";
    case "knowledge_search": return !config.knowledgeBaseId ? "Knowledge base not selected" : "";
    case "sub_workflow": return !config.workflowId ? "Workflow not selected" : "";
    case "switch": {
      if (!config.value) return "Switch value not set";
      if (!Array.isArray(config.cases) || (config.cases as unknown[]).length === 0) return "No cases defined";
      return "";
    }
    default: return "";
  }
}

// ---------------------------------------------------------------------------
// Custom Node Component
// ---------------------------------------------------------------------------

export function CustomNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const nodeType = data.nodeType as string;
  const color = NODE_COLOR_MAP[nodeType] || "#6b7280";
  const Icon = NODE_ICON_MAP[nodeType] || Play;
  const label = data.label as string;
  const config = (data.config || {}) as Record<string, unknown>;
  const agentName = data.agentName as string | undefined;
  const runStatus = data.runStatus as string | undefined;
  const runDuration = data.runDuration as number | undefined;
  const errorMessage = data.errorMessage as string | undefined;
  const collapsed = data.collapsed as boolean | undefined;
  const detailLevel = (data.detailLevel as DetailLevel) || "full";
  const showCostOverlay = data.showCostOverlay as boolean | undefined;
  const runCost = data.runCost as RunCostData | undefined;
  const subtitle = getNodeSubtitle(nodeType, config, agentName);

  // Local collapse state (falls back to data.collapsed)
  const [isCollapsed, setIsCollapsed] = useState(collapsed ?? false);

  const handles = getNodeHandles(nodeType, config);
  const sourceHandles = handles.filter((h) => h.type === "source");
  const targetHandles = handles.filter((h) => h.type === "target");

  // -----------------------------------------------------------------------
  // Dot view: tiny colored circle, invisible handles for connection lines
  // -----------------------------------------------------------------------

  if (detailLevel === "dot") {
    return (
      <div className="relative w-4 h-4 rounded-full" style={{ backgroundColor: color }}>
        {targetHandles.map((h) => (
          <Handle
            key={h.id}
            type="target"
            position={Position.Left}
            id={h.id}
            className="!opacity-0 !w-4 !h-4"
            style={{ top: "50%", left: 0 }}
          />
        ))}
        {sourceHandles.map((h, i) => (
          <Handle
            key={h.id}
            type="source"
            position={Position.Right}
            id={h.id}
            className="!opacity-0 !w-4 !h-4"
            style={{
              top: sourceHandles.length <= 1 ? "50%" : `${calculateHandlePosition(i, sourceHandles.length)}%`,
              right: 0,
            }}
          />
        ))}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Compact view: icon + label only, handles visible, no subtitle/badge
  // -----------------------------------------------------------------------

  if (detailLevel === "compact") {
    return (
      <div
        className={`relative flex items-center gap-1.5 px-2 py-1 rounded-lg border bg-card min-w-0 ${selected ? "shadow-md" : "shadow-sm"}`}
        style={{ borderTopColor: color, borderTopWidth: 2 }}
      >
        {targetHandles.map((h) => (
          <Handle
            key={h.id}
            type="target"
            position={Position.Left}
            id={h.id}
            className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full"
            style={{ backgroundColor: color, top: "50%" }}
          />
        ))}
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="text-xs font-medium truncate max-w-[100px]">{label}</span>
        {sourceHandles.length === 1 && !sourceHandles[0].label ? (
          <Handle
            key={sourceHandles[0].id}
            type="source"
            position={Position.Right}
            id={sourceHandles[0].id}
            className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full"
            style={{ backgroundColor: color, top: "50%" }}
          />
        ) : (
          sourceHandles.map((h, i) => (
            <Handle
              key={h.id}
              type="source"
              position={Position.Right}
              id={h.id}
              className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full"
              style={{
                backgroundColor: color,
                top: sourceHandles.length <= 1 ? "50%" : `${calculateHandlePosition(i, sourceHandles.length)}%`,
              }}
            />
          ))
        )}
        {/* Cost overlay in compact mode */}
        {showCostOverlay && runCost && (
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-card border rounded px-1.5 py-0.5 text-[9px] shadow-sm whitespace-nowrap z-20">
            <span className="font-medium" style={{ color: getCostColor(runCost.costUsd) }}>
              ${runCost.costUsd.toFixed(4)}
            </span>
          </div>
        )}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Full view: complete node card (existing behavior)
  // -----------------------------------------------------------------------

  // Auto-expand height for multi-port nodes (only when expanded)
  const nodeMinHeight = isCollapsed ? 40 : Math.max(72, 44 + sourceHandles.length * 28);

  // Validation
  const validationStatus = getValidationStatus(nodeType, config);
  const validationMessage = getValidationMessage(nodeType, config);

  // Execution status styling
  const statusRing = runStatus === "completed" ? "ring-2 ring-green-500/60"
    : runStatus === "running" ? "ring-2 ring-blue-500/60 animate-pulse"
    : runStatus === "failed" ? "ring-2 ring-red-500/60"
    : runStatus === "skipped" ? "opacity-40"
    : "";

  // Left accent bar for completed/failed
  const leftAccent = runStatus === "completed" ? { borderLeftColor: "#22c55e", borderLeftWidth: 3 }
    : runStatus === "failed" ? { borderLeftColor: "#ef4444", borderLeftWidth: 3 }
    : {};

  return (
    <TooltipProvider>
      <div
        className={`relative rounded-xl bg-card min-w-[220px] max-w-[260px] border border-border transition-shadow ${statusRing} ${selected ? "shadow-lg" : "shadow-sm"}`}
        style={{ borderTopColor: color, borderTopWidth: 3, minHeight: nodeMinHeight, ...leftAccent }}
      >
        {/* Target handles (left side) */}
        {targetHandles.map((h) => (
          <Handle
            key={h.id}
            type="target"
            position={Position.Left}
            id={h.id}
            className="!w-3 !h-3 !border-2 !border-card !rounded-full hover:!scale-[1.3] transition-transform"
            style={{ backgroundColor: color, top: "50%" }}
          />
        ))}

        {/* Running spinner overlay */}
        {runStatus === "running" && (
          <div className="absolute inset-0 rounded-xl bg-blue-500/5 flex items-center justify-center pointer-events-none z-10">
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          </div>
        )}

        {/* Validation indicator (top-right) */}
        {validationStatus !== "none" && !runStatus && (
          <div className="absolute -top-1.5 -right-1.5 z-20">
            {validationStatus === "valid" ? (
              <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                <Check className="w-2.5 h-2.5 text-white" />
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={<div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center shadow-sm cursor-help" />}
                >
                  <AlertTriangle className="w-2.5 h-2.5 text-white" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span>{validationMessage}</span>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* Execution status badge (top-right, when running/completed/failed) */}
        {runStatus === "completed" && (
          <div className="absolute -top-1.5 -right-1.5 z-20 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
            <Check className="w-2.5 h-2.5 text-white" />
          </div>
        )}
        {runStatus === "failed" && (
          <Tooltip>
            <TooltipTrigger
              render={<div className="absolute -top-1.5 -right-1.5 z-20 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center shadow-sm cursor-help" />}
            >
              <X className="w-2.5 h-2.5 text-white" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>{errorMessage || "Step failed"}</span>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Node content */}
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg" style={{ backgroundColor: `${color}15` }}>
              <Icon className="w-3.5 h-3.5" style={{ color }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-tight truncate">{label}</div>
              {!isCollapsed && (
                <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
                  {NODE_LABEL_MAP[nodeType] || nodeType}
                </div>
              )}
            </div>
            {/* Collapse/Expand toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCollapsed((prev) => !prev);
              }}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              aria-label={isCollapsed ? "Expand node" : "Collapse node"}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
            {/* Run status dot (inline) */}
            {runStatus && !["completed", "failed"].includes(runStatus) && (
              <div className={`shrink-0 w-2 h-2 rounded-full ${
                runStatus === "running" ? "bg-blue-500 animate-pulse" : "bg-gray-400"
              }`} />
            )}
          </div>
          {/* Expanded content: subtitle, port labels, duration */}
          {!isCollapsed && (
            <>
              {subtitle && (
                <div className="mt-1.5 text-[10px] text-muted-foreground font-mono bg-muted/40 rounded-md px-2 py-1 truncate leading-relaxed">
                  {subtitle}
                </div>
              )}
              {runDuration != null && runDuration > 0 && (
                <div className="mt-1 text-[9px] text-muted-foreground/50 tabular-nums">{runDuration}ms</div>
              )}
              {(data.durationMs as number) > 0 && !runDuration && (
                <div className="mt-1 text-[9px] text-muted-foreground/50 tabular-nums">{Number(data.durationMs)}ms</div>
              )}
            </>
          )}
        </div>

        {/* Source handles (right side) */}
        {sourceHandles.length === 1 && !sourceHandles[0].label ? (
          // Single handle — vertically centered, no label
          <Handle
            key={sourceHandles[0].id}
            type="source"
            position={Position.Right}
            id={sourceHandles[0].id}
            className="!w-3 !h-3 !border-2 !border-card !rounded-full hover:!scale-[1.3] transition-transform"
            style={{ backgroundColor: color, top: "50%" }}
          />
        ) : (
          // Multi-output handles — evenly spaced with labels
          sourceHandles.map((h, i) => (
            <div key={h.id}>
              <Handle
                type="source"
                position={Position.Right}
                id={h.id}
                className="!w-3 !h-3 !border-2 !border-card !rounded-full hover:!scale-[1.3] transition-transform"
                style={{
                  backgroundColor: color,
                  top: `${calculateHandlePosition(i, sourceHandles.length)}%`,
                }}
              />
              {h.label && !isCollapsed && (
                <div
                  className="absolute right-4 text-[10px] text-muted-foreground whitespace-nowrap pointer-events-none"
                  style={{
                    top: `${calculateHandlePosition(i, sourceHandles.length)}%`,
                    transform: "translateY(-50%)",
                    textAlign: "right",
                  }}
                >
                  {h.label}
                </div>
              )}
            </div>
          ))
        )}

        {/* Per-node cost/token overlay */}
        {showCostOverlay && runCost && (
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-card border rounded px-1.5 py-0.5 text-[9px] shadow-sm whitespace-nowrap z-20">
            <span className="text-muted-foreground">{runCost.inputTokens}&rarr;{runCost.outputTokens} tok</span>
            <span className="font-medium" style={{ color: getCostColor(runCost.costUsd) }}>
              ${runCost.costUsd.toFixed(4)}
            </span>
            <span className="text-muted-foreground">{runCost.latencyMs}ms</span>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
