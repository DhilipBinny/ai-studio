"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  Handle,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Save, Loader2, X, Settings2,
  Play, Flag, GitBranch, Route, Repeat, Layers, Timer, Workflow,
  Bot, Sparkles, Search, Wrench, Globe, Code, ArrowLeftRight,
  Combine, UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { WorkflowNode, WorkflowEdge, AgentSummary, ProviderModel } from "@ais-app/types";

type Agent = AgentSummary;

// ---------------------------------------------------------------------------
// Node Type Registry
// ---------------------------------------------------------------------------

interface NodeTypeDef {
  type: string;
  label: string;
  category: "flow" | "ai" | "action" | "data" | "human";
  color: string;
  icon: LucideIcon;
  description: string;
}

const NODE_REGISTRY: NodeTypeDef[] = [
  { type: "input",            label: "Input",            category: "flow",   color: "#3b82f6", icon: Play,           description: "Entry point — passes trigger data" },
  { type: "output",           label: "Output",           category: "flow",   color: "#10b981", icon: Flag,           description: "Terminal — formats final result" },
  { type: "condition",        label: "Condition",        category: "flow",   color: "#f59e0b", icon: GitBranch,      description: "If/else branch on expression" },
  { type: "switch",           label: "Switch",           category: "flow",   color: "#ea580c", icon: Route,          description: "Multi-branch routing by value" },
  { type: "loop",             label: "Loop",             category: "flow",   color: "#6366f1", icon: Repeat,         description: "Repeat until condition met" },
  { type: "iteration",        label: "Iteration",        category: "flow",   color: "#7c3aed", icon: Layers,         description: "Process array items" },
  { type: "delay",            label: "Delay",            category: "flow",   color: "#94a3b8", icon: Timer,          description: "Wait for specified duration" },
  { type: "sub_workflow",     label: "Sub-Workflow",     category: "flow",   color: "#0284c7", icon: Workflow,       description: "Execute another workflow" },
  { type: "agent",            label: "Agent",            category: "ai",     color: "#9333ea", icon: Bot,            description: "Full agent session with tools" },
  { type: "llm",              label: "LLM",              category: "ai",     color: "#c026d3", icon: Sparkles,       description: "Direct LLM call — prompt in, text out" },
  { type: "knowledge_search", label: "Knowledge Search", category: "ai",     color: "#db2777", icon: Search,         description: "Query knowledge base (RAG)" },
  { type: "tool",             label: "Tool",             category: "action", color: "#0d9488", icon: Wrench,         description: "Execute a tool directly" },
  { type: "http_request",     label: "HTTP Request",     category: "action", color: "#0891b2", icon: Globe,          description: "Call an external API" },
  { type: "code",             label: "Code",             category: "action", color: "#475569", icon: Code,           description: "Run sandboxed JavaScript" },
  { type: "transform",        label: "Transform",        category: "data",   color: "#0e7490", icon: ArrowLeftRight, description: "Map/reshape data" },
  { type: "aggregate",        label: "Aggregate",        category: "data",   color: "#059669", icon: Combine,        description: "Merge parallel branch outputs" },
  { type: "human_review",     label: "Human Review",     category: "human",  color: "#dc2626", icon: UserCheck,      description: "Pause for human decision" },
];

const NODE_COLOR_MAP = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.color]));
const NODE_LABEL_MAP = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.label]));
const NODE_ICON_MAP = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.icon]));

const CATEGORY_LABELS: Record<string, string> = {
  flow: "Flow Control",
  ai: "AI",
  action: "Action",
  data: "Data",
  human: "Human",
};

const EDGE_STYLES: Record<string, { stroke: string; strokeDasharray?: string; animated: boolean }> = {
  normal:    { stroke: "#94a3b8", animated: false },
  error:     { stroke: "#ef4444", strokeDasharray: "6,4", animated: false },
  loop_body: { stroke: "#6366f1", animated: true },
  loop_back: { stroke: "#6366f1", strokeDasharray: "4,4", animated: false },
  loop_done: { stroke: "#10b981", animated: false },
};

