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
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";

import type { WorkflowNode, WorkflowEdge, AgentSummary, ProviderModel } from "@ais-app/types";

import { NODE_REGISTRY, NODE_COLOR_MAP, EDGE_STYLES } from "./canvas-types";
import { CustomNode } from "./canvas-node";
import { NodePalette } from "./node-palette";
import { NodeConfigPanel } from "./node-config-panel";

type Agent = AgentSummary;

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

const nodeTypes: NodeTypes = { custom: CustomNode };

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
