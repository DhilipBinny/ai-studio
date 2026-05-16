import {
  Play, Flag, GitBranch, Route, Repeat, Layers, Timer, Workflow,
  Bot, Sparkles, Search, Wrench, Globe, Code, ArrowLeftRight,
  Combine, UserCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Node Type Registry
// ---------------------------------------------------------------------------

export type PortType = "single" | "condition" | "switch" | "loop";

export interface NodeTypeDef {
  type: string;
  label: string;
  category: "flow" | "ai" | "action" | "data" | "human";
  color: string;
  icon: LucideIcon;
  description: string;
  ports: PortType;
}

export const NODE_REGISTRY: NodeTypeDef[] = [
  { type: "input",            label: "Input",            category: "flow",   color: "#3b82f6", icon: Play,           description: "Entry point — passes trigger data",       ports: "single" },
  { type: "output",           label: "Output",           category: "flow",   color: "#10b981", icon: Flag,           description: "Terminal — formats final result",          ports: "single" },
  { type: "condition",        label: "Condition",        category: "flow",   color: "#f59e0b", icon: GitBranch,      description: "If/else branch on expression",             ports: "condition" },
  { type: "switch",           label: "Switch",           category: "flow",   color: "#ea580c", icon: Route,          description: "Multi-branch routing by value",            ports: "switch" },
  { type: "loop",             label: "Loop",             category: "flow",   color: "#6366f1", icon: Repeat,         description: "Repeat until condition met",                ports: "loop" },
  { type: "iteration",        label: "Iteration",        category: "flow",   color: "#7c3aed", icon: Layers,         description: "Process array items",                      ports: "single" },
  { type: "delay",            label: "Delay",            category: "flow",   color: "#94a3b8", icon: Timer,          description: "Wait for specified duration",               ports: "single" },
  { type: "sub_workflow",     label: "Sub-Workflow",     category: "flow",   color: "#0284c7", icon: Workflow,       description: "Execute another workflow",                  ports: "single" },
  { type: "agent",            label: "Agent",            category: "ai",     color: "#9333ea", icon: Bot,            description: "Full agent session with tools",             ports: "single" },
  { type: "llm",              label: "LLM",              category: "ai",     color: "#c026d3", icon: Sparkles,       description: "Direct LLM call — prompt in, text out",    ports: "single" },
  { type: "knowledge_search", label: "Knowledge Search", category: "ai",     color: "#db2777", icon: Search,         description: "Query knowledge base (RAG)",               ports: "single" },
  { type: "tool",             label: "Tool",             category: "action", color: "#0d9488", icon: Wrench,         description: "Execute a tool directly",                  ports: "single" },
  { type: "http_request",     label: "HTTP Request",     category: "action", color: "#0891b2", icon: Globe,          description: "Call an external API",                     ports: "single" },
  { type: "code",             label: "Code",             category: "action", color: "#475569", icon: Code,           description: "Run sandboxed JavaScript",                 ports: "single" },
  { type: "transform",        label: "Transform",        category: "data",   color: "#0e7490", icon: ArrowLeftRight, description: "Map/reshape data",                         ports: "single" },
  { type: "aggregate",        label: "Aggregate",        category: "data",   color: "#059669", icon: Combine,        description: "Merge parallel branch outputs",            ports: "single" },
  { type: "human_review",     label: "Human Review",     category: "human",  color: "#dc2626", icon: UserCheck,      description: "Pause for human decision",                 ports: "single" },
];

export const NODE_COLOR_MAP: Record<string, string> = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.color]));
export const NODE_LABEL_MAP: Record<string, string> = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.label]));
export const NODE_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.icon]));
export const NODE_PORTS_MAP: Record<string, PortType> = Object.fromEntries(NODE_REGISTRY.map((n) => [n.type, n.ports]));

export const CATEGORY_LABELS: Record<string, string> = {
  flow: "Flow Control",
  ai: "AI",
  action: "Action",
  data: "Data",
  human: "Human",
};

// ---------------------------------------------------------------------------
// Edge Styles
// ---------------------------------------------------------------------------

export const DEFAULT_EDGE_TYPE = "smoothstep";

export const EDGE_STYLES: Record<string, {
  stroke: string;
  strokeDasharray?: string;
  animated: boolean;
  label?: string;
}> = {
  normal:          { stroke: "#94a3b8", animated: false },
  error:           { stroke: "#ef4444", strokeDasharray: "6,4", animated: false, label: "error" },
  condition_true:  { stroke: "#22c55e", animated: false, label: "true" },
  condition_false: { stroke: "#f97316", animated: false, label: "false" },
  switch_case:     { stroke: "#94a3b8", animated: false },
  switch_default:  { stroke: "#64748b", strokeDasharray: "6,4", animated: false },
  loop_body:       { stroke: "#6366f1", animated: true, label: "body" },
  loop_back:       { stroke: "#6366f1", strokeDasharray: "4,4", animated: false, label: "back" },
  loop_done:       { stroke: "#10b981", animated: false, label: "done" },
};
