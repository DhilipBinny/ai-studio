"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  SelectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type FinalConnectionState,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import {
  Save, Loader2, Undo2, Redo2, LayoutGrid,
  Search, ChevronUp, ChevronDown, X, DollarSign, Plus,
} from "lucide-react";
import { Graph, layout } from "@dagrejs/dagre";

import type { WorkflowNode, WorkflowEdge, AgentSummary, ProviderModel } from "@ais-app/types";

import { NODE_REGISTRY, NODE_COLOR_MAP, NODE_LABEL_MAP, EDGE_STYLES, DEFAULT_EDGE_TYPE } from "./canvas-types";
import { CustomNode, type DetailLevel, type RunCostData } from "./canvas-node";
import { NodePalette } from "./node-palette";
import { NodeConfigPanel } from "./node-config-panel";
import { useUndoRedo, type CanvasState } from "./use-undo-redo";

type Agent = AgentSummary;

// ---------------------------------------------------------------------------
// Run Step type for execution visualization
// ---------------------------------------------------------------------------

interface RunStep {
  nodeId: string;
  status: string;
  durationMs?: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Ghost Node Suggestion — suggests the next logical node type
// ---------------------------------------------------------------------------

function suggestNextNode(sourceNodeType: string): string {
  const suggestions: Record<string, string> = {
    input: "llm",
    llm: "transform",
    agent: "condition",
    condition: "llm",
    transform: "output",
    http_request: "condition",
    code: "transform",
    knowledge_search: "llm",
  };
  return suggestions[sourceNodeType] || "transform";
}

interface GhostSuggestion {
  position: { x: number; y: number };
  suggestedType: string;
  sourceNodeId: string;
  sourceHandle: string;
}

// ---------------------------------------------------------------------------
// Semantic zoom — compute detail level from zoom, only on threshold change
// ---------------------------------------------------------------------------

function computeDetailLevel(zoom: number): DetailLevel {
  if (zoom > 0.75) return "full";
  if (zoom > 0.3) return "compact";
  return "dot";
}

// ---------------------------------------------------------------------------
// Source Handle Resolution (for loading existing edges)
// ---------------------------------------------------------------------------

function resolveSourceHandle(sourceNode: WorkflowNode | undefined, edge: WorkflowEdge): string {
  if (!sourceNode) return "source";

  switch (sourceNode.nodeType) {
    case "condition":
      if (edge.conditionLabel?.toLowerCase() === "false" || edge.edgeType === "condition_false") {
        return "source-false";
      }
      return "source-true";
    case "switch":
      if (edge.edgeType === "switch_default" || edge.conditionLabel?.toLowerCase() === "default") {
        return "source-default";
      }
      return `source-case-${edge.sortOrder}`;
    case "loop":
      if (edge.edgeType === "loop_done") return "source-loop-done";
      if (edge.edgeType === "loop_back") return "source-loop-back";
      if (edge.edgeType === "loop_body") return "source-loop-body";
      return "source-loop-body";
    default:
      return "source";
  }
}

// ---------------------------------------------------------------------------
// Edge Type Inference from Source Handle
// ---------------------------------------------------------------------------

function inferEdgeTypeFromHandle(sourceHandle: string | null | undefined): string {
  if (!sourceHandle) return "normal";
  if (sourceHandle === "source-true") return "condition_true";
  if (sourceHandle === "source-false") return "condition_false";
  if (sourceHandle.startsWith("source-case-")) return "normal";
  if (sourceHandle === "source-default") return "normal";
  if (sourceHandle === "source-loop-body") return "loop_body";
  if (sourceHandle === "source-loop-back") return "loop_back";
  if (sourceHandle === "source-loop-done") return "loop_done";
  return "normal";
}

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

function toFlowEdges(wfEdges: WorkflowEdge[], wfNodes: WorkflowNode[]): Edge[] {
  return wfEdges.map((e) => {
    const edgeType = e.edgeType || "normal";
    const style = EDGE_STYLES[edgeType] || EDGE_STYLES.normal;

    // Resolve source/target handles
    const sourceNode = wfNodes.find((n) => n.id === e.fromNodeId);
    const sourceHandle = resolveSourceHandle(sourceNode, e);
    const targetHandle = "target";

    // Determine label: use conditionLabel from DB, or fallback to style label
    const label = e.conditionLabel || style.label || undefined;

    return {
      id: e.id,
      source: e.fromNodeId,
      target: e.toNodeId,
      sourceHandle,
      targetHandle,
      type: DEFAULT_EDGE_TYPE,
      label,
      animated: style.animated,
      style: { strokeWidth: 2, stroke: style.stroke, strokeDasharray: style.strokeDasharray },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: style.stroke },
      labelStyle: { fontSize: 10, fontWeight: 500, fill: style.stroke },
      labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 4,
    };
  });
}

