# 17 - Workflow Canvas Overhaul Design

**Date:** 2026-05-16
**Status:** Design
**Prereqs:** Research #26 (canvas audit + industry analysis)
**Scope:** Complete rewrite of the workflow canvas — handle architecture, edge routing, interaction model, and differentiating features.

---

## 1. Current State Analysis

### What Exists

The canvas is built on `@xyflow/react` v12.10.2 with a single custom node type. It renders inside `WorkflowDetail` as a 640px-tall fixed container with a left palette, center canvas, and right config panel.

**Files:**

| File | Purpose | Lines |
|------|---------|-------|
| `canvas.tsx` | Main ReactFlow wrapper, converters, save logic | 227 |
| `canvas-node.tsx` | Single `CustomNode` component with top/bottom handles | 80 |
| `canvas-types.ts` | Node registry (17 types), color/icon maps, edge styles | 59 |
| `node-palette.tsx` | Left sidebar, click-to-add (no drag-and-drop) | 51 |
| `node-config-panel.tsx` | Right sidebar, per-type form fields, error policy tab | 362 |
| `workflow-detail.tsx` | Page component, fetches data, two-call save | 183 |

**Database:**

| Table | Key Columns |
|-------|-------------|
| `workflow_nodes` | `id`, `node_type`, `name`, `config` (jsonb), `position_x`, `position_y`, `error_policy` (jsonb) |
| `workflow_edges` | `id`, `from_node_id`, `to_node_id`, `condition_label`, `condition_expr`, `edge_type`, `sort_order` |

**Save mechanism:** Two sequential API calls — `PUT /api/workflows/:id/nodes` (delete-all + re-insert) then `PUT /api/workflows/:id/edges` (delete-all + re-insert). Each is transactional internally, but the pair is not atomic. If nodes succeed and edges fail, the workflow is left in a broken state with orphaned node IDs.

### 10 Breaking Limitations

| # | Limitation | Impact |
|---|-----------|--------|
| 1 | **Top/bottom handles** | Forces top-down layout. Cannot visually branch left/right for conditions. Switch/condition nodes look identical to normal nodes. |
| 2 | **Single output handle** | Switch node cannot have multiple labeled output ports. Condition node has no True/False visual split. All branching logic is hidden. |
| 3 | **Straight-line edges** | No curves, no smart routing. Edges overlap at intersections. No visual distinction between edge types beyond color. |
| 4 | **Fixed 640px height** | Canvas truncated on large workflows. Cannot see full graph. Requires excessive scrolling inside the container. |
| 5 | **Click-to-add (no drag)** | Nodes placed at hardcoded position (`x:250, y:n*140+50`). Cannot choose placement. Must drag after adding. |
| 6 | **No undo/redo** | All mutations are immediate and irreversible until save. One mis-delete loses work. |
| 7 | **No multi-select** | Cannot select multiple nodes for bulk move, delete, or copy. |
| 8 | **No copy/paste** | Cannot duplicate node groups. Must manually recreate similar patterns. |
| 9 | **No auto-layout** | Manual positioning only. After adding several nodes, the graph becomes a mess. |
| 10 | **Edge type inferred from stroke color** | `edgeType` is reverse-engineered from hex color on save (`#ef4444` = error). If EDGE_STYLES colors change, save silently produces wrong types. |

### Additional Problems

- **No sourceHandle/targetHandle in edges** — edges cannot target specific ports on multi-output nodes.
- **No edge labels rendered** — `conditionLabel` exists in DB but is never shown on the canvas.
- **Two-call save is non-atomic** — node IDs change on every save (delete-all + re-insert generates new UUIDs), which breaks edge `fromNodeId`/`toNodeId` references if the first call succeeds but the second fails.
- **No keyboard shortcuts** beyond Delete/Backspace.
- **No dirty state persistence** — navigating away loses unsaved changes with no warning.

---

## 2. Target State

### Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Toolbar: [Undo] [Redo] | [Tidy Up] [Fit] | [Search] | [Costs] | * Save    │
├────────┬─────────────────────────────────────────────────────────┬───────────┤
│        │                                                         │           │
│ NODE   │                    CANVAS                               │  CONFIG   │
│ PALETTE│           (full viewport height)                        │  PANEL    │
│        │                                                         │           │
│ [Flow] │   ┌──────┐    ┌──────────┐    ┌──────────┐             │  Node:    │
│  Input │   │Input ●───→● Classify ●───→●  Switch  ●─── A ──→   │  Switch   │
│  Output│   └──────┘    └──────────┘    │          ●─── B ──→   │           │
│  Cond  │                               │          ●─── C ──→   │  Cases:   │
│  Switch│                               └──────────┘             │  [A] [B]  │
│  Loop  │                                                         │  [C]      │
│  ...   │                                                         │           │
│        │                                                         │  Error:   │
│ [AI]   │                                                         │  [Stop]   │
│  Agent │                                                         │           │
│  LLM   │                ┌────────┐                               │           │
│  KBase │                │MiniMap │                               │           │
│        │                └────────┘                               │           │
│ [Act]  │                                                         │           │
│  Tool  │    [Ctrl+Z: Undo]  [Ctrl+S: Save]  [Ctrl+F: Search]   │           │
│  HTTP  │                                                         │           │
├────────┴─────────────────────────────────────────────────────────┴───────────┤
│ « [Collapse palette]                           [Collapse config] »          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Node Architecture (Left-to-Right)

```
Standard Node (1 input, 1 output):

          ┌──────────────────────────┐
          │  ┌──┐                    │
    ●─────│  │🤖│  Agent Call       ─│─────●
   target │  └──┘  agent · Reviewer  │  source
          │                          │
          └──────────────────────────┘
          Left handle              Right handle


Condition Node (1 input, 2 outputs):

          ┌──────────────────────────┐
          │  ┌──┐                    ├─── ● True    (source-true)
    ●─────│  │⑂ │  Risk Check       │
   target │  └──┘  condition         ├─── ● False   (source-false)
          │  expr: score > 0.8       │
          └──────────────────────────┘


Switch Node (1 input, N outputs):

          ┌──────────────────────────┐
          │  ┌──┐                    ├─── ● "billing"    (source-case-0)
          │  │⑃ │  Route by Dept     │
    ●─────│  └──┘  switch            ├─── ● "support"    (source-case-1)
   target │  val: {{dept}}           │
          │                          ├─── ● "sales"      (source-case-2)
          │                          │
          │                          ├─── ● default      (source-default)
          └──────────────────────────┘


Loop Node (1 input, 2 outputs):

          ┌──────────────────────────┐
          │  ┌──┐                    ├─── ● body    (source-loop-body)
    ●─────│  │↻ │  Retry Loop       │
   target │  └──┘  loop · 5x        ├─── ● done    (source-loop-done)
          │                          │
          └──────────────────────────┘
```

### Edge Styles

```
Normal:      ─────────────────→    Gray smoothstep, solid
Error:       ╌╌╌╌╌╌╌╌╌╌╌╌╌╌─→    Red smoothstep, dashed, label "error"
Condition:   ────── True ─────→    Gray smoothstep + label at midpoint
Loop body:   ═══════════════─→    Indigo smoothstep, animated
Loop back:   ←╌╌╌╌╌╌╌╌╌╌╌╌╌╌    Indigo, dashed, curves backward
Loop done:   ─────────────────→    Green smoothstep, solid
```

---

## 3. Implementation Plan -- Phase 1: Foundation (Must-Have)

### 3.1 Handle Architecture: Left/Right

**Goal:** Switch from top-down to left-to-right flow. All nodes receive input on the LEFT, emit output on the RIGHT.

**Changes to `canvas-node.tsx`:**

Current:
```tsx
<Handle type="target" position={Position.Top} />
<Handle type="source" position={Position.Bottom} />
```

New:
```tsx
<Handle type="target" position={Position.Left} id="target" />
<Handle type="source" position={Position.Right} id="source" />
```

**Handle positioning CSS:**

Left handle is vertically centered on the node's left edge. Right handle is vertically centered on the right edge. React Flow positions handles at 50% by default for Left/Right, so no manual offset is needed for single-handle nodes.

**Edge routing direction:**

React Flow's `smoothstep` edge type automatically routes left-to-right when handles are on Left/Right positions. No manual path calculation needed.

**Converter function changes (`canvas.tsx`):**

The `toFlowNodes` function needs no changes to position mapping. `positionX` and `positionY` in the database continue to mean the node's top-left corner. The flow direction is determined by handle placement, not by position data.

**Migration path for existing workflows:**

Existing workflows store `positionX` and `positionY` based on top-down cascade placement (x around 250, y incrementing by 140). After switching to left-right handles, these positions will render as a vertical stack with horizontal connections — which actually looks fine for simple linear flows. For complex flows, users can click "Tidy Up" (auto-layout) to reposition.