// ---------------------------------------------------------------------------
// Custom Node Component
// ---------------------------------------------------------------------------

function getNodeSubtitle(nodeType: string, config: Record<string, unknown>, agentName?: string): string | null {
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

function CustomNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
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

const nodeTypes: NodeTypes = { custom: CustomNode };

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function toFlowNodes(wfNodes: WorkflowNode[], agents: Agent[]): Node[] {
  return wfNodes.map((n) => ({
    id: n.id,
    type: "custom",
    position: { x: n.positionX, y: n.positionY },
    data: {
      label: n.name,
      nodeType: n.nodeType,
      config: n.config,
      agentName: n.nodeType === "agent" ? agents.find((a) => a.id === (n.config as Record<string, unknown>).agentId)?.name : undefined,
    },
  }));
}

function toFlowEdges(wfEdges: WorkflowEdge[]): Edge[] {
  return wfEdges.map((e) => {
    const edgeType = e.edgeType || "normal";
    const style = EDGE_STYLES[edgeType] || EDGE_STYLES.normal;
    return {
      id: e.id,
      source: e.fromNodeId,
      target: e.toNodeId,
      label: e.conditionLabel || undefined,
      animated: style.animated,
      style: { strokeWidth: 2, stroke: style.stroke, strokeDasharray: style.strokeDasharray },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: style.stroke },
    };
  });
}

// ---------------------------------------------------------------------------
// Node Palette (left sidebar)
// ---------------------------------------------------------------------------