const nodeTypes: NodeTypes = { custom: CustomNode };

// ---------------------------------------------------------------------------
// Auto-Layout using dagre
// ---------------------------------------------------------------------------

const NODE_WIDTH = 240;
const NODE_BASE_HEIGHT = 72;

function autoLayoutNodes(currentNodes: Node[], currentEdges: Edge[]): Node[] {
  if (currentNodes.length === 0) return currentNodes;

  const g = new Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 60,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });

  currentNodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_BASE_HEIGHT });
  });

  currentEdges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  layout(g);

  return currentNodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    return {
      ...node,
      position: {
        x: (pos.x ?? 0) - NODE_WIDTH / 2,
        y: (pos.y ?? 0) - NODE_BASE_HEIGHT / 2,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Merge run step data into flow nodes for execution visualization
// ---------------------------------------------------------------------------

function mergeRunStatus(flowNodes: Node[], steps: RunStep[]): Node[] {
  if (steps.length === 0) return flowNodes;
  const stepMap = new Map(steps.map((s) => [s.nodeId, s]));
  return flowNodes.map((n) => {
    const step = stepMap.get(n.id);
    if (!step) return n;
    return {
      ...n,
      data: {
        ...n.data,
        runStatus: step.status,
        runDuration: step.durationMs,
        errorMessage: step.errorMessage,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Apply execution animation to edges between completed nodes
// ---------------------------------------------------------------------------

function mergeRunEdges(flowEdges: Edge[], steps: RunStep[]): Edge[] {
  if (steps.length === 0) return flowEdges;
  const completedNodeIds = new Set(
    steps.filter((s) => s.status === "completed" || s.status === "running").map((s) => s.nodeId)
  );
  return flowEdges.map((e) => {
    if (completedNodeIds.has(e.source) && completedNodeIds.has(e.target)) {
      return { ...e, animated: true };
    }
    return e;
  });
}

// ---------------------------------------------------------------------------
// Custom Hook: useCanvasSearch — search state, filter, navigate
// ---------------------------------------------------------------------------

function useCanvasSearch(nodes: Node[], setCenter: (x: number, y: number, opts: { duration: number; zoom: number }) => void) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return nodes.filter((n) => {
      const d = n.data as Record<string, unknown>;
      const label = (d.label as string) || "";
      const nodeType = (d.nodeType as string) || "";
      return label.toLowerCase().includes(q) || nodeType.toLowerCase().includes(q);
    });
  }, [nodes, searchQuery]);

  const searchMatchIds = useMemo(() => new Set(searchResults.map((n) => n.id)), [searchResults]);

  // Clamp search index when results change
  useEffect(() => {
    if (searchResults.length > 0 && searchIndex >= searchResults.length) {
      setSearchIndex(0);
    }
  }, [searchResults, searchIndex]);

  const navigateSearchNext = useCallback(() => {
    if (searchResults.length === 0) return;
    const nextIndex = (searchIndex + 1) % searchResults.length;
    setSearchIndex(nextIndex);
    const node = searchResults[nextIndex];
    if (node) {
      setCenter(node.position.x + 120, node.position.y + 36, { duration: 300, zoom: 1.2 });
    }
  }, [searchResults, searchIndex, setCenter]);

  const navigateSearchPrev = useCallback(() => {
    if (searchResults.length === 0) return;
    const prevIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
    setSearchIndex(prevIndex);
    const node = searchResults[prevIndex];
    if (node) {
      setCenter(node.position.x + 120, node.position.y + 36, { duration: 300, zoom: 1.2 });
    }
  }, [searchResults, searchIndex, setCenter]);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchIndex(0);
  }, []);

  const openSearch = useCallback(() => {
    setShowSearch(true);
    // Focus the input after render
    setTimeout(() => searchInputRef.current?.focus(), 0);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        navigateSearchPrev();
      } else {
        navigateSearchNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }, [navigateSearchNext, navigateSearchPrev, closeSearch]);

  return {
    showSearch, searchQuery, setSearchQuery, searchIndex, setSearchIndex,
    searchInputRef, searchResults, searchMatchIds,
    navigateSearchNext, navigateSearchPrev, closeSearch, openSearch, handleSearchKeyDown,
  };
}

// ---------------------------------------------------------------------------
// Custom Hook: useCopyPaste — clipboard, copy, paste
// ---------------------------------------------------------------------------

function useCopyPaste(
  nodesRef: React.RefObject<Node[]>,
  edgesRef: React.RefObject<Edge[]>,
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
  pushCurrentState: () => void,
  markDirty: () => void,
) {
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  const handleCopy = useCallback(() => {
    const selectedNodes = nodesRef.current.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const selectedEdges = edgesRef.current.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    );
    clipboardRef.current = { nodes: selectedNodes, edges: selectedEdges };
  }, [nodesRef, edgesRef]);

  const handlePaste = useCallback(() => {
    if (!clipboardRef.current) return;
    const { nodes: copiedNodes, edges: copiedEdges } = clipboardRef.current;

    pushCurrentState();

    const idMap = new Map<string, string>();
    copiedNodes.forEach((n) => {
      idMap.set(n.id, `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    });

    const newNodes = copiedNodes.map((n) => ({
      ...n,
      id: idMap.get(n.id) as string,
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      selected: true,
    }));

    const newEdges = copiedEdges.map((e) => ({
      ...e,
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
    }));

    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      ...newNodes,
    ]);
    setEdges((eds) => [...eds, ...newEdges]);
    markDirty();
  }, [setNodes, setEdges, markDirty, pushCurrentState]);

  return { handleCopy, handlePaste };
}

// ---------------------------------------------------------------------------
// Custom Hook: useCanvasKeyboard — keyboard event listener
// ---------------------------------------------------------------------------

function useCanvasKeyboard(handlers: {
  handleUndo: () => void;
  handleRedo: () => void;
  handleCopy: () => void;
  handlePaste: () => void;
  handleSelectAll: () => void;
  handleSave: () => Promise<void>;
  openSearch: () => void;
  hasChangesRef: React.RefObject<boolean>;
}) {
  const { handleUndo, handleRedo, handleCopy, handlePaste, handleSelectAll, handleSave, openSearch, hasChangesRef } = handlers;

  useEffect(() => {
    const shortcuts: Array<{
      key: string;
      ctrl: boolean;
      shift: boolean;
      handler: () => void;
    }> = [
      { key: "z", ctrl: true, shift: false, handler: handleUndo },
      { key: "z", ctrl: true, shift: true, handler: handleRedo },
      { key: "c", ctrl: true, shift: false, handler: handleCopy },
      { key: "v", ctrl: true, shift: false, handler: handlePaste },
      { key: "a", ctrl: true, shift: false, handler: handleSelectAll },
      { key: "s", ctrl: true, shift: false, handler: () => { if (hasChangesRef.current) handleSave(); } },
      { key: "f", ctrl: true, shift: false, handler: openSearch },
    ];

    const listener = (e: KeyboardEvent) => {
      // Allow Ctrl+F even inside search input
      if (e.key === "f" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      const match = shortcuts.find(
        (s) => s.key === e.key && s.ctrl === (e.ctrlKey || e.metaKey) && s.shift === e.shiftKey
      );
      if (match) {
        e.preventDefault();
        match.handler();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handleUndo, handleRedo, handleCopy, handlePaste, handleSelectAll, handleSave, openSearch, hasChangesRef]);
}

// ---------------------------------------------------------------------------
// Sub-component: CanvasToolbar
// ---------------------------------------------------------------------------

function CanvasToolbar({
  canUndo, canRedo, hasChanges, saving, showCostOverlay,
  handleUndo, handleRedo, handleAutoLayout, openSearch,
  setShowCostOverlay, handleSave,
}: {
  canUndo: boolean;
  canRedo: boolean;
  hasChanges: boolean;
  saving: boolean;
  showCostOverlay: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
  handleAutoLayout: () => void;
  openSearch: () => void;
  setShowCostOverlay: (fn: (prev: boolean) => boolean) => void;
  handleSave: () => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-muted/20">
      <Button variant="ghost" size="sm" onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="h-7 w-7 p-0">
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" className="h-7 w-7 p-0">
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button variant="ghost" size="sm" onClick={handleAutoLayout} title="Auto Layout" className="h-7 gap-1 px-2">
        <LayoutGrid className="h-3.5 w-3.5" />
        <span className="text-xs">Tidy Up</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button variant="ghost" size="sm" onClick={openSearch} title="Search (Ctrl+F)" className="h-7 gap-1 px-2">
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Search</span>
      </Button>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        variant={showCostOverlay ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setShowCostOverlay((prev) => !prev)}
        title="Show Costs"
        className="h-7 gap-1 px-2"
      >
        <DollarSign className="h-3.5 w-3.5" />
        <span className="text-xs">Costs</span>
      </Button>
      <div className="flex-1" />
      {hasChanges && (
        <Button size="sm" onClick={handleSave} disabled={saving} className="h-7">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          Save
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: CanvasSearchBar
// ---------------------------------------------------------------------------

function CanvasSearchBar({
  searchQuery, setSearchQuery, searchIndex, setSearchIndex,
  searchInputRef, searchResults, handleSearchKeyDown,
  navigateSearchPrev, navigateSearchNext, closeSearch,
}: {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchIndex: number;
  setSearchIndex: (i: number) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchResults: Node[];
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  navigateSearchPrev: () => void;
  navigateSearchNext: () => void;
  closeSearch: () => void;
}) {
  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5 shadow-lg">
      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <input
        ref={searchInputRef}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setSearchIndex(0);
        }}
        onKeyDown={handleSearchKeyDown}
        placeholder="Search nodes..."
        className="bg-transparent border-none text-sm w-48 focus:outline-none"
        autoFocus
      />
      {searchQuery.trim() && (
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {searchResults.length > 0 ? `${searchIndex + 1}/${searchResults.length}` : "0/0"}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={navigateSearchPrev}
        disabled={searchResults.length === 0}
        className="h-6 w-6 p-0"
        aria-label="Previous match"
      >
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={navigateSearchNext}
        disabled={searchResults.length === 0}
        className="h-6 w-6 p-0"
        aria-label="Next match"
      >
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={closeSearch}
        className="h-6 w-6 p-0"
        aria-label="Close search"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas Inner (uses useReactFlow — must be inside ReactFlowProvider)
// ---------------------------------------------------------------------------

function CanvasInner({
  initialNodes,
  initialEdges,
  wfNodes,
  agents,
  models,
  runSteps = [],
  onSave,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
  wfNodes: WorkflowNode[];
  agents: Agent[];
  models: ProviderModel[];
  runSteps?: RunStep[];
  onSave: (nodes: WorkflowNode[], edges: Array<{ fromNodeId: string; toNodeId: string; conditionExpr?: string; conditionLabel?: string; edgeType?: string; sortOrder?: number; sourceHandle?: string; targetHandle?: string }>) => Promise<void>;
}) {
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Semantic zoom — track detail level (only updates on threshold cross)
  const viewport = useViewport();
  const detailLevelRef = useRef<DetailLevel>("full");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("full");

  useEffect(() => {
    const next = computeDetailLevel(viewport.zoom);
    if (next !== detailLevelRef.current) {
      detailLevelRef.current = next;
      setDetailLevel(next);
    }
  }, [viewport.zoom]);

  // Cost overlay toggle
  const [showCostOverlay, setShowCostOverlay] = useState(false);

  // Ghost node suggestion (ephemeral — dismissed on any action)
  const [ghostSuggestion, setGhostSuggestion] = useState<GhostSuggestion | null>(null);

  // Undo/Redo
  const { pushState, undo, redo, canUndo, canRedo, resetHistory } = useUndoRedo({
    nodes: initialNodes,
    edges: initialEdges,
  });

  // Refs to current state for keyboard handler closure
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const hasChangesRef = useRef(hasChanges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  hasChangesRef.current = hasChanges;

  // Search hook
  const {
    showSearch, searchQuery, setSearchQuery, searchIndex, setSearchIndex,
    searchInputRef, searchResults, searchMatchIds,
    navigateSearchNext, navigateSearchPrev, closeSearch, openSearch, handleSearchKeyDown,
  } = useCanvasSearch(nodes, setCenter);

  // Sync when parent props change (e.g. after save + re-fetch)
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setHasChanges(false);
    resetHistory({ nodes: initialNodes, edges: initialEdges });
  }, [initialNodes, initialEdges, setNodes, setEdges, resetHistory]);

  // Apply search highlight/dim + semantic zoom + cost overlay to nodes
  const displayNodes = useMemo(() => {
    // Merge run status first
    let result = mergeRunStatus(nodes, runSteps);

    // Inject detailLevel and showCostOverlay into every node's data
    result = result.map((n) => ({
      ...n,
      data: {
        ...n.data,
        detailLevel,
        showCostOverlay,
      },
    }));

    // Apply search styling
    if (showSearch && searchQuery.trim() && searchMatchIds.size > 0) {
      result = result.map((n) => ({
        ...n,
        className: searchMatchIds.has(n.id) ? "ring-2 ring-primary" : "opacity-30",
      }));
    } else if (showSearch && searchQuery.trim() && searchMatchIds.size === 0) {
      // Query entered but no matches — dim everything
      result = result.map((n) => ({
        ...n,
        className: "opacity-30",
      }));
    } else {
      // Clear any leftover className
      result = result.map((n) => ({
        ...n,
        className: undefined,
      }));
    }

    return result;
  }, [nodes, runSteps, showSearch, searchQuery, searchMatchIds, detailLevel, showCostOverlay]);

  // Apply execution animation to edges
  const displayEdges = useMemo(() => {
    return mergeRunEdges(edges, runSteps);
  }, [edges, runSteps]);

  // -----------------------------------------------------------------------
  // Mutation helpers
  // -----------------------------------------------------------------------

  const markDirty = useCallback(() => setHasChanges(true), []);

  const pushCurrentState = useCallback(() => {
    pushState({ nodes: nodesRef.current, edges: edgesRef.current });
  }, [pushState]);

  // Copy / Paste hook
  const { handleCopy, handlePaste } = useCopyPaste(
    nodesRef, edgesRef, setNodes, setEdges, pushCurrentState, markDirty,
  );

  // -----------------------------------------------------------------------
  // Core handlers
  // -----------------------------------------------------------------------

  const onConnect = useCallback((connection: Connection) => {
    pushCurrentState();
    const sourceHandle = connection.sourceHandle || "source";
    const edgeType = inferEdgeTypeFromHandle(sourceHandle);
    const style = EDGE_STYLES[edgeType] || EDGE_STYLES.normal;

    // Resolve label based on edge type
    let label: string | undefined;
    if (edgeType === "condition_true") label = "True";
    else if (edgeType === "condition_false") label = "False";
    else if (edgeType === "loop_body") label = "Body";
    else if (edgeType === "loop_back") label = "Back";
    else if (edgeType === "loop_done") label = "Done";

    setEdges((eds) => addEdge({
      ...connection,
      type: DEFAULT_EDGE_TYPE,
      animated: style.animated,
      label,
      style: { strokeWidth: 2, stroke: style.stroke, strokeDasharray: style.strokeDasharray },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: style.stroke },
      labelStyle: label ? { fontSize: 10, fontWeight: 500, fill: style.stroke } : undefined,
      labelBgStyle: label ? { fill: "var(--card)", fillOpacity: 0.9 } : undefined,
      labelBgPadding: label ? [4, 6] as [number, number] : undefined,
      labelBgBorderRadius: label ? 4 : undefined,
    }, eds));
    markDirty();
  }, [setEdges, markDirty, pushCurrentState]);

  // Capture pre-drag state so undo restores the position before the drag
  const preDragStateRef = useRef<CanvasState | null>(null);

  const onNodeDragStart = useCallback(() => {
    preDragStateRef.current = { nodes: [...nodesRef.current], edges: [...edgesRef.current] };
  }, []);

  const onNodeDragStop = useCallback(() => {
    if (preDragStateRef.current) {
      pushState(preDragStateRef.current); // push PRE-drag state so undo restores it
      preDragStateRef.current = null;
    }
    markDirty();
  }, [markDirty, pushState]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setGhostSuggestion(null);
  }, []);

  // -----------------------------------------------------------------------
  // Ghost node suggestion — shown when a connection ends on empty canvas
  // -----------------------------------------------------------------------

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    // Only show ghost if the connection was NOT completed (no target node)
    if (connectionState.isValid) { setGhostSuggestion(null); return; }

    const fromNode = nodesRef.current.find((n) => n.id === connectionState.fromHandle?.nodeId);
    if (!fromNode) { setGhostSuggestion(null); return; }

    const fromNodeType = (fromNode.data as Record<string, unknown>).nodeType as string;
    const suggestedType = suggestNextNode(fromNodeType);

    // Use event clientX/clientY and convert to flow coordinates
    const clientX = "clientX" in event ? event.clientX : (event as TouchEvent).touches?.[0]?.clientX;
    const clientY = "clientY" in event ? event.clientY : (event as TouchEvent).touches?.[0]?.clientY;
    if (!clientX || !clientY) return;

    const position = screenToFlowPosition({ x: clientX, y: clientY });
    setGhostSuggestion({
      position: { x: position.x + 60, y: position.y },
      suggestedType,
      sourceNodeId: fromNode.id,
      sourceHandle: connectionState.fromHandle?.id || "source",
    });
  }, [screenToFlowPosition]);

  // Add a node at a specific position (used by ghost suggestion click)
  const addNodeAt = useCallback((nodeType: string, position: { x: number; y: number }, connectFrom?: { nodeId: string; sourceHandle: string }) => {
    const def = NODE_REGISTRY.find((n) => n.type === nodeType);
    if (!def) return;
    pushCurrentState();

    const newNode: Node = {
      id: `temp-${Date.now()}`,
      type: "custom",
      position,
      data: { label: def.label, nodeType: def.type, config: {}, errorPolicy: {} },
    };
    setNodes((nds) => [...nds, newNode]);

    // Auto-connect from the source node if provided
    if (connectFrom) {
      const sourceHandle = connectFrom.sourceHandle;
      const edgeType = inferEdgeTypeFromHandle(sourceHandle);
      const style = EDGE_STYLES[edgeType] || EDGE_STYLES.normal;

      let label: string | undefined;
      if (edgeType === "condition_true") label = "True";
      else if (edgeType === "condition_false") label = "False";
      else if (edgeType === "loop_body") label = "Body";
      else if (edgeType === "loop_back") label = "Back";
      else if (edgeType === "loop_done") label = "Done";

      setEdges((eds) => addEdge({
        source: connectFrom.nodeId,
        target: newNode.id,
        sourceHandle,
        targetHandle: "target",
        type: DEFAULT_EDGE_TYPE,
        animated: style.animated,
        label,
        style: { strokeWidth: 2, stroke: style.stroke, strokeDasharray: style.strokeDasharray },
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: style.stroke },
        labelStyle: label ? { fontSize: 10, fontWeight: 500, fill: style.stroke } : undefined,
        labelBgStyle: label ? { fill: "var(--card)", fillOpacity: 0.9 } : undefined,
        labelBgPadding: label ? [4, 6] as [number, number] : undefined,
        labelBgBorderRadius: label ? 4 : undefined,
      }, eds));
    }

    markDirty();
    setSelectedNodeId(newNode.id);
    setGhostSuggestion(null);
  }, [setNodes, setEdges, markDirty, pushCurrentState]);

  // -----------------------------------------------------------------------
  // Add node (from palette click)
  // -----------------------------------------------------------------------

  function handleAddNodeFromPalette(nodeType: string) {
    const def = NODE_REGISTRY.find((n) => n.type === nodeType);
    if (!def) return;
    pushCurrentState();
    const newNode: Node = {
      id: `temp-${Date.now()}`,
      type: "custom",
      position: { x: nodes.length * 280 + 50, y: 250 },
      data: { label: def.label, nodeType: def.type, config: {}, errorPolicy: {} },
    };
    setNodes((nds) => [...nds, newNode]);
    markDirty();
    setSelectedNodeId(newNode.id);
  }

  // -----------------------------------------------------------------------
  // Drag-and-Drop from palette
  // -----------------------------------------------------------------------

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData("application/reactflow-nodetype");
    if (!nodeType) return;

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const def = NODE_REGISTRY.find((n) => n.type === nodeType);
    if (!def) return;

    pushCurrentState();
    const newNode: Node = {
      id: `temp-${Date.now()}`,
      type: "custom",
      position,
      data: { label: def.label, nodeType: def.type, config: {}, errorPolicy: {} },
    };
    setNodes((nds) => [...nds, newNode]);
    markDirty();
    setSelectedNodeId(newNode.id);
  }, [screenToFlowPosition, setNodes, markDirty, pushCurrentState]);

  // -----------------------------------------------------------------------
  // Update / Delete node
  // -----------------------------------------------------------------------

  function handleUpdateNode(id: string, data: Record<string, unknown>) {
    pushCurrentState();
    setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data } : n));
    markDirty();
  }

  function handleDeleteNode(id: string) {
    pushCurrentState();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNodeId(null);
    markDirty();
  }

  // -----------------------------------------------------------------------
  // Undo / Redo handlers
  // -----------------------------------------------------------------------

  const handleUndo = useCallback(() => {
    const state = undo();
    if (state) {
      setNodes(state.nodes);
      setEdges(state.edges);
      setHasChanges(true);
    }
  }, [undo, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const state = redo();
    if (state) {
      setNodes(state.nodes);
      setEdges(state.edges);
      setHasChanges(true);
    }
  }, [redo, setNodes, setEdges]);

  // -----------------------------------------------------------------------
  // Select All
  // -----------------------------------------------------------------------

  const handleSelectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
  }, [setNodes]);

  // -----------------------------------------------------------------------
  // Auto-Layout
  // -----------------------------------------------------------------------

  const handleAutoLayout = useCallback(() => {
    pushCurrentState();
    const laid = autoLayoutNodes(nodesRef.current, edgesRef.current);
    setNodes(laid);
    markDirty();
    setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
  }, [setNodes, markDirty, fitView, pushCurrentState]);

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const updatedNodes: WorkflowNode[] = currentNodes.map((n) => {
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

      const updatedEdges = currentEdges.map((e) => {
        const sourceHandle = e.sourceHandle || "source";
        const edgeType = inferEdgeTypeFromHandle(sourceHandle);

        // Extract sort order for switch cases
        let sortOrder = 0;
        if (sourceHandle.startsWith("source-case-")) {
          sortOrder = parseInt(sourceHandle.replace("source-case-", ""), 10);
        }

        return {
          fromNodeId: e.source,
          toNodeId: e.target,
          conditionLabel: (e.label as string) || undefined,
          edgeType,
          sortOrder,
          sourceHandle,
          targetHandle: e.targetHandle || "target",
        };
      });
      await onSave(updatedNodes, updatedEdges);
      setHasChanges(false);
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------

  useCanvasKeyboard({
    handleUndo, handleRedo, handleCopy, handlePaste,
    handleSelectAll, handleSave, openSearch, hasChangesRef,
  });

  // -----------------------------------------------------------------------
  // Unsaved changes warning
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasChangesRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // -----------------------------------------------------------------------
  // Before-delete handler: captures state BEFORE React Flow removes items
  // -----------------------------------------------------------------------

  const onBeforeDelete = useCallback(async () => {
    pushCurrentState(); // capture state before deletion
    markDirty();
    return true; // allow deletion to proceed
  }, [pushCurrentState, markDirty]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  return (
    <div className="border border-border rounded-xl overflow-hidden flex h-full min-h-[480px]">
      <NodePalette onAdd={handleAddNodeFromPalette} />

      <div className="flex-1 flex flex-col relative">
        <CanvasToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          hasChanges={hasChanges}
          saving={saving}
          showCostOverlay={showCostOverlay}
          handleUndo={handleUndo}
          handleRedo={handleRedo}
          handleAutoLayout={handleAutoLayout}
          openSearch={openSearch}
          setShowCostOverlay={setShowCostOverlay}
          handleSave={handleSave}
        />

        {showSearch && (
          <CanvasSearchBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchIndex={searchIndex}
            setSearchIndex={setSearchIndex}
            searchInputRef={searchInputRef}
            searchResults={searchResults}
            handleSearchKeyDown={handleSearchKeyDown}
            navigateSearchPrev={navigateSearchPrev}
            navigateSearchNext={navigateSearchNext}
            closeSearch={closeSearch}
          />
        )}

        {/* Canvas */}
        <div className="flex-1" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onBeforeDelete={onBeforeDelete}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={["Backspace", "Delete"]}
            snapToGrid
            snapGrid={[20, 20]}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode="Shift"
            defaultEdgeOptions={{
              type: DEFAULT_EDGE_TYPE,
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
            {/* Ghost node suggestion — appears when a connection drops on empty canvas */}
            {ghostSuggestion && (
              <ViewportPortal>
                <div
                  className="pointer-events-auto cursor-pointer opacity-40 hover:opacity-70 transition-opacity"
                  style={{
                    position: "absolute",
                    left: ghostSuggestion.position.x,
                    top: ghostSuggestion.position.y,
                    transform: "translate(-50%, -50%)",
                  }}
                  onClick={() => addNodeAt(
                    ghostSuggestion.suggestedType,
                    ghostSuggestion.position,
                    { nodeId: ghostSuggestion.sourceNodeId, sourceHandle: ghostSuggestion.sourceHandle },
                  )}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      addNodeAt(
                        ghostSuggestion.suggestedType,
                        ghostSuggestion.position,
                        { nodeId: ghostSuggestion.sourceNodeId, sourceHandle: ghostSuggestion.sourceHandle },
                      );
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Add ${NODE_LABEL_MAP[ghostSuggestion.suggestedType] || ghostSuggestion.suggestedType} node`}
                >
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-primary/50 bg-primary/5">
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs text-primary font-medium">
                      {NODE_LABEL_MAP[ghostSuggestion.suggestedType] || ghostSuggestion.suggestedType}
                    </span>
                  </div>
                </div>
              </ViewportPortal>
            )}
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

// ---------------------------------------------------------------------------
// Exported Wrapper (provides ReactFlowProvider for useReactFlow hook)
// ---------------------------------------------------------------------------

export function WorkflowCanvas({
  nodes: wfNodes,
  edges: wfEdges,
  agents,
  models = [],
  runSteps = [],
  onSave,
}: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  agents: Agent[];
  models?: ProviderModel[];
  runSteps?: RunStep[];
  onSave: (nodes: WorkflowNode[], edges: Array<{ fromNodeId: string; toNodeId: string; conditionExpr?: string; conditionLabel?: string; edgeType?: string; sortOrder?: number; sourceHandle?: string; targetHandle?: string }>) => Promise<void>;
}) {
  const initialNodes = useMemo(() => toFlowNodes(wfNodes, agents), [wfNodes, agents]);
  const initialEdges = useMemo(() => toFlowEdges(wfEdges, wfNodes), [wfEdges, wfNodes]);

  return (
    <ReactFlowProvider>
      <CanvasInner
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        wfNodes={wfNodes}
        agents={agents}
        models={models}
        runSteps={runSteps}
        onSave={onSave}
      />
    </ReactFlowProvider>
  );
}