No database migration needed. The coordinate system is neutral — it is the handle placement that determines flow direction.

**Default position for new nodes:**

Change from vertical cascade to horizontal cascade:
```tsx
// Old: { x: 250, y: nodes.length * 140 + 50 }
// New: { x: nodes.length * 280 + 50, y: 250 }
```

This only affects click-to-add as a fallback. Drag-and-drop (3.5) will override this with cursor position.

### 3.2 Multi-Output Ports for Switch/Condition

**Goal:** Switch and Condition nodes render multiple named output handles. Each edge connects to a specific `sourceHandle` ID.

**Node types and their handles:**

| Node Type | Target Handles | Source Handles |
|-----------|---------------|----------------|
| `input` | None | `source` (1) |
| `output` | `target` (1) | None |
| `condition` | `target` (1) | `source-true`, `source-false` (2) |
| `switch` | `target` (1) | `source-case-0`, `source-case-1`, ..., `source-default` (N+1) |
| `loop` | `target` (1) | `source-loop-body`, `source-loop-done` (2) |
| All others | `target` (1) | `source` (1) |

**Handle generation function (new: `canvas-node.tsx`):**

```tsx
interface HandleDef {
  type: "source" | "target";
  id: string;
  label?: string;       // Rendered next to handle
  position: Position;
}

function getNodeHandles(nodeType: string, config: Record<string, unknown>): HandleDef[] {
  const handles: HandleDef[] = [];

  // Target handle (all except input)
  if (nodeType !== "input") {
    handles.push({ type: "target", id: "target", position: Position.Left });
  }

  // Source handles
  switch (nodeType) {
    case "output":
      // No source handle
      break;
    case "condition":
      handles.push(
        { type: "source", id: "source-true",  label: "True",  position: Position.Right },
        { type: "source", id: "source-false", label: "False", position: Position.Right },
      );
      break;
    case "switch": {
      const cases = (config.cases as Array<{ label: string }>) || [];
      cases.forEach((c, i) => {
        handles.push({
          type: "source", id: `source-case-${i}`, label: c.label || `Case ${i}`,
          position: Position.Right,
        });
      });
      handles.push({
        type: "source", id: "source-default", label: "Default",
        position: Position.Right,
      });
      break;
    }
    case "loop":
      handles.push(
        { type: "source", id: "source-loop-body", label: "Body", position: Position.Right },
        { type: "source", id: "source-loop-done", label: "Done", position: Position.Right },
      );
      break;
    default:
      handles.push({ type: "source", id: "source", position: Position.Right });
  }

  return handles;
}
```

**Rendering multiple handles vertically:**

For nodes with N source handles on the right side, handles are spaced evenly along the node's right edge. React Flow's Handle component accepts a `style` prop for positioning:

```tsx
function renderHandles(handles: HandleDef[], nodeColor: string, nodeHeight: number) {
  const sourceHandles = handles.filter(h => h.type === "source");
  const targetHandles = handles.filter(h => h.type === "target");

  return (
    <>
      {targetHandles.map((h) => (
        <Handle key={h.id} type="target" position={Position.Left} id={h.id}
          className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full"
          style={{ backgroundColor: nodeColor, top: "50%" }}
        />
      ))}
      {sourceHandles.map((h, i) => {
        const spacing = nodeHeight / (sourceHandles.length + 1);
        const top = spacing * (i + 1);
        return (
          <div key={h.id} className="absolute right-0" style={{ top }}>
            <Handle type="source" position={Position.Right} id={h.id}
              className="!w-2.5 !h-2.5 !border-2 !border-card !rounded-full"
              style={{ backgroundColor: nodeColor, position: "relative", top: 0 }}
            />
            {h.label && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
                {h.label}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
```

**Node height auto-expansion:**

The node uses a minimum height of 72px (current). For each additional source handle beyond 1, add 28px:

```tsx
const sourceCount = handles.filter(h => h.type === "source").length;
const nodeMinHeight = Math.max(72, 44 + sourceCount * 28);
```

This is applied via `minHeight` on the outer `<div>`.

**Edge sourceHandle/targetHandle mapping:**

The `toFlowEdges` converter must populate `sourceHandle` and `targetHandle` on each React Flow edge:

```tsx
function toFlowEdges(wfEdges: WorkflowEdge[], wfNodes: WorkflowNode[]): Edge[] {
  return wfEdges.map((e) => {
    const sourceNode = wfNodes.find(n => n.id === e.fromNodeId);
    const sourceHandle = resolveSourceHandle(sourceNode, e);
    const targetHandle = "target";

    return {
      id: e.id,
      source: e.fromNodeId,
      target: e.toNodeId,
      sourceHandle,
      targetHandle,
      type: "smoothstep",
      label: e.conditionLabel || undefined,
      // ... style
    };
  });
}

function resolveSourceHandle(sourceNode: WorkflowNode | undefined, edge: WorkflowEdge): string {
  if (!sourceNode) return "source";

  switch (sourceNode.nodeType) {
    case "condition":
      // Use conditionLabel or edgeType to determine branch
      if (edge.conditionLabel?.toLowerCase() === "false" || edge.edgeType === "condition_false") {
        return "source-false";
      }
      return "source-true";
    case "switch":
      // Edge sortOrder maps to case index. Default = "source-default"
      if (edge.edgeType === "switch_default" || edge.conditionLabel?.toLowerCase() === "default") {
        return "source-default";
      }
      return `source-case-${edge.sortOrder}`;
    case "loop":
      if (edge.edgeType === "loop_done") return "source-loop-done";
      if (edge.edgeType === "loop_body") return "source-loop-body";
      return "source-loop-body";
    default:
      return "source";
  }
}
```

**Reverse conversion (save):**

When saving edges back to the API, extract the `sourceHandle` and map it to `edgeType` and `sortOrder`:

```tsx
function fromFlowEdge(edge: Edge): EdgePayload {
  const sourceHandle = edge.sourceHandle || "source";
  let edgeType = "normal";
  let sortOrder = 0;

  if (sourceHandle === "source-true") edgeType = "condition_true";
  else if (sourceHandle === "source-false") edgeType = "condition_false";
  else if (sourceHandle.startsWith("source-case-")) {
    edgeType = "switch_case";
    sortOrder = parseInt(sourceHandle.replace("source-case-", ""), 10);
  }
  else if (sourceHandle === "source-default") edgeType = "switch_default";
  else if (sourceHandle === "source-loop-body") edgeType = "loop_body";
  else if (sourceHandle === "source-loop-done") edgeType = "loop_done";

  return {
    fromNodeId: edge.source,
    toNodeId: edge.target,
    conditionLabel: (edge.label as string) || undefined,
    edgeType,
    sortOrder,
  };
}
```

**Database schema change:**

The existing `edge_type TEXT NOT NULL DEFAULT 'normal'` column and `sort_order INTEGER` column are sufficient. The new `edgeType` values (`condition_true`, `condition_false`, `switch_case`, `switch_default`, `loop_body`, `loop_done`) are just string values — no enum migration needed.

**Switch node config change:**

Add a `cases` array to the Switch node config:

```json
{
  "value": "{{classifier.category}}",
  "cases": [
    { "label": "billing", "expr": "billing" },
    { "label": "support", "expr": "support" },
    { "label": "sales",   "expr": "sales" }
  ],
  "defaultCase": "other"
}
```

This replaces the current `defaultCase` string-only config. The config panel for Switch must render an editable list of cases with add/remove buttons. Each case becomes an output handle.

**Update to `node-config-panel.tsx` for Switch:**

```tsx
{nodeType === "switch" && (
  <>
    <div className="space-y-1">
      <Label className="text-[11px]">Value to evaluate</Label>
      <Input value={(config.value as string) || ""} ... />
    </div>
    <div className="space-y-1">
      <Label className="text-[11px]">Cases</Label>
      {((config.cases as Array<{label: string; expr: string}>) || []).map((c, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <Input value={c.label} className="h-7 text-xs flex-1" placeholder="Label" ... />
          <Input value={c.expr} className="h-7 text-xs flex-1 font-mono" placeholder="Match value" ... />
          <button onClick={() => removeCase(i)}>×</button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addCase}>+ Add case</Button>
    </div>
  </>
)}
```

### 3.3 Edge Routing

**Goal:** Replace straight-line edges with smoothstep bezier curves. Store edge type as data, not infer from stroke color.

**Edge type on React Flow edges:**

Set `type: "smoothstep"` on all edges in `toFlowEdges`:

```tsx
return {
  id: e.id,
  source: e.fromNodeId,
  target: e.toNodeId,
  sourceHandle,
  targetHandle: "target",
  type: "smoothstep",           // <-- changed from default (straight)
  label: e.conditionLabel || undefined,
  animated: style.animated,
  style: { strokeWidth: 2, stroke: style.stroke, strokeDasharray: style.strokeDasharray },
  markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: style.stroke },
};
```

**Edge style lookup (fix the fragile color inference):**

On save, the current code checks `e.style?.stroke === "#ef4444"` to determine edge type. This is replaced entirely. The `edgeType` is now determined by `sourceHandle` (see 3.2), not by stroke color. The reverse conversion function `fromFlowEdge` handles this cleanly.

**Edge labels for conditions:**

React Flow supports `label` on edges natively and renders it at the midpoint. For condition and switch edges, the label comes from `conditionLabel` in the database:

- Condition true edge: label = "True" (or custom expression)
- Condition false edge: label = "False"
- Switch case edges: label = case label (e.g., "billing")
- Error edges: label = "error"

These labels are set in `toFlowEdges` and styled:

```tsx
labelStyle: { fontSize: 10, fontWeight: 500, fill: style.stroke },
labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
labelBgPadding: [4, 6] as [number, number],
labelBgBorderRadius: 4,
```

**Animated edges:**

Edges with `edgeType === "loop_body"` or edges connected to currently running nodes get `animated: true`. React Flow renders these with a CSS dash-offset animation.

**EDGE_STYLES update (`canvas-types.ts`):**

```typescript
export const EDGE_STYLES: Record<string, { stroke: string; strokeDasharray?: string; animated: boolean }> = {
  normal:          { stroke: "#94a3b8", animated: false },
  condition_true:  { stroke: "#10b981", animated: false },       // Green
  condition_false: { stroke: "#f59e0b", animated: false },       // Amber
  switch_case:     { stroke: "#94a3b8", animated: false },       // Gray
  switch_default:  { stroke: "#64748b", strokeDasharray: "6,4", animated: false },
  error:           { stroke: "#ef4444", strokeDasharray: "6,4", animated: false },
  loop_body:       { stroke: "#6366f1", animated: true },
  loop_back:       { stroke: "#6366f1", strokeDasharray: "4,4", animated: false },
  loop_done:       { stroke: "#10b981", animated: false },
};
```

### 3.4 Canvas Layout

**Goal:** Full viewport height. Collapsible sidebars.

**Current:** `<div style={{ height: 640 }}>` wraps the entire canvas.

**New:** Canvas fills available height using CSS calc or flex layout.

In `workflow-detail.tsx`, replace the fixed-height container:

```tsx
// workflow-detail.tsx — wrap canvas in full-height container
{tab === "nodes" && (
  <div className="flex-1 min-h-0">
    <WorkflowCanvas ... />
  </div>
)}
```

In `canvas.tsx`, change the outer wrapper:

```tsx
// Old:
<div className="border border-border rounded-xl overflow-hidden flex" style={{ height: 640 }}>

// New:
<div className="border border-border rounded-xl overflow-hidden flex h-full min-h-[480px]">
```

The parent `workflow-detail.tsx` must use flex layout so the canvas tab fills remaining space:

```tsx
<div className="flex flex-col h-[calc(100vh-12rem)]">
  {/* header, tabs */}
  {tab === "nodes" && (
    <div className="flex-1 min-h-0">
      <WorkflowCanvas ... />
    </div>
  )}
</div>
```

**Collapsible sidebars:**

Add state for palette and config panel collapse:

```tsx
const [paletteCollapsed, setPaletteCollapsed] = useState(false);
const [configCollapsed, setConfigCollapsed] = useState(false);
```

Palette renders as a 14rem-wide sidebar when expanded, or a 2.5rem-wide icon strip when collapsed. A toggle button sits at the bottom of the palette.

Config panel uses the same pattern — 18rem wide when expanded, hidden when collapsed, with a toggle button on the canvas edge.

### 3.5 Drag-and-Drop from Palette

**Goal:** Drag node types from the palette onto the canvas. Node appears at the cursor position.

**Implementation (3 parts):**

**Part 1 — Palette `onDragStart`:**

Each palette item becomes draggable:

```tsx
<button
  draggable
  onDragStart={(e) => {
    e.dataTransfer.setData("application/reactflow-nodetype", item.type);
    e.dataTransfer.effectAllowed = "move";
  }}
  onClick={() => onAdd(item.type)}  // Keep click-to-add as fallback
  ...
>
```

**Part 2 — Canvas `onDragOver` and `onDrop`:**

```tsx
const reactFlowWrapper = useRef<HTMLDivElement>(null);

const onDragOver = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}, []);

const onDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault();
  const nodeType = e.dataTransfer.getData("application/reactflow-nodetype");
  if (!nodeType) return;

  // Convert screen coords to canvas coords using React Flow instance
  const position = screenToFlowPosition({
    x: e.clientX,
    y: e.clientY,
  });

  const def = NODE_REGISTRY.find((n) => n.type === nodeType);
  if (!def) return;

  const newNode: Node = {
    id: `temp-${Date.now()}`,
    type: "custom",
    position,
    data: { label: def.label, nodeType: def.type, config: {}, errorPolicy: {} },
  };
  setNodes((nds) => [...nds, newNode]);
  setHasChanges(true);
  setSelectedNodeId(newNode.id);
}, [screenToFlowPosition, setNodes]);
```

Access `screenToFlowPosition` via `useReactFlow()`:

```tsx
const { screenToFlowPosition } = useReactFlow();
```

This requires wrapping the canvas internals in a child component (since `useReactFlow` must be called inside `<ReactFlowProvider>`). We will restructure `canvas.tsx` into:

```
WorkflowCanvas (exports)
  └── ReactFlowProvider
        └── CanvasInner (contains ReactFlow, uses useReactFlow)
```

**Part 3 — Visual drag preview:**

The browser's native drag preview can be customized with `e.dataTransfer.setDragImage()`. We create a hidden preview element:

```tsx
const dragPreviewRef = useRef<HTMLDivElement>(null);

onDragStart={(e) => {
  if (dragPreviewRef.current) {
    dragPreviewRef.current.textContent = item.label;
    dragPreviewRef.current.style.backgroundColor = `${item.color}20`;
    e.dataTransfer.setDragImage(dragPreviewRef.current, 40, 20);
  }
  ...
}}
```

### 3.6 Undo/Redo

**Goal:** State stack with max 50 entries. Ctrl+Z = undo, Ctrl+Shift+Z = redo. Visual indicator in toolbar.

**State management:**

Create a new hook `useUndoRedo`:

```tsx
// hooks/use-undo-redo.ts

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(initialState: CanvasState) {
  const [history, setHistory] = useState<CanvasState[]>([initialState]);
  const [pointer, setPointer] = useState(0);

  const pushState = useCallback((state: CanvasState) => {
    setHistory((prev) => {
      const truncated = prev.slice(0, pointer + 1);  // Discard redo states
      const next = [...truncated, state];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setPointer((p) => Math.min(p + 1, MAX_HISTORY - 1));
  }, [pointer]);

  const undo = useCallback(() => {
    if (pointer <= 0) return null;
    setPointer((p) => p - 1);
    return history[pointer - 1];
  }, [pointer, history]);

  const redo = useCallback(() => {
    if (pointer >= history.length - 1) return null;
    setPointer((p) => p + 1);
    return history[pointer + 1];
  }, [pointer, history]);

  const canUndo = pointer > 0;
  const canRedo = pointer < history.length - 1;

  return { pushState, undo, redo, canUndo, canRedo };
}
```

**When to push state:**

Push after these mutations (debounced by 300ms for drag operations):

1. Add node (from palette or paste)
2. Delete node(s)
3. Move node(s) — push on `onNodeDragStop`, not on every pixel
4. Add edge (connect handles)
5. Delete edge(s)
6. Update node config (from config panel)

**Keyboard binding:**

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      const state = undo();
      if (state) { setNodes(state.nodes); setEdges(state.edges); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      const state = redo();
      if (state) { setNodes(state.nodes); setEdges(state.edges); }
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [undo, redo, setNodes, setEdges]);
```

**Toolbar buttons:**

```tsx
<div className="flex items-center gap-1">
  <Button variant="ghost" size="icon" onClick={handleUndo} disabled={!canUndo}
    title="Undo (Ctrl+Z)" className="h-7 w-7">
    <Undo2 className="h-3.5 w-3.5" />
  </Button>
  <Button variant="ghost" size="icon" onClick={handleRedo} disabled={!canRedo}
    title="Redo (Ctrl+Shift+Z)" className="h-7 w-7">
    <Redo2 className="h-3.5 w-3.5" />
  </Button>
