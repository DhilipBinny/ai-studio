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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Save, Loader2 } from "lucide-react";

interface WorkflowNode {
  id: string;
  nodeType: string;
  name: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionLabel: string | null;
  conditionExpr: string | null;
  sortOrder: number;
}

interface Agent {
  id: string;
  name: string;
}

const NODE_COLORS: Record<string, string> = {
  input: "#3b82f6",
  agent: "#8b5cf6",
  condition: "#f59e0b",
  transform: "#06b6d4",
  human_review: "#ef4444",
  output: "#22c55e",
};

const NODE_LABELS: Record<string, string> = {
  input: "Input",
  agent: "Agent",
  condition: "Condition",
  transform: "Transform",
  human_review: "Review",
  output: "Output",
};

function CustomNode({ data }: { data: { label: string; nodeType: string; config: Record<string, unknown>; agentName?: string } }) {
  const color = NODE_COLORS[data.nodeType] || "#6b7280";

  return (
    <div className="rounded-lg border-2 bg-card shadow-md min-w-[180px]" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
      <div className="px-3 py-1.5 rounded-t-md text-white text-[10px] font-semibold uppercase tracking-wider" style={{ backgroundColor: color }}>
        {NODE_LABELS[data.nodeType] || data.nodeType}
      </div>
      <div className="px-3 py-2">
        <div className="text-sm font-medium">{data.label}</div>
        {data.nodeType === "agent" && data.agentName && (
          <div className="text-[11px] text-muted-foreground mt-0.5">{data.agentName}</div>
        )}
        {data.nodeType === "agent" && data.config?.message && (
          <div className="text-[10px] text-muted-foreground mt-1 font-mono bg-muted/50 rounded px-1.5 py-0.5 truncate max-w-[200px]">
            {String(data.config.message).slice(0, 60)}
          </div>
        )}
        {data.nodeType === "condition" && data.config?.expression && (
          <div className="text-[10px] text-muted-foreground mt-1 font-mono bg-amber-50 dark:bg-amber-950/30 rounded px-1.5 py-0.5">
            {String(data.config.expression).slice(0, 50)}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white" />
    </div>
  );
}

const nodeTypes: NodeTypes = { custom: CustomNode };

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
  return wfEdges.map((e) => ({
    id: e.id,
    source: e.fromNodeId,
    target: e.toNodeId,
    label: e.conditionLabel || undefined,
    animated: true,
    style: { strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  }));
}

export function WorkflowCanvas({
  nodes: wfNodes,
  edges: wfEdges,
  agents,
  onSave,
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  agents: Agent[];
  onSave: (nodes: WorkflowNode[], edges: Array<{ fromNodeId: string; toNodeId: string; conditionExpr?: string; conditionLabel?: string }>) => Promise<void>;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(wfNodes, agents));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(wfEdges));
  const [showAddNode, setShowAddNode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setNodes(toFlowNodes(wfNodes, agents));
    setEdges(toFlowEdges(wfEdges));
    setHasChanges(false);
  }, [wfNodes, wfEdges, agents, setNodes, setEdges]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, animated: true, style: { strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }, eds));
    setHasChanges(true);
  }, [setEdges]);

  const onNodeDragStop = useCallback(() => {
    setHasChanges(true);
  }, []);

  async function handleSave() {
    setSaving(true);
    const updatedNodes: WorkflowNode[] = nodes.map((n) => ({
      id: n.id,
      nodeType: (n.data as Record<string, unknown>).nodeType as string,
      name: (n.data as Record<string, unknown>).label as string,
      config: (n.data as Record<string, unknown>).config as Record<string, unknown>,
      positionX: n.position.x,
      positionY: n.position.y,
    }));
    const updatedEdges = edges.map((e) => ({
      fromNodeId: e.source,
      toNodeId: e.target,
      conditionLabel: (e.label as string) || undefined,
    }));
    await onSave(updatedNodes, updatedEdges);
    setHasChanges(false);
    setSaving(false);
  }

  function handleAddNode(nodeData: { nodeType: string; name: string; config: Record<string, unknown> }) {
    const newNode: Node = {
      id: `temp-${Date.now()}`,
      type: "custom",
      position: { x: 250, y: (nodes.length) * 150 },
      data: {
        label: nodeData.name,
        nodeType: nodeData.nodeType,
        config: nodeData.config,
        agentName: nodeData.nodeType === "agent" ? agents.find((a) => a.id === (nodeData.config as Record<string, unknown>).agentId)?.name : undefined,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setHasChanges(true);
    setShowAddNode(false);
  }

  return (
    <div className="border rounded-lg overflow-hidden" style={{ height: 500 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-muted-foreground">{NODE_LABELS[type]}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddNode(true)}><Plus className="h-3 w-3 mr-1" /> Node</Button>
          {hasChanges && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
              Save
            </Button>
          )}
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: true, style: { strokeWidth: 2 } }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={(n) => NODE_COLORS[(n.data as Record<string, unknown>).nodeType as string] || "#6b7280"} style={{ height: 80 }} />
      </ReactFlow>

      <Dialog open={showAddNode} onOpenChange={setShowAddNode} size="xl">
        <DialogContent onClose={() => setShowAddNode(false)}>
          <DialogHeader><DialogTitle>Add Node</DialogTitle></DialogHeader>
          <AddNodeForm agents={agents} onAdd={handleAddNode} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddNodeForm({ agents, onAdd }: { agents: Agent[]; onAdd: (data: { nodeType: string; name: string; config: Record<string, unknown> }) => void }) {
  const [form, setForm] = useState({ nodeType: "agent", name: "", agentId: "", message: "", expression: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    const config: Record<string, unknown> = {};
    if (form.nodeType === "agent") { config.agentId = form.agentId; config.message = form.message; }
    if (form.nodeType === "condition") { config.expression = form.expression; }
    onAdd({ nodeType: form.nodeType, name: form.name, config });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={form.nodeType} onChange={(e) => setForm((f) => ({ ...f, nodeType: e.target.value }))}>
            {Object.entries(NODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Name <span className="text-destructive">*</span></Label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Reviewer" />
        </div>
      </div>
      {form.nodeType === "agent" && (
        <>
          <div className="space-y-2">
            <Label>Agent</Label>
            <Select value={form.agentId} onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}>
              <option value="">Select agent...</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Message template</Label>
            <Textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={2} className="font-mono text-xs" placeholder="Summarize: {{input.text}}" />
          </div>
        </>
      )}
      {form.nodeType === "condition" && (
        <div className="space-y-2">
          <Label>Expression</Label>
          <Input value={form.expression} onChange={(e) => setForm((f) => ({ ...f, expression: e.target.value }))} className="font-mono text-xs" placeholder='{{reviewer.response}} contains "high risk"' />
        </div>
      )}
      <Button type="submit" className="w-full" disabled={!form.name}>Add Node</Button>
    </form>
  );
}