function NodePalette({ onAdd }: { onAdd: (type: string) => void }) {
  const categories = Object.entries(CATEGORY_LABELS);

  return (
    <div className="w-56 shrink-0 border-r border-border bg-muted/10 overflow-y-auto">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add Node</p>
      </div>
      {categories.map(([cat, label]) => {
        const items = NODE_REGISTRY.filter((n) => n.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-1.5">{label}</p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    onClick={() => onAdd(item.type)}
                    className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 hover:bg-muted/60 transition-colors cursor-pointer text-left group"
                  >
                    <div
                      className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-transform group-hover:scale-105"
                      style={{ backgroundColor: `${item.color}15` }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium leading-tight">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground/50 leading-tight truncate">{item.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node Config Panel (right sidebar)
// ---------------------------------------------------------------------------

function NodeConfigPanel({
  node,
  agents,
  models,
  onUpdate,
  onClose,
  onDelete,
}: {
  node: Node;
  agents: Agent[];
  models: ProviderModel[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const data = node.data as Record<string, unknown>;
  const nodeType = data.nodeType as string;
  const config = (data.config || {}) as Record<string, unknown>;
  const errorPolicy = (data.errorPolicy || {}) as Record<string, unknown>;
  const [tab, setTab] = useState<"config" | "error">("config");

  function updateConfig(key: string, value: unknown) {
    const newConfig = { ...config, [key]: value };
    onUpdate(node.id, { ...data, config: newConfig });
  }

  function updateErrorPolicy(key: string, value: unknown) {
    const newPolicy = { ...errorPolicy, [key]: value };
    onUpdate(node.id, { ...data, errorPolicy: newPolicy });
  }

  function updateName(name: string) {
    onUpdate(node.id, { ...data, label: name });
  }

  return (
    <div className="w-72 shrink-0 border-l border-border bg-card overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          {(() => { const Icon = NODE_ICON_MAP[nodeType] || Play; const c = NODE_COLOR_MAP[nodeType] || "#6b7280"; return (
            <div className="flex items-center justify-center w-6 h-6 rounded-md" style={{ backgroundColor: `${c}15` }}>
              <Icon className="w-3.5 h-3.5" style={{ color: c }} />
            </div>
          ); })()}
          <span className="text-xs font-semibold">{NODE_LABEL_MAP[nodeType]}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onDelete(node.id)} className="text-muted-foreground hover:text-destructive p-1" title="Delete node">
            <X className="h-3.5 w-3.5" />
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1" title="Close panel">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex border-b border-border">
        <button onClick={() => setTab("config")} className={`flex-1 text-[11px] py-1.5 font-medium ${tab === "config" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>Config</button>
        <button onClick={() => setTab("error")} className={`flex-1 text-[11px] py-1.5 font-medium ${tab === "error" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>Error Policy</button>
      </div>

      <div className="p-3 space-y-3">
        {tab === "config" && (
          <>
            <div className="space-y-1">
              <Label className="text-[11px]">Node Name</Label>
              <Input value={(data.label as string) || ""} onChange={(e) => updateName(e.target.value)} className="h-8 text-xs" />
            </div>

            {nodeType === "agent" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Agent</Label>
                  <Select value={(config.agentId as string) || ""} onChange={(e) => updateConfig("agentId", e.target.value)} className="text-xs">
                    <option value="">Select agent...</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Message template</Label>
                  <Textarea value={(config.message as string) || ""} onChange={(e) => updateConfig("message", e.target.value)} rows={3} className="font-mono text-[11px]" placeholder="Summarize: {{input.text}}" />
                </div>
              </>
            )}

            {nodeType === "llm" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Model</Label>
                  <Select value={(config.providerModelId as string) || ""} onChange={(e) => updateConfig("providerModelId", e.target.value)} className="text-xs">
                    <option value="">Select model...</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.providerName})</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">System Prompt</Label>
                  <Textarea value={(config.systemPrompt as string) || ""} onChange={(e) => updateConfig("systemPrompt", e.target.value)} rows={2} className="font-mono text-[11px]" placeholder="You are a helpful assistant." />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">User Message</Label>
                  <Textarea value={(config.userMessage as string) || ""} onChange={(e) => updateConfig("userMessage", e.target.value)} rows={3} className="font-mono text-[11px]" placeholder="{{input.text}}" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Temperature</Label>
                    <Input type="number" step="0.1" min="0" max="2" value={(config.temperature as number) ?? 0.7} onChange={(e) => updateConfig("temperature", parseFloat(e.target.value))} className="h-7 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Max Tokens</Label>
                    <Input type="number" min="1" value={(config.maxTokens as number) ?? 4096} onChange={(e) => updateConfig("maxTokens", parseInt(e.target.value))} className="h-7 text-xs" />
                  </div>
                </div>
              </>
            )}

            {nodeType === "condition" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Expression</Label>
                <Textarea value={(config.expression as string) || ""} onChange={(e) => updateConfig("expression", e.target.value)} rows={2} className="font-mono text-[11px]" placeholder={'{{reviewer.response}} contains "high risk"'} />
                <p className="text-[10px] text-muted-foreground">Operators: contains, equals, greater_than, less_than, is_empty</p>
              </div>
            )}

            {nodeType === "switch" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Value to evaluate</Label>
                  <Input value={(config.value as string) || ""} onChange={(e) => updateConfig("value", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{classifier.category}}" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Default case</Label>
                  <Input value={(config.defaultCase as string) || ""} onChange={(e) => updateConfig("defaultCase", e.target.value)} className="h-8 text-xs" placeholder="default" />
                </div>
              </>
            )}

            {nodeType === "loop" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Mode</Label>
                  <Select value={(config.mode as string) || "while"} onChange={(e) => updateConfig("mode", e.target.value)} className="text-xs">
                    <option value="while">While condition</option>
                    <option value="for_count">Fixed count</option>
                  </Select>
                </div>
                {(config.mode || "while") === "while" && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Condition</Label>
                    <Input value={(config.condition as string) || ""} onChange={(e) => updateConfig("condition", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{_loop.counter}} less_than 5" />
                  </div>
                )}
                {config.mode === "for_count" && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Count</Label>
                    <Input type="number" min="1" value={(config.maxCount as number) ?? 5} onChange={(e) => updateConfig("maxCount", parseInt(e.target.value))} className="h-7 text-xs" />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-[11px]">Max iterations (safety)</Label>
                  <Input type="number" min="1" max="1000" value={(config.maxIterations as number) ?? 100} onChange={(e) => updateConfig("maxIterations", parseInt(e.target.value))} className="h-7 text-xs" />
                </div>
              </>
            )}

            {nodeType === "iteration" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Array path</Label>
                  <Input value={(config.arrayPath as string) || ""} onChange={(e) => updateConfig("arrayPath", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{input.documents}}" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Parallel</Label>
                    <Select value={config.parallel ? "true" : "false"} onChange={(e) => updateConfig("parallel", e.target.value === "true")} className="text-xs">
                      <option value="false">Sequential</option>
                      <option value="true">Parallel</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Batch size</Label>
                    <Input type="number" min="1" max="50" value={(config.batchSize as number) ?? 5} onChange={(e) => updateConfig("batchSize", parseInt(e.target.value))} className="h-7 text-xs" />
                  </div>
                </div>
              </>
            )}

            {nodeType === "delay" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Delay (ms)</Label>
                <Input type="number" min="0" max="300000" value={(config.delayMs as number) ?? 1000} onChange={(e) => updateConfig("delayMs", parseInt(e.target.value))} className="h-7 text-xs" />
                <p className="text-[10px] text-muted-foreground">Max 300,000ms (5 min)</p>
              </div>
            )}

            {nodeType === "http_request" && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Method</Label>
                    <Select value={(config.method as string) || "GET"} onChange={(e) => updateConfig("method", e.target.value)} className="text-xs">
                      <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-[11px]">URL</Label>
                    <Input value={(config.url as string) || ""} onChange={(e) => updateConfig("url", e.target.value)} className="h-8 text-xs font-mono" placeholder="https://api.example.com/data" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Body (JSON template)</Label>
                  <Textarea value={(config.body as string) || ""} onChange={(e) => updateConfig("body", e.target.value)} rows={3} className="font-mono text-[11px]" placeholder='{"query": "{{input.text}}"}' />
                </div>
              </>
            )}

            {nodeType === "code" && (
              <div className="space-y-1">
                <Label className="text-[11px]">JavaScript code</Label>
                <Textarea value={(config.code as string) || ""} onChange={(e) => updateConfig("code", e.target.value)} rows={6} className="font-mono text-[11px]" placeholder={"const items = JSON.parse(state.input.data);\nreturn { count: items.length };"} />
                <p className="text-[10px] text-muted-foreground">Receives `state` object. Return a plain object. 5s timeout.</p>
              </div>
            )}

            {nodeType === "sub_workflow" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Workflow ID</Label>
                <Input value={(config.workflowId as string) || ""} onChange={(e) => updateConfig("workflowId", e.target.value)} className="h-8 text-xs font-mono" placeholder="UUID of target workflow" />
              </div>
            )}

            {nodeType === "knowledge_search" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Knowledge Base ID</Label>
                  <Input value={(config.knowledgeBaseId as string) || ""} onChange={(e) => updateConfig("knowledgeBaseId", e.target.value)} className="h-8 text-xs font-mono" placeholder="UUID of knowledge base" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Query template</Label>
                  <Input value={(config.query as string) || ""} onChange={(e) => updateConfig("query", e.target.value)} className="h-8 text-xs font-mono" placeholder="{{input.question}}" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Max results</Label>
                  <Input type="number" min="1" max="50" value={(config.topK as number) ?? 5} onChange={(e) => updateConfig("topK", parseInt(e.target.value))} className="h-7 text-xs" />
                </div>
              </>
            )}

            {nodeType === "tool" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Tool name</Label>
                  <Input value={(config.toolName as string) || ""} onChange={(e) => updateConfig("toolName", e.target.value)} className="h-8 text-xs font-mono" placeholder="read_file, web_fetch, etc." />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Arguments (JSON)</Label>
                  <Textarea
                    value={JSON.stringify(config.arguments || {}, null, 2)}
                    onChange={(e) => { try { updateConfig("arguments", JSON.parse(e.target.value)); } catch {} }}
                    rows={3} className="font-mono text-[11px]"
                    placeholder={'{"path": "{{input.filePath}}"}'}
                  />
                </div>
              </>
            )}

            {nodeType === "human_review" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[11px]">Prompt</Label>
                  <Textarea value={(config.prompt as string) || ""} onChange={(e) => updateConfig("prompt", e.target.value)} rows={2} className="text-[11px]" placeholder="Please review and approve." />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Review type</Label>
                  <Select value={(config.reviewType as string) || "approve_deny"} onChange={(e) => updateConfig("reviewType", e.target.value)} className="text-xs">
                    <option value="approve_deny">Approve / Deny</option>
                    <option value="choice">Multiple choice</option>
                    <option value="form">Custom form</option>
                  </Select>
                </div>
              </>
            )}

            {nodeType === "transform" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Mappings (JSON)</Label>
                <Textarea
                  value={JSON.stringify(config.mappings || [], null, 2)}
                  onChange={(e) => { try { updateConfig("mappings", JSON.parse(e.target.value)); } catch {} }}
                  rows={4} className="font-mono text-[11px]"
                  placeholder={'[{"key":"summary","value":"{{agent.response}}"}]'}
                />
              </div>
            )}

            {nodeType === "aggregate" && (
              <div className="space-y-1">
                <Label className="text-[11px]">Strategy</Label>
                <Select value={(config.strategy as string) || "merge"} onChange={(e) => updateConfig("strategy", e.target.value)} className="text-xs">
                  <option value="merge">Merge (shallow)</option>
                  <option value="array">Collect as array</option>
                  <option value="first">First result</option>
                </Select>
              </div>
            )}
          </>
        )}

        {tab === "error" && (
          <>
            <div className="space-y-1">
              <Label className="text-[11px]">On Error</Label>
              <Select value={(errorPolicy.onError as string) || "stop"} onChange={(e) => updateErrorPolicy("onError", e.target.value)} className="text-xs">
                <option value="stop">Stop workflow</option>
                <option value="continue">Continue (skip)</option>
                <option value="error_branch">Route to error branch</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Max Retries</Label>
              <Input type="number" min="0" max="10" value={(errorPolicy.maxRetries as number) ?? 0} onChange={(e) => updateErrorPolicy("maxRetries", parseInt(e.target.value))} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Retry Delay (ms)</Label>
              <Input type="number" min="100" max="60000" value={(errorPolicy.retryDelayMs as number) ?? 1000} onChange={(e) => updateErrorPolicy("retryDelayMs", parseInt(e.target.value))} className="h-7 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Backoff</Label>
              <Select value={(errorPolicy.retryBackoff as string) || "fixed"} onChange={(e) => updateErrorPolicy("retryBackoff", e.target.value)} className="text-xs">
                <option value="fixed">Fixed delay</option>
                <option value="exponential">Exponential</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Timeout (ms)</Label>
              <Input type="number" min="0" max="600000" value={(errorPolicy.timeoutMs as number) ?? 0} onChange={(e) => updateErrorPolicy("timeoutMs", parseInt(e.target.value))} className="h-7 text-xs" />
              <p className="text-[10px] text-muted-foreground">0 = no timeout (uses workflow default)</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Canvas Component
// ---------------------------------------------------------------------------

export function WorkflowCanvas({
  nodes: wfNodes,
  edges: wfEdges,
  agents,
  models = [],
  onSave,
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  agents: Agent[];
  models?: ProviderModel[];
  onSave: (nodes: WorkflowNode[], edges: Array<{ fromNodeId: string; toNodeId: string; conditionExpr?: string; conditionLabel?: string; edgeType?: string }>) => Promise<void>;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(wfNodes, agents));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(wfEdges));
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    setNodes(toFlowNodes(wfNodes, agents));
    setEdges(toFlowEdges(wfEdges));
    setHasChanges(false);
  }, [wfNodes, wfEdges, agents, setNodes, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    const style = EDGE_STYLES.normal;
    setEdges((eds) => addEdge({
      ...connection, animated: style.animated,
      style: { strokeWidth: 2, stroke: style.stroke },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: style.stroke },
    }, eds));
    setHasChanges(true);
  }, [setEdges]);

  const onNodeDragStop = useCallback(() => setHasChanges(true), []);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  function handleAddNodeFromPalette(nodeType: string) {
    const def = NODE_REGISTRY.find((n) => n.type === nodeType);
    if (!def) return;
    const newNode: Node = {
      id: `temp-${Date.now()}`,
      type: "custom",
      position: { x: 250, y: nodes.length * 140 + 50 },
      data: { label: def.label, nodeType: def.type, config: {}, errorPolicy: {} },
    };
    setNodes((nds) => [...nds, newNode]);
    setHasChanges(true);
    setSelectedNodeId(newNode.id);
  }

  function handleUpdateNode(id: string, data: Record<string, unknown>) {
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data } : n));
    setHasChanges(true);
  }

  function handleDeleteNode(id: string) {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
    setHasChanges(true);
  }

  async function handleSave() {
    setSaving(true);
    const updatedNodes: WorkflowNode[] = nodes.map((n) => {
      const d = n.data as Record<string, unknown>;
      return {
        id: n.id,
        nodeType: d.nodeType as string,
        name: (d.label as string) || "",
        config: (d.config as Record<string, unknown>) || {},
        errorPolicy: (d.errorPolicy as Record<string, unknown>) || undefined,
        positionX: n.position.x,
        positionY: n.position.y,
      };
    });
    const updatedEdges = edges.map((e) => ({
      fromNodeId: e.source,
      toNodeId: e.target,
      conditionLabel: (e.label as string) || undefined,
      edgeType: e.style?.stroke === EDGE_STYLES.error.stroke ? "error"
        : e.style?.stroke === EDGE_STYLES.loop_body.stroke ? "loop_body" : "normal",
    }));
    await onSave(updatedNodes, updatedEdges);
    setHasChanges(false);
    setSaving(false);
  }

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  return (
    <div className="border border-border rounded-xl overflow-hidden flex" style={{ height: 640 }}>
      <NodePalette onAdd={handleAddNodeFromPalette} />

      <div className="flex-1 flex flex-col relative">
        {hasChanges && (
          <div className="absolute top-3 right-3 z-10">
            <Button size="sm" onClick={handleSave} disabled={saving} className="shadow-md">
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              Save
            </Button>
          </div>
        )}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={["Backspace", "Delete"]}
            snapToGrid
            snapGrid={[20, 20]}
            defaultEdgeOptions={{
              style: { strokeWidth: 2, stroke: "#9ca3af" },
              markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#9ca3af" },
            }}
          >
            <Background gap={24} size={1.2} color="#e2e8f0" />
            <Controls showInteractive={false} className="!rounded-lg !border-border !shadow-sm" />
            <MiniMap
              nodeColor={(n) => NODE_COLOR_MAP[(n.data as Record<string, unknown>).nodeType as string] || "#6b7280"}
              maskColor="rgba(0,0,0,0.08)"
              className="!rounded-lg !border-border !shadow-sm"
              style={{ height: 90, width: 140 }}
            />
          </ReactFlow>
        </div>
      </div>

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          agents={agents}
          models={models}
          onUpdate={handleUpdateNode}
          onClose={() => setSelectedNodeId(null)}
          onDelete={handleDeleteNode}
        />
      )}
    </div>
  );
}