</div>
```

### 3.7 Multi-Select + Copy/Paste

**Goal:** Shift+Click to add to selection. Lasso select. Ctrl+C/V copy/paste with new IDs.

**Multi-select with React Flow:**

React Flow supports multi-select natively. Enable it:

```tsx
<ReactFlow
  ...
  selectionOnDrag       // Enables lasso selection when dragging on empty canvas
  selectionMode={SelectionMode.Partial}  // Select nodes partially inside lasso
  multiSelectionKeyCode="Shift"          // Hold Shift to add to selection
  ...
>
```

**Copy/Paste implementation:**

```tsx
const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

function handleCopy() {
  const selectedNodes = nodes.filter(n => n.selected);
  if (selectedNodes.length === 0) return;
  const selectedIds = new Set(selectedNodes.map(n => n.id));
  const selectedEdges = edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target));
  clipboardRef.current = { nodes: selectedNodes, edges: selectedEdges };
}

function handlePaste() {
  if (!clipboardRef.current) return;
  const { nodes: copiedNodes, edges: copiedEdges } = clipboardRef.current;

  // Generate new IDs
  const idMap = new Map<string, string>();
  copiedNodes.forEach(n => idMap.set(n.id, `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`));

  // Offset position by 40px to show paste visually
  const newNodes = copiedNodes.map(n => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: n.position.x + 40, y: n.position.y + 40 },
    selected: true,
  }));

  const newEdges = copiedEdges.map(e => ({
    ...e,
    id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));

  // Deselect existing, add new
  setNodes(nds => [
    ...nds.map(n => ({ ...n, selected: false })),
    ...newNodes,
  ]);
  setEdges(eds => [...eds, ...newEdges]);
  setHasChanges(true);
  pushState({ nodes: [...nodes, ...newNodes], edges: [...edges, ...newEdges] });
}
```

**Delete selected:**

React Flow already handles Delete/Backspace for selected nodes via `deleteKeyCode`. Edges connected to deleted nodes are auto-removed via the `onNodesDelete` handler. We need to push to undo stack:

```tsx
const onNodesDelete = useCallback((deleted: Node[]) => {
  setHasChanges(true);
  // Push state before deletion for undo
}, []);
```

### 3.8 Auto-Layout

**Goal:** Automatic graph layout using dagre. "Tidy Up" button in toolbar.

**Package:** `@dagrejs/dagre` (smaller, simpler than ELK for our use case — we only need left-to-right DAG layout).

**Install:** `pnpm add @dagrejs/dagre` in `ai-studio-app/web/`.

**Layout function:**

```tsx
// lib/canvas-layout.ts
import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 240;
const NODE_BASE_HEIGHT = 72;

export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",          // Left to right
    nodesep: 60,            // Vertical spacing between nodes in same rank
    ranksep: 120,           // Horizontal spacing between ranks
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    const sourceCount = getSourceHandleCount(node);
    const height = Math.max(NODE_BASE_HEIGHT, 44 + sourceCount * 28);
    g.setNode(node.id, { width: NODE_WIDTH, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - (g.node(node.id).height || NODE_BASE_HEIGHT) / 2,
      },
    };
  });
}
```

**Toolbar button:**

```tsx
<Button variant="ghost" size="sm" onClick={handleAutoLayout} title="Tidy Up (auto-layout)">
  <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Tidy Up
</Button>
```

**Handler:**

```tsx
function handleAutoLayout() {
  const laid = autoLayout(nodes, edges);
  setNodes(laid);
  setHasChanges(true);
  pushState({ nodes: laid, edges });

  // Fit view after layout
  setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
}
```

### 3.9 Keyboard Shortcuts

**Full shortcut map:**

| Shortcut | Action | Handler |
|----------|--------|---------|
| `Delete` / `Backspace` | Delete selected nodes/edges | React Flow built-in (`deleteKeyCode`) |
| `Ctrl+Z` | Undo | `handleUndo()` |
| `Ctrl+Shift+Z` | Redo | `handleRedo()` |
| `Ctrl+C` | Copy selected | `handleCopy()` |
| `Ctrl+V` | Paste | `handlePaste()` |
| `Ctrl+A` | Select all nodes | `setNodes(nds => nds.map(n => ({...n, selected: true})))` |
| `Ctrl+S` | Save workflow | `handleSave()` |
| `Ctrl+F` | Open search (Phase 2) | `setSearchOpen(true)` |
| `Ctrl+=` / `Ctrl++` | Zoom in | `zoomIn()` |
| `Ctrl+-` | Zoom out | `zoomOut()` |
| `Ctrl+0` | Fit to view | `fitView()` |
| `Escape` | Deselect all / close panels | `setSelectedNodeId(null)` |
| `Space` + drag | Pan canvas | React Flow built-in (`panOnDrag`) |

**Implementation:**

Single `useEffect` with a `keydown` listener. Use a Map to avoid deeply nested if/else:

```tsx
useEffect(() => {
  const shortcuts: Array<{
    key: string;
    ctrl: boolean;
    shift: boolean;
    handler: () => void;
  }> = [
    { key: "z", ctrl: true, shift: false, handler: handleUndo },
    { key: "z", ctrl: true, shift: true,  handler: handleRedo },
    { key: "c", ctrl: true, shift: false, handler: handleCopy },
    { key: "v", ctrl: true, shift: false, handler: handlePaste },
    { key: "a", ctrl: true, shift: false, handler: handleSelectAll },
    { key: "s", ctrl: true, shift: false, handler: handleSave },
    { key: "f", ctrl: true, shift: false, handler: () => setSearchOpen(true) },
    { key: "=", ctrl: true, shift: false, handler: () => zoomIn() },
    { key: "-", ctrl: true, shift: false, handler: () => zoomOut() },
    { key: "0", ctrl: true, shift: false, handler: () => fitView() },
    { key: "Escape", ctrl: false, shift: false, handler: handleEscape },
  ];

  const listener = (e: KeyboardEvent) => {
    // Skip if user is typing in an input/textarea
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;

    const match = shortcuts.find(
      s => s.key === e.key && s.ctrl === (e.ctrlKey || e.metaKey) && s.shift === e.shiftKey
    );
    if (match) {
      e.preventDefault();
      match.handler();
    }
  };

  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}, [/* all handler dependencies */]);
```

### 3.10 Save Improvements

**Problem:** Save currently makes two sequential API calls (nodes then edges). Node IDs change on every save because the service does delete-all + re-insert.

**Solution A (preferred): Single transactional endpoint**

Create a new endpoint: `PUT /api/workflows/:id/canvas`

Request body:
```json
{
  "nodes": [
    { "nodeType": "input", "name": "Start", "config": {}, "positionX": 50, "positionY": 250 },
    ...
  ],
  "edges": [
    { "fromNodeIndex": 0, "toNodeIndex": 1, "edgeType": "normal", "conditionLabel": null },
    ...
  ]
}
```

Edges reference nodes by index (position in the `nodes` array), not by UUID. The server inserts all nodes in a single transaction, collects the new UUIDs, then maps edges using indices and inserts them.

Service function:

```typescript
export async function updateWorkflowCanvas(
  tenantId: string,
  workflowId: string,
  payload: { nodes: NodeInput[]; edges: EdgeByIndexInput[] },
  userId: string,
) {
  const db = getDb();

  // Single transaction: delete old nodes+edges, insert new ones
  return db.transaction(async (tx) => {
    // Edges cascade-delete when nodes are deleted, so just delete nodes
    await tx.delete(workflowNodes).where(
      and(eq(workflowNodes.workflowId, workflowId), eq(workflowNodes.tenantId, tenantId))
    );

    // Insert nodes
    const insertedNodes = [];
    for (const node of payload.nodes) {
      const [n] = await tx.insert(workflowNodes).values({
        tenantId, workflowId,
        nodeType: node.nodeType as any,
        name: node.name,
        config: node.config || {},
        errorPolicy: node.errorPolicy || DEFAULT_ERROR_POLICY,
        positionX: node.positionX,
        positionY: node.positionY,
      }).returning();
      insertedNodes.push(n);
    }

    // Insert edges using index mapping
    const insertedEdges = payload.edges.length > 0
      ? await tx.insert(workflowEdges).values(
          payload.edges.map((e, i) => ({
            tenantId, workflowId,
            fromNodeId: insertedNodes[e.fromNodeIndex].id,
            toNodeId: insertedNodes[e.toNodeIndex].id,
            conditionLabel: e.conditionLabel || null,
            conditionExpr: e.conditionExpr || null,
            edgeType: e.edgeType || "normal",
            sortOrder: e.sortOrder ?? i,
          }))
        ).returning()
      : [];

    // Audit log
    await createAuditEntry({
      tenantId, userId,
      action: "workflow.update_canvas",
      resourceType: "workflow",
      resourceId: workflowId,
    });

    return { nodes: insertedNodes, edges: insertedEdges };
  });
}
```

Validation schema:

```typescript
export const updateCanvasSchema = z.object({
  nodes: updateNodesSchema,
  edges: z.array(z.object({
    fromNodeIndex: z.number().int().min(0),
    toNodeIndex: z.number().int().min(0),
    conditionLabel: z.string().max(255).optional(),
    conditionExpr: z.string().max(5000).optional(),
    edgeType: z.string().max(50).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })),
});
```

**Dirty indicator:**

The existing `hasChanges` state already tracks this. Move the save button to the toolbar and add an asterisk to the workflow name when dirty:

```tsx
{hasChanges && <span className="text-xs text-amber-500 ml-1">*</span>}
```

**Ctrl+S to save:**

Already covered in 3.9 keyboard shortcuts.

**Unsaved changes warning:**

```tsx
useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => {
    if (hasChanges) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [hasChanges]);
```

---

## 4. Implementation Plan -- Phase 2: Polish

### 4.1 Edge Labels

**Goal:** Render condition/switch/error labels directly on edges.

Labels are already supported in Phase 1 via React Flow's native `label` prop on edges. Phase 2 adds a custom edge label component for richer rendering.

**Custom edge label component:**

```tsx
// components/workflow/canvas-edge-label.tsx

export function CanvasEdgeLabel({ label, edgeType }: { label: string; edgeType: string }) {
  const bgColor = edgeType === "error" ? "bg-red-50 dark:bg-red-950/40"
    : edgeType.startsWith("condition") ? "bg-amber-50 dark:bg-amber-950/40"
    : "bg-card";

  const textColor = edgeType === "error" ? "text-red-600 dark:text-red-400"
    : edgeType.startsWith("condition") ? "text-amber-700 dark:text-amber-300"
    : "text-muted-foreground";

  return (
    <div className={`px-2 py-0.5 rounded-md border border-border shadow-sm ${bgColor}`}>
      <span className={`text-[10px] font-medium ${textColor}`}>{label}</span>
    </div>
  );
}
```

**Label content by edge type:**

| Edge Type | Label Content | Example |
|-----------|--------------|---------|
| `condition_true` | "True" or custom expression | `True` |
| `condition_false` | "False" or custom expression | `False` |
| `switch_case` | Case label from config | `"billing"` |
| `switch_default` | "Default" | `Default` |
| `error` | "error" | `error` |
| `loop_body` | "loop" | `loop` |
| `loop_done` | "done" | `done` |
| `normal` | None | (no label) |

### 4.2 Canvas Search

**Goal:** Ctrl+F opens search bar. Filter nodes by name/type. Highlight matches, dim non-matches.

**UI:** A floating search bar at the top of the canvas (absolute positioned):

```
┌─────────────────────────────────────────────┐
│ 🔍 [Search nodes...________] 2 of 5  ↑ ↓  × │
└─────────────────────────────────────────────┘
```

**State:**

```tsx
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState("");
const [matchIndex, setMatchIndex] = useState(0);
```

**Match logic:**

```tsx
const matchingNodeIds = useMemo(() => {
  if (!searchQuery.trim()) return new Set<string>();
  const q = searchQuery.toLowerCase();
  return new Set(
    nodes
      .filter(n => {
        const d = n.data as Record<string, unknown>;
        return (d.label as string)?.toLowerCase().includes(q)
          || (d.nodeType as string)?.toLowerCase().includes(q);
      })
      .map(n => n.id)
  );
}, [nodes, searchQuery]);
```

**Highlight/dim:**

Apply a CSS class to non-matching nodes when search is active:

```tsx
const styledNodes = useMemo(() => {
  if (!searchOpen || matchingNodeIds.size === 0) return nodes;
  return nodes.map(n => ({
    ...n,
    style: matchingNodeIds.has(n.id) ? {} : { opacity: 0.2, transition: "opacity 0.2s" },
  }));
}, [nodes, searchOpen, matchingNodeIds]);
```

**Navigate between matches (Enter / Shift+Enter):**

```tsx
function navigateMatch(direction: 1 | -1) {
  const matchIds = Array.from(matchingNodeIds);
  if (matchIds.length === 0) return;
  const nextIndex = (matchIndex + direction + matchIds.length) % matchIds.length;
  setMatchIndex(nextIndex);

  // Center view on matched node
  const node = nodes.find(n => n.id === matchIds[nextIndex]);
  if (node) {
    setCenter(node.position.x + 120, node.position.y + 36, { duration: 300, zoom: 1.2 });
  }
}
```

### 4.3 Execution Visualization

**Goal:** During run, nodes light up in sequence. Animated data flow on edges. Per-node badges.

**Data source:**

Run steps are fetched from `GET /api/workflows/:id/runs/:rid` which returns steps with `nodeId`, `status`, `durationMs`. We poll every 2 seconds during an active run.

**Node status overlay:**

The `CustomNode` already supports `runStatus` in its data. During execution view, we merge step data into node data:

```tsx
function mergeRunStatus(flowNodes: Node[], steps: RunStep[]): Node[] {
  const stepMap = new Map(steps.map(s => [s.nodeId, s]));
  return flowNodes.map(n => {
    const step = stepMap.get(n.id);
    if (!step) return n;
    return {
      ...n,
      data: {
        ...n.data,
        runStatus: step.status,
        durationMs: step.durationMs,
      },
    };
  });
}
```

**Status ring styles (already implemented in `canvas-node.tsx`):**

| Status | Visual |
|--------|--------|
| `completed` | Green ring (`ring-2 ring-green-500/60`) |
| `running` | Blue pulsing ring (`ring-2 ring-blue-500/60 animate-pulse`) |
| `failed` | Red ring (`ring-2 ring-red-500/60`) |
| `skipped` | Dimmed (`opacity-40`) |
| `pending` | No ring (default) |

**Animated edges during execution:**

When a step transitions to `running`, the incoming edge gets `animated: true`. When completed, the outgoing edge gets a brief animated flash.

**Per-node cost badge (toggle):**

If a run step has cost data (from `workflow_run_steps` — would need a `cost_usd` column), show it as a small badge below the node:

```tsx
{showCosts && costUsd > 0 && (
  <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-mono bg-card border border-border rounded-md px-1.5 py-0.5 shadow-sm">
    ${costUsd.toFixed(4)}
  </div>
)}
```

**Duration badge (already implemented):**

The existing `durationMs` display in `canvas-node.tsx` already shows this when present.

### 4.4 Sticky Notes / Comments

**Goal:** Right-click canvas to add comment. Resizable, colored, Markdown text.

**Implementation:**

React Flow supports group/annotation nodes. Comments are implemented as a special node type `comment`:

```tsx
const commentNodeType: NodeTypes = {
  custom: CustomNode,
  comment: CommentNode,
};
```

**CommentNode component:**

```tsx
function CommentNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const color = (data.color as string) || "#fef3c7";  // Default: amber-100
  return (
    <div
      className={`rounded-lg p-3 min-w-[160px] min-h-[80px] border ${selected ? "border-primary shadow-md" : "border-border/50 shadow-sm"}`}
      style={{ backgroundColor: color, resize: "both", overflow: "auto" }}
    >
      <div className="text-xs whitespace-pre-wrap">{data.text as string}</div>
    </div>
  );
}
```

**Context menu:**

React Flow's `onPaneContextMenu` event:

```tsx
const onPaneContextMenu = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY });
}, []);
```

Render a small popup menu with "Add Comment" option. On click, insert a comment node at the cursor position.

**Storage:**

Comments are stored as workflow_nodes with `nodeType = "comment"`. This requires adding `comment` to the `workflowNodeTypeEnum` enum:

```sql
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'comment';
```

And updating the Zod validation schema to include `"comment"` in the `nodeType` enum.

Comment nodes are excluded from the execution graph in `graph-builder.ts`.

### 4.5 Node Improvements

**Validation indicator:**

Each node shows a small icon in the top-right corner:

- Green checkmark: all required config fields are filled
- Red warning: missing required fields

```tsx
function validateNodeConfig(nodeType: string, config: Record<string, unknown>): boolean {
  switch (nodeType) {
    case "agent": return !!config.agentId;
    case "llm": return !!config.providerModelId && !!config.userMessage;
    case "condition": return !!config.expression;
    case "switch": return !!config.value && Array.isArray(config.cases) && (config.cases as unknown[]).length > 0;
    case "http_request": return !!config.url;
    case "code": return !!config.code;
    case "sub_workflow": return !!config.workflowId;
    case "knowledge_search": return !!config.knowledgeBaseId;
    default: return true;  // Input, output, delay, etc. have optional config
  }
}
```

Render in node:

```tsx
const isValid = validateNodeConfig(nodeType, config);
{!isValid && (
  <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
    <AlertTriangle className="w-2.5 h-2.5 text-white" />
  </div>
)}
```

**Inline subtitle auto-updates:**

Already implemented in `getNodeSubtitle()`. No changes needed — it reactively updates as config changes.

**Collapse/expand for large nodes:**

For nodes with long subtitles or many config details, add a collapse toggle. Collapsed = icon + label only (height ~48px). Expanded = full detail (current layout).

```tsx
const [collapsed, setCollapsed] = useState(false);
// Double-click node to toggle collapse
```

---

## 5. Implementation Plan -- Phase 3: Differentiators

### 5.1 Semantic Zoom

**Goal:** Node rendering adapts to the current zoom level. Three levels of detail.

**Zoom levels:**

| Zoom Range | Mode | Renders |
|-----------|------|---------|
| > 0.75 | Full | Icon + label + type tag + subtitle + handles + validation badge |
| 0.30 - 0.75 | Compact | Icon + label + handles (no subtitle, no type tag) |
| < 0.30 | Dot | Colored circle (16px) + flow lines (no handles rendered) |

**Implementation:**

Use React Flow's `useStore` to read the current zoom level:

```tsx
import { useStore } from "@xyflow/react";

function CustomNode({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const zoom = useStore((state) => state.transform[2]);

  if (zoom < 0.3) return <DotNode color={NODE_COLOR_MAP[nodeType]} />;
  if (zoom < 0.75) return <CompactNode data={data} selected={selected} />;
  return <FullNode data={data} selected={selected} />;
}
```

**DotNode:**

```tsx
function DotNode({ color }: { color: string }) {
  return (
    <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: color }}>
      <Handle type="target" position={Position.Left} className="!w-1 !h-1 !opacity-0" />
      <Handle type="source" position={Position.Right} className="!w-1 !h-1 !opacity-0" />
    </div>
  );
}
```

**CompactNode:**

```tsx
function CompactNode({ data, selected }: Props) {
  const nodeType = data.nodeType as string;
  const Icon = NODE_ICON_MAP[nodeType] || Play;
  const color = NODE_COLOR_MAP[nodeType] || "#6b7280";

  return (
    <div className={`rounded-lg bg-card px-2.5 py-1.5 border border-border ${selected ? "shadow-md" : "shadow-sm"}`}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
      <Handle type="target" position={Position.Left} id="target" ... />
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[11px] font-medium truncate max-w-[120px]">{data.label as string}</span>
      </div>
      <Handle type="source" position={Position.Right} id="source" ... />
    </div>
  );
}
```

### 5.2 Per-Node Cost Overlay

**Goal:** Toggle button shows token usage and cost on each LLM/Agent node.

**Data requirement:**

The `workflow_run_steps` table needs additional columns:

```sql
ALTER TABLE workflow_run_steps
  ADD COLUMN IF NOT EXISTS tokens_input  INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_output INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC(10,6);
```

These are populated by the node handlers in `node-handlers.ts` when executing LLM or Agent nodes (both of which call the provider bridge and receive token counts in the response).

**UI overlay:**

When cost mode is active, LLM and Agent nodes show a bottom badge:

```
┌──────────────────────────────┐
│  🤖  Agent Call              │
│  agent · Reviewer            │
│                              │
│  ┌────────────────────────┐  │
│  │ ↑ 1,240  ↓ 856  $0.02 │  │  <-- cost badge
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Color scale:**

| Cost Range | Color |
|-----------|-------|
| $0.000 - $0.01 | Green (`text-green-600`) |
| $0.01 - $0.10 | Amber (`text-amber-600`) |
| > $0.10 | Red (`text-red-600`) |

**Toolbar toggle:**

```tsx
const [showCosts, setShowCosts] = useState(false);

<Button variant="ghost" size="sm" onClick={() => setShowCosts(!showCosts)}
  className={showCosts ? "bg-muted" : ""}>
  <DollarSign className="h-3.5 w-3.5 mr-1" /> Costs
</Button>
```

### 5.3 Execution Playback

**Goal:** Timeline scrubber to step through execution visually.

**UI:**

A horizontal bar at the bottom of the canvas:

```
┌──────────────────────────────────────────────────────────────┐
│ ◀ ▶ ⏸  1x  │  Step 3/8  │ ●──●──●──●──○──○──○──○  │  2.4s │
└──────────────────────────────────────────────────────────────┘
```

**Data model:**

Steps are ordered by `startedAt` timestamp. Each step has a `nodeId` that maps to a canvas node.

**State:**

```tsx
const [playbackStep, setPlaybackStep] = useState<number | null>(null);
const [isPlaying, setIsPlaying] = useState(false);
const [playbackSpeed, setPlaybackSpeed] = useState(1);  // 1x, 2x, 4x
```

**Playback logic:**

```tsx
useEffect(() => {
  if (!isPlaying || playbackStep === null || playbackStep >= steps.length - 1) return;
  const timer = setTimeout(() => {
    setPlaybackStep(p => (p ?? 0) + 1);
  }, 1000 / playbackSpeed);
  return () => clearTimeout(timer);
}, [isPlaying, playbackStep, playbackSpeed, steps.length]);
```

**Visual state at each step:**

At step N, all steps 0..N-1 are "completed" (green), step N is "running" (blue pulse), steps N+1..end are "pending" (default). This is applied via `mergeRunStatus`.

**Scrubber interaction:**

The timeline dots are clickable. Clicking a dot jumps to that step and pauses playback. Dragging scrubs through steps.

### 5.4 Ghost Node Suggestions

**Goal:** After connecting a node output, show a faint suggested next node.

**Trigger:** When a source handle has no outgoing edge, show a ghost "+" node 120px to the right.

**Common patterns:**

| Current Node Type | Suggested Next |
|-------------------|---------------|
| `input` | `llm` or `agent` |
| `llm` | `transform` or `condition` |
| `agent` | `condition` or `output` |
| `condition` (true) | `llm` or `agent` |
| `condition` (false) | `output` or `delay` |
| `transform` | `output` or `condition` |
| `http_request` | `transform` or `condition` |
| `knowledge_search` | `llm` |
| `code` | `transform` or `output` |

**GhostNode component:**

```tsx
function GhostNode({ position, suggestions, onSelect }: {
  position: { x: number; y: number };
  suggestions: string[];
  onSelect: (nodeType: string) => void;
}) {
  return (
    <div
      className="absolute pointer-events-auto opacity-30 hover:opacity-80 transition-opacity cursor-pointer"
      style={{ left: position.x, top: position.y, transform: "translate(-50%, -50%)" }}
    >
      <div className="w-10 h-10 rounded-xl border-2 border-dashed border-muted-foreground/40 flex items-center justify-center">
        <Plus className="w-4 h-4 text-muted-foreground/60" />
      </div>
    </div>
  );
}
```

On click, show a mini palette dropdown with the suggested node types. Selecting one inserts the node at that position and creates an edge from the source.

---

## 6. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `web/src/components/workflow/canvas-inner.tsx` | Inner canvas component (extracted from `canvas.tsx` for `useReactFlow` access) |
| `web/src/components/workflow/canvas-edge-label.tsx` | Custom edge label component with colored backgrounds |
| `web/src/components/workflow/canvas-comment.tsx` | Comment/sticky note node type |
| `web/src/components/workflow/canvas-toolbar.tsx` | Toolbar with undo/redo, tidy up, fit, search, costs, save |
| `web/src/components/workflow/canvas-search.tsx` | Floating search bar overlay |
| `web/src/components/workflow/canvas-ghost.tsx` | Ghost node suggestion component |
| `web/src/components/workflow/canvas-playback.tsx` | Execution playback timeline scrubber |
| `web/src/hooks/use-undo-redo.ts` | Undo/redo state stack hook |
| `web/src/lib/canvas-layout.ts` | Auto-layout using dagre (left-to-right) |
| `web/src/lib/canvas-handles.ts` | Handle generation logic per node type |
| `web/src/lib/canvas-validation.ts` | Node config validation functions |
| `web/src/app/api/workflows/[id]/canvas/route.ts` | New single-transaction save endpoint |
| `packages/validation/src/workflows.ts` | Updated: add `updateCanvasSchema` |
| `packages/database/src/migrations/022_canvas_overhaul.sql` | Migration: new edge types, comment node type, run step cost columns |

### Modified Files

| File | Changes |
|------|---------|
| `web/src/components/workflow/canvas.tsx` | Extract inner component, add ReactFlowProvider wrapper, pass toolbar/search/playback props |
| `web/src/components/workflow/canvas-node.tsx` | Left/right handles, multi-output ports, semantic zoom, validation badge, cost badge |
| `web/src/components/workflow/canvas-types.ts` | Update EDGE_STYLES with new edge types, add HANDLE_DEFS export |
| `web/src/components/workflow/node-palette.tsx` | Add drag-and-drop support (`draggable`, `onDragStart`), drag preview element, collapsible state |
| `web/src/components/workflow/node-config-panel.tsx` | Switch node: editable cases list. Collapsible panel state. Comment node config. |
| `web/src/app/(platform)/workflows/components/workflow-detail.tsx` | Full-height layout, new save handler for `/canvas` endpoint, execution view with playback |
| `web/src/lib/services/workflow.ts` | Add `updateWorkflowCanvas()` transactional save function |
| `packages/types/src/domain/workflow.ts` | Add `sourceHandle`/`targetHandle` to WorkflowEdge, add `RunStepCost` interface |
| `packages/database/src/schema/workflows.ts` | Add cost columns to workflowRunSteps |
| `packages/database/src/schema/enums.ts` | Add `comment` to `workflowNodeTypeEnum` (if needed for migration) |

---

## 7. Migration Plan

### Database Migration (022_canvas_overhaul.sql)

```sql
-- Migration 022: Canvas Overhaul
-- Adds comment node type, cost tracking on run steps, source/target handle columns on edges

-- 1. Comment node type
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'comment';

-- 2. Source/target handle tracking on edges
ALTER TABLE workflow_edges
  ADD COLUMN IF NOT EXISTS source_handle TEXT NOT NULL DEFAULT 'source',
  ADD COLUMN IF NOT EXISTS target_handle TEXT NOT NULL DEFAULT 'target';

-- 3. Cost tracking on run steps
ALTER TABLE workflow_run_steps
  ADD COLUMN IF NOT EXISTS tokens_input  INTEGER,
  ADD COLUMN IF NOT EXISTS tokens_output INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC(10,6);

-- 4. Backfill existing edge types to new handle conventions
-- Existing edges with edge_type='normal' keep source_handle='source', target_handle='target'
-- No data migration needed — old edges use default handles which is correct for standard nodes
-- Switch/condition edges that existed before will need manual re-wiring by users
-- (or auto-migration in the converter layer)
```

### Converter-Layer Migration (Zero-Downtime)

Existing workflows have top-down positioning and no `sourceHandle`/`targetHandle` on edges. The converter functions handle both old and new data:

**Position handling:**

Positions are coordinate-neutral — `positionX`/`positionY` are just absolute coordinates. The switch from top-down to left-right is purely a handle position change in the React component. Old workflows will render with their existing positions but with horizontal connections. Users can click "Tidy Up" to re-layout.

**Edge handle migration:**

The `toFlowEdges` converter already resolves `sourceHandle` from the source node type (see 3.2). For existing edges that do not have `source_handle` in the DB (or have the default `'source'`), the converter inspects the source node type:

```tsx
function resolveSourceHandle(sourceNode: WorkflowNode | undefined, edge: WorkflowEdge): string {
  // If DB has explicit handle, use it
  if (edge.sourceHandle && edge.sourceHandle !== "source") return edge.sourceHandle;

  // Otherwise, infer from source node type and edge metadata
  if (!sourceNode) return "source";
  switch (sourceNode.nodeType) {
    case "condition":
      return edge.conditionLabel?.toLowerCase() === "false" ? "source-false" : "source-true";
    case "switch":
      return edge.conditionLabel?.toLowerCase() === "default" ? "source-default" : `source-case-${edge.sortOrder}`;
    case "loop":
      return edge.edgeType === "loop_done" ? "source-loop-done" : "source-loop-body";
    default:
      return "source";
  }
}
```

This ensures old data renders correctly without a data migration. When the user saves, the new handle values are written to the DB.

### Backward Compatibility

The old `PUT /api/workflows/:id/nodes` and `PUT /api/workflows/:id/edges` endpoints remain functional. The new `PUT /api/workflows/:id/canvas` endpoint is additive. This allows a phased rollout — the frontend switches to the new endpoint while the old endpoints continue to work for any direct API consumers.

### Drizzle Schema Update

Add new columns to the `workflowEdges` table definition:

```typescript
export const workflowEdges = pgTable("workflow_edges", {
  // ... existing columns ...
  sourceHandle: text("source_handle").notNull().default("source"),
  targetHandle: text("target_handle").notNull().default("target"),
});
```

Add new columns to the `workflowRunSteps` table definition:

```typescript
export const workflowRunSteps = pgTable("workflow_run_steps", {
  // ... existing columns ...
  tokensInput:  integer("tokens_input"),
  tokensOutput: integer("tokens_output"),
  costUsd:      numeric("cost_usd", { precision: 10, scale: 6 }),
});
```

### WorkflowEdge Type Update

```typescript
// packages/types/src/domain/workflow.ts
export interface WorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionLabel: string | null;
  conditionExpr: string | null;
  edgeType?: string;
  sortOrder: number;
  sourceHandle?: string;    // NEW
  targetHandle?: string;    // NEW
}
```

---

## 8. Test Plan

### Unit Tests

| Test Suite | File | Covers |
|-----------|------|--------|
| Handle generation | `canvas-handles.test.ts` | `getNodeHandles()` returns correct handles for all 17+1 node types |
| Source handle resolution | `canvas-handles.test.ts` | `resolveSourceHandle()` maps edge metadata to correct handle IDs |
| Edge conversion (to flow) | `canvas.test.ts` | `toFlowEdges()` produces correct `sourceHandle`, `targetHandle`, `type`, `label`, `style` |
| Edge conversion (from flow) | `canvas.test.ts` | `fromFlowEdge()` extracts correct `edgeType`, `sortOrder`, `conditionLabel` |
| Auto-layout | `canvas-layout.test.ts` | `autoLayout()` produces non-overlapping positions, respects LR direction |
| Undo/redo stack | `use-undo-redo.test.ts` | Push, undo, redo, max history truncation, redo discard on new push |
| Node validation | `canvas-validation.test.ts` | `validateNodeConfig()` correctly identifies missing required fields per type |
| Copy/paste ID generation | `canvas.test.ts` | Pasted nodes have unique IDs, edges reference new IDs correctly |
| Semantic zoom thresholds | `canvas-node.test.ts` | Correct component rendered at zoom 0.2, 0.5, 0.9 |

### Browser / Integration Tests

| Test | Steps | Expected |
|------|-------|----------|
| Drag-and-drop from palette | Drag "LLM" from palette onto canvas | Node appears at drop position |
| Connect two nodes | Drag from source handle to target handle | Edge created with smoothstep curve |
| Multi-output connection | Drag from Switch "Case A" handle to a node | Edge connected to `source-case-0` handle |
| Delete node | Select node, press Delete | Node removed, connected edges removed |
| Undo add node | Add node, press Ctrl+Z | Node removed |
| Undo delete | Delete node, Ctrl+Z | Node and edges restored |
| Redo | Undo, then Ctrl+Shift+Z | Change re-applied |
| Multi-select lasso | Drag lasso around 3 nodes | All 3 selected (blue outlines) |
| Copy/paste | Select 2 nodes, Ctrl+C, Ctrl+V | 2 new nodes appear offset by 40px |
| Auto-layout | Add 5 nodes randomly, click Tidy Up | Nodes arranged left-to-right with even spacing |
| Save (transactional) | Add nodes and edges, Ctrl+S | Single API call to `/canvas`, page shows saved state |
| Save dirty indicator | Modify a node | Asterisk appears next to title, Save button visible |
| Unsaved changes warning | Modify canvas, try to navigate away | Browser shows "unsaved changes" dialog |
| Search | Ctrl+F, type "agent" | Matching nodes highlighted, others dimmed |
| Search navigate | In search, press Enter | Canvas centers on next match |
| Keyboard shortcuts | Press Ctrl+A | All nodes selected |
| Collapsible palette | Click collapse button on palette | Palette shrinks to icon strip |

### Visual Regression Tests

Capture screenshots and compare before/after for:

1. Empty canvas (no nodes)
2. Linear flow: Input -> LLM -> Output (3 nodes)
3. Branching flow: Input -> Condition -> True/False branches -> Output
4. Switch flow: Input -> Switch with 4 cases -> 4 target nodes
5. Loop flow: Input -> Loop (body + done) with loop-back edge
6. Large flow: 20+ nodes in complex DAG
7. Dark mode variants of all above
8. Collapsed palette state
9. Search active with matches
10. Execution visualization (nodes with status rings)

### Performance Tests

| Scenario | Target | Metric |
|----------|--------|--------|
| 50 nodes + 60 edges | < 16ms per frame | FPS during pan/zoom |
| 100 nodes + 120 edges | < 16ms per frame | FPS during pan/zoom |
| 200 nodes + 250 edges | < 33ms per frame | FPS during pan/zoom (30fps acceptable) |
| Add node to 100-node canvas | < 50ms | Time from click to render |
| Auto-layout 100 nodes | < 500ms | Time from click to layout complete |
| Save 100 nodes + 120 edges | < 2s | API round-trip time |
| Undo with 50 states in stack | < 16ms | Time from Ctrl+Z to render |

**Performance optimizations if needed:**

1. Use `React.memo` on `CustomNode` with shallow comparison
2. Use React Flow's `nodeOrigin` to reduce re-renders
3. Disable MiniMap when > 150 nodes
4. Virtualize node rendering (React Flow supports this via `onlyRenderVisibleElements`)
5. Debounce `pushState` for drag operations (push on `onNodeDragStop`, not every frame)

---

## 9. Implementation Order

### Step 1: Foundation Restructure (2 days)

**Dependencies:** None
**Files:** `canvas.tsx`, `canvas-inner.tsx`, `canvas-toolbar.tsx`

1. Extract canvas internals from `canvas.tsx` into `canvas-inner.tsx` (required for `useReactFlow()` hook access)
2. Wrap with `ReactFlowProvider` in `canvas.tsx`
3. Create `canvas-toolbar.tsx` with Save button (moved from floating position)
4. Change canvas container from fixed 640px to flex-fill height
5. Update `workflow-detail.tsx` to use flex layout

**Acceptance:** Canvas renders full-height. Toolbar shows Save button. All existing functionality preserved.

### Step 2: Handle Architecture (2 days)

**Dependencies:** Step 1
**Files:** `canvas-node.tsx`, `canvas-handles.ts`, `canvas-types.ts`

1. Create `canvas-handles.ts` with `getNodeHandles()` function
2. Update `CustomNode` — replace top/bottom handles with left/right
3. Add multi-output handle rendering for condition, switch, loop
4. Node height auto-expansion based on handle count
5. Handle label rendering next to multi-output handles

**Acceptance:** All nodes render with left input / right output handles. Condition shows True/False ports. Switch shows case ports. Input node has no left handle. Output node has no right handle.

### Step 3: Edge Overhaul (1.5 days)

**Dependencies:** Step 2
**Files:** `canvas.tsx` (converters), `canvas-types.ts`, `canvas-inner.tsx`

1. Change edge type from `default` to `smoothstep`
2. Update `EDGE_STYLES` with new edge type keys
3. Update `toFlowEdges()` — resolve `sourceHandle`/`targetHandle`, add labels
4. Update save logic — replace color inference with `fromFlowEdge()` handle-based extraction
5. Add edge label styling (background, colors)

**Acceptance:** Edges render as smooth curves. Condition edges show "True"/"False" labels. Switch edges show case labels. Edge types stored correctly on save.

### Step 4: Drag-and-Drop (1 day)

**Dependencies:** Step 1
**Files:** `node-palette.tsx`, `canvas-inner.tsx`

1. Add `draggable` and `onDragStart` to palette items
2. Add `onDragOver` and `onDrop` handlers on canvas
3. Use `screenToFlowPosition` for drop coordinates
4. Create drag preview element
5. Keep click-to-add as fallback

**Acceptance:** Dragging a node type from palette onto canvas creates a node at the drop position.

### Step 5: Undo/Redo (1.5 days)

**Dependencies:** Step 1
**Files:** `use-undo-redo.ts`, `canvas-inner.tsx`, `canvas-toolbar.tsx`

1. Implement `useUndoRedo` hook with state stack (max 50)
2. Integrate into canvas: push state on add/delete/move/connect/config-change
3. Add Ctrl+Z / Ctrl+Shift+Z keyboard handlers
4. Add undo/redo buttons to toolbar with disabled state

**Acceptance:** Ctrl+Z undoes last action. Ctrl+Shift+Z redoes. Toolbar buttons reflect available undo/redo count.

### Step 6: Multi-Select + Copy/Paste (1 day)

**Dependencies:** Step 5 (undo integration)
**Files:** `canvas-inner.tsx`

1. Enable React Flow's `selectionOnDrag` and `multiSelectionKeyCode`
2. Implement clipboard ref with copy/paste logic
3. New ID generation for pasted nodes
4. Edge reconnection for pasted subgraphs
5. Add Ctrl+C/V/A keyboard handlers

**Acceptance:** Shift+click adds to selection. Lasso selects multiple nodes. Ctrl+C/V copies and pastes with new IDs.

### Step 7: Auto-Layout (1 day)

**Dependencies:** Step 2 (handle architecture)
**Files:** `canvas-layout.ts`, `canvas-toolbar.tsx`, `canvas-inner.tsx`

1. Install `@dagrejs/dagre`
2. Implement `autoLayout()` with LR direction
3. Add "Tidy Up" button to toolbar
4. Fit view after layout with animation

**Acceptance:** Clicking "Tidy Up" re-positions all nodes in a clean left-to-right DAG layout.

### Step 8: Transactional Save (1.5 days)

**Dependencies:** Step 3 (edge format)
**Files:** `route.ts` (new endpoint), `workflow.ts` (service), `workflows.ts` (validation), `canvas-inner.tsx`

1. Create `updateCanvasSchema` in validation package
2. Create `updateWorkflowCanvas()` service function with single transaction
3. Create `PUT /api/workflows/:id/canvas` route
4. Update frontend save handler to call new endpoint with index-based edges
5. Add `beforeunload` warning for unsaved changes
6. Add Ctrl+S keyboard shortcut

**Acceptance:** Save is a single API call. Nodes and edges are created atomically. Navigating away with unsaved changes shows warning.

### Step 9: Database Migration (0.5 days)

**Dependencies:** Step 8
**Files:** `022_canvas_overhaul.sql`, `workflows.ts` (Drizzle schema), `workflow.ts` (types)

1. Write and test migration SQL
2. Update Drizzle schema definitions
3. Update TypeScript interfaces
4. Test migration on dev database

**Acceptance:** Migration runs without errors. New columns present. Old data intact.

### Step 10: Switch Config Panel (1 day)

**Dependencies:** Step 2 (multi-output handles)
**Files:** `node-config-panel.tsx`

1. Replace Switch node's simple config with editable cases list
2. Add/remove case buttons
3. Each case has label + match expression fields
4. Cases sync with output handles on the node

**Acceptance:** Switch config panel shows editable case list. Adding a case adds a new output handle on the node.

### Step 11: Keyboard Shortcuts (0.5 days)

**Dependencies:** Steps 5, 6
**Files:** `canvas-inner.tsx`

1. Implement full shortcut map (all shortcuts from 3.9)
2. Add input/textarea exclusion (no shortcuts while typing in config panel)
3. Test all shortcuts

**Acceptance:** All 12 shortcuts work as documented. No conflicts with browser defaults.

### Step 12: Collapsible Sidebars (0.5 days)

**Dependencies:** Step 1
**Files:** `canvas.tsx`, `node-palette.tsx`, `node-config-panel.tsx`

1. Add collapse/expand state for palette
2. Add collapse/expand state for config panel
3. Collapsed palette: 40px icon-only strip
4. Collapsed config: hidden (toggle button on canvas edge)

**Acceptance:** Both sidebars collapse and expand. Canvas resizes to fill available space.

---

### Phase 2 Steps (after Phase 1 stable)

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 13 | Custom edge labels | 1 day | Step 3 |
| 14 | Canvas search (Ctrl+F) | 1.5 days | Step 1 |
| 15 | Execution visualization | 2 days | Step 9 (cost columns) |
| 16 | Sticky notes / comments | 1.5 days | Step 9 (comment node type) |
| 17 | Node validation indicators | 0.5 days | Step 2 |
| 18 | Node collapse/expand | 0.5 days | Step 2 |

### Phase 3 Steps (after Phase 2 stable)

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 19 | Semantic zoom | 2 days | Step 2 |
| 20 | Per-node cost overlay | 1.5 days | Step 15 |
| 21 | Execution playback | 3 days | Step 15 |
| 22 | Ghost node suggestions | 1.5 days | Step 4 |

---

### Total Effort Estimate

| Phase | Steps | Effort |
|-------|-------|--------|
| Phase 1 (Foundation) | 1-12 | ~13 days |
| Phase 2 (Polish) | 13-18 | ~7 days |
| Phase 3 (Differentiators) | 19-22 | ~8 days |
| **Total** | **22 steps** | **~28 days** |

Phase 1 alone brings the canvas to industry parity (left-right handles, multi-port, smooth edges, drag-and-drop, undo/redo, copy/paste, auto-layout, transactional save). Phases 2 and 3 add the differentiation that makes this canvas best-in-class.
