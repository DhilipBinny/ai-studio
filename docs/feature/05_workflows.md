# 05 - Workflows

Visual multi-step workflow builder with node-based canvas editor, expression engine, graph execution, retry logic, parallel branches, and human-in-the-loop review.

---

## 0. Architecture Overview

### Module Map

```
ai-studio-app/packages/agent-runtime/src/workflow/
├── types.ts               Shared interfaces: WorkflowState, GraphNode, GraphEdge,
│                          ExecutionGraph, NodeResult, NodeErrorPolicy, RESERVED_STATE_KEYS
├── expression-engine.ts   Template resolution ({{path}}), condition evaluation,
│                          normalizeKey() for state keys
├── graph-builder.ts       buildExecutionGraph(): nodes/edges → adjacency lists + inDegree + startNodeId
│                          (loop_back edges excluded from graph)
├── graph-executor.ts      executeGraph(): step-by-step traversal with parallel/sequential dispatch
│                          (MAX_STEPS=200, MAX_PARALLEL=10)
├── node-handlers.ts       executeNode(): per-type handler switch (17 types),
│                          getNextNodes(): edge resolution (error → switch → conditional → default),
│                          executeLoopNode(), executeIterationNode(), resolveAggregate()
├── step-recorder.ts       createStepRecorder(): wraps each execution with DB step row + progress spans
├── retry.ts               executeNodeWithRetry(): retry loop with backoff + timeout + heartbeat
├── recovery.ts            recoverStaleWorkflowRuns(): marks stale steps (90s heartbeat) + timed-out runs
└── index.ts               triggerWorkflow(): entry point — validates, loads nodes/edges, builds graph, runs
                           resumeWorkflow(): continues from paused human_review node
```

### Execution Model

```
triggerWorkflow(workflowId, tenantId, userId, input)
    │
    ▼
Validate workflow (exists, status=active, has nodes)
    │
    ▼
INSERT workflow_runs (status=running, timeout=now+1h)
    │
    ▼
Build execution graph:
    nodes[] ──► Map<id, GraphNode>
    edges[] ──► adjacency (exclude loop_back) + reverseAdj + inDegree
    startNodeId = input node || in-degree-0 node || first node
    │
    ▼
Initialize state = { input }
    │
    ▼
executeGraph(graph, edges, state, runId, ...)
    │
    ▼
┌─── STEP LOOP (max 200 steps) ────────────────────────────────────┐
│                                                                    │
│  Classify ready nodes → sequential vs parallel                     │
│                                                                    │
│  Parallel path (>1 ready, non-loop/iteration):                     │
│      Promise.allSettled() up to MAX_PARALLEL=10                    │
│      Failed nodes → state[key] = { _error: true, message }        │
│      Error-branch routing if errorPolicy says so                   │
│                                                                    │
│  Sequential path (1 ready):                                        │
│      loop/iteration → dedicated executors with body-node traversal │
│      aggregate → waits for all predecessors, then merges outputs   │
│      other → recordStep() → executeNodeWithRetry() → executeNode() │
│                                                                    │
│  After execution:                                                  │
│      state[normalizeKey(nodeName)] = output                        │
│      Persist state to workflow_runs.output                         │
│      Resolve next nodes via getNextNodes()                         │
│      Break if output node reached or no more ready nodes           │
│                                                                    │
│  On pause (human_review):                                          │
│      Set run status=waiting, return paused=true                    │
└────────────────────────────────────────────────────────────────────┘
    │
    ▼
Complete: status=completed, output=full state
Failed:   status=failed, errorMessage captured
Paused:   status=waiting, output=partial state
```

### State Model

Data flows between nodes via a flat state object. Each node's output is stored at `state[normalizeKey(nodeName)]` where `normalizeKey` lowercases the name and replaces spaces with underscores (e.g., node "Document Reviewer" writes to `state.document_reviewer`).

Reserved keys (`_error`, `_loop`, `_iteration`, `_parallel`, `_warnings`) are used by the engine for internal bookkeeping:
- `_loop` — `{ counter, previous }` injected during loop body execution, cleaned up after
- `_iteration` — `{ index, item, total }` injected per iteration item, cleaned up after
- `_parallel` — reserved but currently unused (reserved for future parallel-branch metadata)
- `_warnings` — unreached-node messages appended at the end of execution

Expression templates (`{{path.to.value}}`) resolve against this state object with dot-notation traversal, max depth 10, and prototype-pollution blocked keys.

### Error Handling: 3 Policies

```
Node fails (after maxRetries+1 attempts exhausted)
    │
    ├── onError = "stop"           → throw error → workflow fails
    │
    ├── onError = "continue"       → output = { _error: true, message, attempt }
    │                                 workflow continues to normal next nodes
    │
    └── onError = "error_branch"   → output = { _error: true, message, nodeId, attempt }
                                     useErrorBranch = true
                                     getNextNodes() follows only edgeType="error" edges
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `MAX_STEPS = 200` | Prevents infinite execution in pathological graphs. A 17-node workflow with loops and iterations can realistically produce ~100 steps; 200 gives headroom while capping cost and runtime. |
| `MAX_PARALLEL = 10` | Limits concurrent node execution to prevent resource exhaustion from wide fan-out patterns. Parallel paths beyond 10 are batched. |
| Loop-back edges excluded from graph build | `loop_back` edges create cycles in the directed graph. Excluding them from adjacency and in-degree computation allows topological traversal to proceed; the loop executor handles iteration internally by re-executing body nodes. |
| 15-second heartbeat per step | The recovery sweep marks steps as stale after 90 seconds of no heartbeat. A 15-second interval ensures at least 6 heartbeats before a step would be considered stale, preventing false positives during slow LLM or HTTP calls. |
| Lazy import for `triggerWorkflow` in sub_workflow handler | `node-handlers.ts` calls `runSession()` (for agent nodes) and `triggerWorkflow()` (for sub_workflow nodes). Since `graph-executor.ts` imports from `node-handlers.ts`, and `index.ts` imports from `graph-executor.ts`, a direct import of `triggerWorkflow` from `index.ts` would create a circular dependency. The lazy `import()` breaks the cycle at runtime. |
| State persisted after every step batch | `workflow_runs.output = state` is updated after each iteration of the step loop. If the server crashes mid-execution, recovery can resume from the last persisted state rather than losing all progress. |

---

## 1. Workflow CRUD

### 1.1 Behavior

- Workflows are scoped to a tenant. Name must be unique per tenant (enforced by DB unique constraint `tenantId + name`).
- Every update increments a `version` counter (`version = version + 1`).
- Status lifecycle: `draft` -> `active` -> `disabled` -> `archived`.
- Soft delete via `is_active = false` (no hard delete API exposed).
- Create defaults: `status = "draft"`, `version = 1`, `triggerConfig = { type: "manual" }`.
- All write operations create audit log entries.

### 1.2 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/workflows` | RBAC: WORKFLOWS level 10 | Paginated list of active workflows |
| POST | `/api/workflows` | RBAC: WORKFLOWS level 20 | Create workflow |
| GET | `/api/workflows/[id]` | RBAC: WORKFLOWS level 10 | Detail with nodes + edges |
| PATCH | `/api/workflows/[id]` | RBAC: WORKFLOWS level 20 | Update name, description, status, triggerConfig |

**GET /api/workflows** query params: `page`, `pageSize` (via `paginationSchema`).

**POST /api/workflows** request body:
```json
{
  "name": "string (1-100 chars, required)",
  "description": "string (max 500, optional)",
  "triggerConfig": "object (optional)"
}
```

**PATCH /api/workflows/[id]** request body:
```json
{
  "name": "string (1-100, optional)",
  "description": "string (max 500, optional)",
  "status": "draft | active | disabled | archived (optional)",
  "triggerConfig": "object (optional)"
}
```

**Error codes:**
- `NAME_EXISTS` (409) -- duplicate name in same tenant.
- `NOT_FOUND` (404) -- workflow not found or wrong tenant.
- `VALIDATION_ERROR` (400) -- Zod schema failure.

### 1.3 DB Table: `workflows`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK -> tenants | cascade delete |
| name | text | not null |
| description | text | default "" |
| trigger_config | jsonb | default {} |
| status | workflow_status enum | draft, active, disabled, archived |
| version | integer | default 1, incremented on update |
| tags | text[] | default [] |
| is_active | boolean | default true (soft delete) |
| deactivated_at | timestamptz | null until deactivated |
| created_by | uuid FK -> users | set null on delete |
| created_at | timestamptz | defaultNow |
| updated_at | timestamptz | defaultNow |

**Indexes:** `idx_workflows_tenant(tenant_id)`, `idx_workflows_status(tenant_id, status)`.
**Unique constraint:** `(tenant_id, name)`.

### 1.4 Validation Schemas

Defined in `packages/validation/src/workflows.ts`:

- `createWorkflowSchema` -- name (1-100), description (max 500 optional), triggerConfig (optional).
- `updateWorkflowSchema` -- all fields optional; status constrained to enum.
- `triggerWorkflowSchema` -- input (optional object, the workflow trigger data).
- `resumeWorkflowSchema` -- decision (required object, the human review decision).

---

## 2. Canvas Editor (Visual Node/Edge Builder)

### 2.1 Behavior

The canvas is a React client component (`WorkflowCanvas`) built on **@xyflow/react** (React Flow). It provides:

- **Node Palette** (left sidebar): categorized list of all 17 node types grouped into Flow Control, AI, Action, Data, Human. Clicking a palette item adds a new node to the canvas.
- **Visual Canvas** (center): drag-and-drop node positioning, connect nodes by drawing edges from source handles (bottom) to target handles (top). Supports snap-to-grid (20px grid), zoom, pan, minimap, and keyboard delete (Backspace/Delete).
- **Node Config Panel** (right sidebar): opens on node click. Two tabs -- "Config" for node-specific settings and "Error Policy" for retry/error behavior. Includes a delete button.
- **Save button**: appears when unsaved changes exist. Persists nodes and edges via separate PUT calls.

### 2.2 Canvas Architecture

| Component | File | Role |
|-----------|------|------|
| WorkflowCanvas | `web/src/components/workflow/canvas.tsx` | Main canvas with ReactFlow, palette, config panel |
| CustomNode | `web/src/components/workflow/canvas-node.tsx` | Rendered node card with icon, label, subtitle, status ring |
| NodePalette | `web/src/components/workflow/node-palette.tsx` | Left sidebar with add buttons |
| NodeConfigPanel | `web/src/components/workflow/node-config-panel.tsx` | Right sidebar for editing selected node |
| canvas-types.ts | `web/src/components/workflow/canvas-types.ts` | NODE_REGISTRY, edge styles, color maps |

### 2.3 Node Subtitle Display

The `CustomNode` component shows contextual subtitles per node type:

| Node Type | Subtitle shown |
|-----------|---------------|
| agent | Agent name |
| llm | First 45 chars of userMessage |
| condition | First 40 chars of expression |
| switch | First 40 chars of value |
| http_request | "METHOD url..." |
| loop | "N iterations" or "while condition" |
| iteration | "parallel/seq . arrayPath..." |
| delay | "Ns" or "dynamic" |
| code | First line (35 chars) |
| aggregate | Strategy name |

### 2.4 Save Flow

1. Nodes are serialized from ReactFlow format to `{ nodeType, name, config, errorPolicy, positionX, positionY }`.
2. Edges are serialized to `{ fromNodeId, toNodeId, conditionLabel, edgeType }`.
3. Two sequential API calls: `PUT /api/workflows/[id]/nodes`, then `PUT /api/workflows/[id]/edges`.
4. Canvas refreshes from server after save.

### 2.5 UI Page

**Route:** `/(platform)/workflows`

- **List view**: grid of workflow cards (3 columns on large screens) showing name, description, status dot (green=active, amber=draft, gray=other), version, relative time.
- **Detail view**: `WorkflowDetail` component with workflow header, status badge, tabs (Nodes / Runs), canvas editor, run dialog.
- **Create dialog**: modal form with name (required) and description fields.
- **Run dialog**: modal with JSON textarea for input, triggers workflow execution.

---

## 3. Node Types

17 node types registered in `workflowNodeTypeEnum` and `NODE_REGISTRY`:

### 3.1 Flow Control Nodes

| Type | Category | Color | Description | Config Fields |
|------|----------|-------|-------------|--------------|
| `input` | flow | #3b82f6 | Entry point -- passes trigger data | (none -- outputs `state.input`) |
| `output` | flow | #10b981 | Terminal -- formats final result | `mappings[]` (key/value pairs) |
| `condition` | flow | #f59e0b | If/else branch on expression | `expression` (template string). Evaluates expression and routes via `condition_true`/`condition_false` edge types. |
| `switch` | flow | #ea580c | Multi-branch routing by value | `value`, `cases[]` (label+condition), `defaultCase` |
| `loop` | flow | #6366f1 | Repeat until condition met | `mode` (while/for_count), `condition`, `maxCount`, `maxIterations` (safety cap, default 100) |
| `iteration` | flow | #7c3aed | Process array items | `arrayPath`, `parallel`, `batchSize`, `maxItems` (default 1000), `itemVariable` |
| `delay` | flow | #94a3b8 | Wait for specified duration | `delayMs` (clamped 0-300000), `delayExpression` |
| `sub_workflow` | flow | #0284c7 | Execute another workflow | `workflowId`, `inputMappings[]`, `outputKey` |

### 3.2 AI Nodes

| Type | Category | Color | Description | Config Fields |
|------|----------|-------|-------------|--------------|
| `agent` | ai | #9333ea | Full agent session with tools | `agentId`, `message` (template), `sessionId`, `maxTurns` (defined but unused) |
| `llm` | ai | #c026d3 | Direct LLM call -- prompt in, text out | `providerModelId`, `systemPrompt`, `userMessage`, `temperature`, `maxTokens`, `responseFormat` (text/json) |
| `knowledge_search` | ai | #db2777 | Query knowledge base (RAG) -- **IMPLEMENTED**: handler uses lazy import of `searchKnowledge`, accepts `knowledgeBaseId`, `query`, `topK`, `scoreThreshold` config | `knowledgeBaseId`, `query` (template), `topK`, `scoreThreshold` |

### 3.3 Action Nodes

| Type | Category | Color | Description | Config Fields |
|------|----------|-------|-------------|--------------|
| `tool` | action | #0d9488 | Execute a registered tool directly | `toolName`, `arguments` (key-value, templates resolved) |
| `http_request` | action | #0891b2 | Call an external API | `method`, `url`, `headers`, `body`, `responseType`, `timeoutMs` |
| `code` | action | #475569 | Run sandboxed JavaScript | `code` (string, 5s timeout) |

### 3.4 Data Nodes

| Type | Category | Color | Description | Config Fields |
|------|----------|-------|-------------|--------------|
| `transform` | data | #0e7490 | Map/reshape data | `mappings[]` (key/value with template resolution) |
| `aggregate` | data | #059669 | Merge parallel branch outputs | `strategy` (merge/array/first/custom), `customExpression` -- **Note:** `"custom"` strategy and `customExpression` are defined but not implemented (falls through to array) |

### 3.5 Human Node

| Type | Category | Color | Description | Config Fields |
|------|----------|-------|-------------|--------------|
| `human_review` | human | #dc2626 | Pause for human decision | `prompt`, `reviewType` (approve_deny/form/choice), `choices[]`, `formFields[]`, `timeoutMs` (defined but unused), `assignTo` (defined but unused) |

### 3.6 DB Table: `workflow_nodes`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK -> tenants | cascade delete |
| workflow_id | uuid FK -> workflows | cascade delete |
| node_type | workflow_node_type enum | 17 values |
| name | text | default "" |
| config | jsonb | default {} |
| position_x | real | default 0 |
| position_y | real | default 0 |
| error_policy | jsonb | default `{ onError: "stop", maxRetries: 0, retryDelayMs: 1000, retryBackoff: "fixed", timeoutMs: 0 }` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Index:** `idx_wf_nodes_workflow(workflow_id)`.

### 3.7 Nodes API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/workflows/[id]/nodes` | RBAC: WORKFLOWS level 20 | Replace all nodes (delete-and-reinsert) |

**Request body:**
```json
{
  "nodes": [
    {
      "nodeType": "agent",
      "name": "Reviewer",
      "config": { "agentId": "...", "message": "..." },
      "errorPolicy": { "onError": "stop", "maxRetries": 0 },
      "positionX": 250,
      "positionY": 100
    }
  ]
}
```

**Validation:** Zod `updateNodesSchema` -- array of objects with nodeType (enum of 17 values), name (1-255), config (record), errorPolicy (optional record), positionX/positionY (numbers). Node names must be unique within the workflow (case-insensitive, spaces as underscores).

**Error:** `DUPLICATE_NAME` (400) if node names collide.

---

## 4. Edge Types and Connections

### 4.1 Edge Types

| Type | Stroke Color | Style | Description |
|------|-------------|-------|-------------|
| `normal` | #94a3b8 (gray) | solid | Standard flow |
| `error` | #ef4444 (red) | dashed (6,4) | Error branch (when `onError = "error_branch"`) |
| `condition_true` | #10b981 (green) | solid | True branch from condition node |
| `condition_false` | #ef4444 (red) | solid | False branch from condition node |
| `loop_body` | #6366f1 (indigo) | solid, animated | Loop body entry |
| `loop_back` | #6366f1 (indigo) | dashed (4,4) | Loop iteration feedback (skipped during graph build) |
| `loop_done` | #10b981 (green) | solid | Exit from loop after completion |

### 4.2 DB Table: `workflow_edges`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK -> tenants | cascade delete |
| workflow_id | uuid FK -> workflows | cascade delete |
| from_node_id | uuid FK -> workflow_nodes | cascade delete |
| to_node_id | uuid FK -> workflow_nodes | cascade delete |
| condition_label | text | nullable -- display label |
| condition_expr | text | nullable -- expression string |
| edge_type | text | default "normal" |
| sort_order | integer | default 0 -- evaluation order |
| created_at | timestamptz | |

**Indexes:** `idx_wf_edges_workflow(workflow_id)`, `idx_wf_edges_from(from_node_id)`, `idx_wf_edges_to(to_node_id)`.

### 4.3 Edges API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | `/api/workflows/[id]/edges` | RBAC: WORKFLOWS level 20 | Replace all edges (delete-and-reinsert) |

**Request body:**
```json
{
  "edges": [
    {
      "fromNodeId": "uuid",
      "toNodeId": "uuid",
      "conditionLabel": "string (optional, max 255)",
      "conditionExpr": "string (optional, max 5000)",
      "edgeType": "string (optional, max 50)",
      "sortOrder": "integer (optional, min 0)"
    }
  ]
}
```

Creates an audit entry with edge count.

---

## 5. Expression Engine

**File:** `packages/agent-runtime/src/workflow/expression-engine.ts`

### 5.1 Template Resolution

Syntax: `{{path.to.value}}` with optional filter `{{path.to.value | filter}}`.

**Resolution rules:**
- Dot-notation path traversal through the workflow state object.
- Max depth: 10 levels.
- Blocked keys: `__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty` (prototype pollution prevention).
- Returns empty string for null/undefined values.
- Objects are JSON-stringified.

**Filters:**

| Filter | Effect |
|--------|--------|
| `upper` | Uppercase |
| `lower` | Lowercase |
| `trim` | Trim whitespace |
| `length` | String/array length |
| `number` | Convert to number (0 on failure) |
| `round:N` | Round to N decimal places |
| `json` | JSON stringify |

### 5.2 Condition Evaluation

Expression syntax uses readable operators (not JS eval):

| Operator | Example |
|----------|---------|
| `contains` | `{{review.text}} contains "high risk"` |
| `not_contains` | `{{review.text}} not_contains "approved"` |
| `equals` | `{{status}} equals "done"` |
| `not_equals` | `{{status}} not_equals "pending"` |
| `greater_than` | `{{score}} greater_than 0.8` |
| `less_than` | `{{score}} less_than 0.5` |
| `gte` | `{{count}} gte 10` |
| `lte` | `{{count}} lte 100` |
| `is_empty` | `{{result}} is_empty` |
| `is_not_empty` | `{{result}} is_not_empty` |

Fallback: if no operator matches, evaluates truthiness (`"true"` or `"1"`).

### 5.3 Key Normalization

`normalizeKey(name)` converts node names to state keys: lowercased, spaces replaced with underscores. This is how node outputs are stored in the workflow state (e.g. node "Document Reviewer" -> `state.document_reviewer`).

---

## 6. Graph Builder

**File:** `packages/agent-runtime/src/workflow/graph-builder.ts`

### 6.1 `buildExecutionGraph(nodes, edges) -> ExecutionGraph`

Constructs an `ExecutionGraph` with:
- `nodes`: Map<string, GraphNode> -- all nodes by ID.
- `adjacency`: Map<string, GraphEdge[]> -- outgoing edges per node.
- `reverseAdj`: Map<string, string[]> -- incoming node IDs per node.
- `inDegree`: Map<string, number> -- count of incoming edges.
- `startNodeId`: determined by (1) finding the `input` node, or (2) the node with in-degree 0, or (3) the first node.

**Loop-back edges** (`edgeType === "loop_back"`) are excluded from the adjacency graph and in-degree computation to prevent cycles in the topological ordering.

---

## 7. Graph Executor

**File:** `packages/agent-runtime/src/workflow/graph-executor.ts`

### 7.1 Execution Model

`executeGraph()` implements a step-by-step graph traversal:

1. Starts from `startNodeId` (or `resumeFromNodeIds` for resumed runs).
2. Maintains sets: `completed`, `processed`, `ready` queue.
3. Each iteration:
   - Classifies ready nodes into sequential vs parallel.
   - Parallel nodes (multiple ready, non-loop/iteration types) execute via `Promise.allSettled()`.
   - Sequential nodes execute one at a time.
4. After executing a node, resolves next nodes via edge evaluation.
5. Stops when: output node is reached, no more ready nodes, or `MAX_STEPS` (200) hit.

### 7.2 Parallel Execution

- Up to `MAX_PARALLEL = 10` nodes can run concurrently.
- Aggregate nodes wait for all predecessors to complete before executing.
- Failed parallel nodes store `{ _error: true, message }` in state and optionally route to error branches.

### 7.3 State Management

- State is a flat object. Each node's output is stored at `state[normalizeKey(nodeName)]`.
- Reserved state keys: `_error`, `_loop`, `_iteration`, `_parallel`, `_warnings`.
- State is persisted to `workflow_runs.output` after each step batch.
- Warnings are added for unreached nodes when no output node is visited.

### 7.4 Edge Resolution (`getNextNodes`)

Evaluation order for outgoing edges:

1. **Error branch**: if `useErrorBranch` is true, follows edges with `edgeType === "error"` only.
2. **Condition node**: checks `state[nodeKey].result` (boolean). Routes to edges with `edgeType === "condition_true"` if true, `edgeType === "condition_false"` if false.
3. **Switch node**: matches `conditionLabel` against the switch output's `matched` value.
4. **Conditional edges**: evaluates `conditionExpr` in order of `sortOrder`; takes first truthy match.
5. **Default**: follows all `normal` and `loop_done` edges (parallel fan-out).

---

## 8. Node Handlers

**File:** `packages/agent-runtime/src/workflow/node-handlers.ts`

### 8.1 Node Execution (`executeNode`)

Each node type has a dedicated handler:

| Node Type | Execution Logic |
|-----------|----------------|
| **input** | Returns `state.input` |
| **output** | Applies mappings (key/value templates) or returns full state |
| **agent** | Calls `runSession()` with resolved message template, returns response/sessionId/status/usage |
| **llm** | Looks up provider model in DB, calls `callLLM()`, calculates token cost, optionally parses JSON response |
| **tool** | Resolves argument templates, creates workspace, calls `executeTool()` |
| **condition** | Evaluates `expression` via condition engine, returns `{ result: boolean, expression }`. Routing handled by `condition_true`/`condition_false` edge types in `getNextNodes()`. |
| **switch** | Resolves value template, matches against cases, returns `{ matched, value }` |
| **transform** | Applies mappings array via template resolution |
| **delay** | Sleeps for `delayMs` (clamped to 300s max) or dynamic `delayExpression` |
| **human_review** | Returns prompt/reviewType/choices/formFields with `paused: true` |
| **http_request** | Resolves URL/headers/body templates, validates against SSRF, makes HTTP call with timeout |
| **code** | Runs JavaScript in `node:vm` sandbox with frozen state, safe Math/JSON/console, 5s timeout |
| **sub_workflow** | Recursively calls `triggerWorkflow()` with input mappings, passes `parentRunId`. **Note:** uses lazy `import()` for `triggerWorkflow` to avoid circular dependency with the workflow index module. |
| **aggregate** | Handled separately in executor -- merges predecessor outputs by strategy (merge/array/first) |
| **loop** | Executes body nodes repeatedly (while condition or fixed count, max iterations safety cap) |
| **iteration** | Iterates over resolved array, processes body nodes per item, supports parallel batching |

### 8.2 HTTP Request SSRF Protection

- Only HTTP/HTTPS protocols allowed.
- Blocked: localhost, 0.0.0.0, ::1, .internal, .local domains.
- Blocked private IP ranges: 10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64-127.x.
- DNS rebinding check: resolves hostname and validates the resolved IP is not private.

### 8.3 Code Sandbox

- Executed via `node:vm` `runInNewContext()`.
- State is deep-cloned (frozen) -- code cannot mutate workflow state.
- Sandbox provides: `state` (read-only), `result` (write output), `console` (no-op), `JSON.parse/stringify`, `Math` (safe subset), `parseInt`, `parseFloat`, `isNaN`, `isFinite`.
- No access to: `require`, `import`, `process`, `fs`, `Buffer`, `global`, `setTimeout`, `fetch`, etc.
- 5-second execution timeout with `microtaskMode: "afterEvaluate"`.

### 8.4 Loop Execution

- Identifies body nodes by following `loop_body` edges from the loop node.
- Maintains `_loop` state variable: `{ counter, previous }`.
- Supports two modes:
  - `while`: evaluates condition expression each iteration.
  - `for_count`: runs exactly `maxCount` times.
- Safety cap via `maxIterations` (default 100, max configurable).
- Cleans up `_loop` from state after completion.

### 8.5 Iteration Execution

- Resolves `arrayPath` template to a JSON array.
- Processes items sequentially or in parallel batches (`batchSize`, default 5).
- Injects `_iteration` state: `{ index, item, total }`.
- Max items safety: capped at `maxItems` (default 1000).
- Returns `{ results: [...], count }`.

---

## 9. Workflow Runs

### 9.1 Trigger Flow

**File:** `packages/agent-runtime/src/workflow/index.ts`

1. `triggerWorkflow(workflowId, tenantId, userId, input, parentRunId?)`:
   - Validates workflow exists and status is `"active"`.
   - Loads all nodes and edges from DB.
   - Creates a `workflow_runs` record with `status = "running"`, `timeoutAt = now + 1 hour`.
   - Builds execution graph, initializes state `{ input }`.
   - Emits progress span (workflow start).
   - Calls `executeGraph()`.
   - On completion: sets status to `"completed"` with full state as output.
   - On failure: sets status to `"failed"` with error message.
   - On pause (human review): sets status to `"waiting"`, returns partial output.

### 9.2 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/workflows/[id]/run` | RBAC: WORKFLOWS level 20 | Trigger a new run |
| GET | `/api/workflows/[id]/runs` | RBAC: WORKFLOWS level 10 | Paginated run history |
| GET | `/api/workflows/[id]/runs/[rid]` | RBAC: WORKFLOWS level 10 | Run detail with steps |
| POST | `/api/workflows/[id]/runs/[rid]/resume` | RBAC: WORKFLOWS level 20 | Resume paused run |

**POST /api/workflows/[id]/run** request:
```json
{ "input": { "text": "document content..." } }
```

**POST /api/workflows/[id]/runs/[rid]/resume** request:
```json
{ "decision": { "approved": true, "notes": "Looks good" } }
```

Both trigger and resume create audit log entries.

### 9.3 Status Lifecycle

```
pending -> running -> completed
                   -> failed
                   -> waiting (human_review pause)
                   -> timeout
                   -> cancelled
```

The `waiting_approval` status is used for tool approval (agent sessions), not workflow runs.

### 9.4 DB Table: `workflow_runs`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK -> tenants | cascade delete |
| workflow_id | uuid FK -> workflows | cascade delete |
| trigger_type | text | "manual" or "sub_workflow" |
| trigger_data | jsonb | default {} |
| status | run_status enum | pending, running, waiting, completed, failed, cancelled, timeout |
| input | jsonb | the trigger input |
| output | jsonb | nullable -- full workflow state at end |
| error_message | text | nullable |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| timeout_at | timestamptz | default now + 1 hour |
| parent_run_id | uuid | nullable (for sub-workflows) |
| total_cost_usd | numeric(10,6) | default 0 |
| triggered_by | uuid FK -> users | set null on delete |
| created_at | timestamptz | |

**Indexes:** `idx_wf_runs_tenant(tenant_id)`, `idx_wf_runs_workflow(workflow_id)`, `idx_wf_runs_status(tenant_id, status)`, `idx_wf_runs_created(tenant_id, created_at)`.

### 9.5 DB Table: `workflow_run_steps`

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial PK | auto-increment |
| tenant_id | uuid FK -> tenants | cascade delete |
| workflow_run_id | uuid FK -> workflow_runs | cascade delete |
| workflow_node_id | uuid | nullable (no FK — decoupled from node lifecycle) |
| node_name | text | nullable — denormalized from node at insert time |
| node_type | text | nullable — denormalized from node at insert time |
| status | run_step_status enum | pending, running, completed, failed, skipped, waiting_human, retrying |
| input | jsonb | snapshot of workflow state at step start |
| output | jsonb | nullable -- node output |
| error_message | text | nullable |
| duration_ms | integer | nullable |
| attempt | integer | default 1 |
| retry_of | bigint | nullable -- links to original step |
| last_heartbeat_at | timestamptz | for stale detection |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| created_at | timestamptz | |

**Design note:** `node_name` and `node_type` are denormalized into steps at insert time. The FK constraint on `workflow_node_id` was removed because the canvas save uses a delete-and-replace pattern for nodes — previously, re-saving a workflow would orphan existing step records (INNER JOIN returned 0 rows). Steps now survive node re-saves via LEFT JOIN + COALESCE on the denormalized columns.

**Indexes:** `idx_wf_run_steps_run(workflow_run_id)`, `idx_wf_run_steps_status(workflow_run_id, status)`.

---

## 10. Retry Logic

**File:** `packages/agent-runtime/src/workflow/retry.ts`

### 10.1 Error Policy (Per-Node)

```typescript
interface NodeErrorPolicy {
  onError: "stop" | "continue" | "error_branch";
  maxRetries: number;          // 0 = no retry
  retryDelayMs: number;        // base delay (default 1000ms)
  retryBackoff: "fixed" | "exponential";
  timeoutMs: number;           // 0 = use workflow default (600s)
}
```

### 10.2 Retry with Exponential Backoff

`executeNodeWithRetry()`:

1. Attempts execution up to `maxRetries + 1` times.
2. On failure before max:
   - **Fixed backoff**: waits `retryDelayMs` between attempts.
   - **Exponential backoff**: waits `retryDelayMs * 2^(attempt-1)` (e.g. 1s, 2s, 4s, 8s...).
   - Updates step status to `"retrying"` with error message.
3. On final failure:
   - `onError = "stop"`: throws error (stops workflow).
   - `onError = "continue"`: returns `{ _error: true, message, attempt }` (workflow continues).
   - `onError = "error_branch"`: returns with `useErrorBranch: true` flag, executor follows error edges.

### 10.3 Per-Step Timeout

Each node execution is wrapped in `Promise.race()` with a timeout:
- Uses `timeoutMs` from error policy, or 600,000ms (10 minutes) default.
- Timeout triggers: `Node "X" timed out after Nms`.

### 10.4 Heartbeat

`startHeartbeat(stepId)`: updates `last_heartbeat_at` every 15 seconds while a node is executing. Used by the recovery sweep to detect stale steps.

---

## 11. Error Handling and Recovery

### 11.1 Step Recorder

**File:** `packages/agent-runtime/src/workflow/step-recorder.ts`

The `createStepRecorder()` factory produces a function that wraps every node execution:

1. Emits a progress span (node start).
2. Inserts a `workflow_run_steps` row with `status = "running"`.
3. Calls `executeNodeWithRetry()`.
4. On success: updates step to `"completed"` (or `"waiting_human"` if paused) with output, duration.
5. On failure: updates step to `"failed"` with error message. Emits error progress span.

### 11.2 Recovery Sweep

**File:** `packages/agent-runtime/src/workflow/recovery.ts`

`recoverStaleWorkflowRuns()` runs periodically to clean up stuck runs:

1. **Stale steps**: finds steps with `status = "running"` and `lastHeartbeatAt` older than 90 seconds (or null). Marks them `"failed"` with "Execution interrupted (server restart or timeout)" message. Also marks the parent run as `"failed"`.
2. **Timed-out runs**: finds runs with `status = "running"` and `timeoutAt < now`. Marks them `"timeout"` with "Workflow execution timed out" message.

Returns the count of recovered runs.

---

## 12. Human Review Pause/Resume

### 12.1 Pause

When a `human_review` node executes:

1. The node handler returns `{ paused: true }` with prompt/reviewType/choices/formFields.
2. The step recorder marks the step as `"waiting_human"`.
3. The graph executor detects the pause, updates the run to `status = "waiting"` with current state.
4. The workflow returns `{ status: "waiting" }` to the API caller.

### 12.2 Resume

`resumeWorkflow(runId, tenantId, userId, decision)`:

1. Validates the run exists and `status = "waiting"`.
2. Updates run status back to `"running"`.
3. Finds the last step with `status = "waiting_human"`, marks it `"completed"` with the decision as output.
4. Merges the decision into the paused node's state key: `state[nodeKey] = { ...existing, decision }`.
5. Rebuilds the execution graph.
6. Resumes execution from the next nodes after the paused node.
7. If another human_review node is encountered, pauses again.

---

## 13. Run Detail View

### 13.1 UI Component

**File:** `web/src/app/(platform)/workflows/components/run-detail.tsx`

The `RunDetail` component displays:

1. **Header**: back button, status badge.
2. **Summary cards**: step count, duration, start time.
3. **Error banner**: shown if `errorMessage` is present.
4. **Live event feed**: `EventFeed` component (SSE) for running/waiting runs; `HistoricalEventFeed` for completed runs.
5. **Execution steps**: ordered list with color-coded left border per node type. Each step shows:
   - Index number
   - Status icon (green checkmark, red X, amber clock for waiting, blue spinner for running)
   - Node name and type badge
   - Duration (ms or seconds)
   - Expandable output (JSON formatted)
6. **Final output**: JSON display of the full workflow state.
7. **Run files**: expandable section with `FileBrowser` component scoped to the run's workspace directory.

### 13.2 Human Review Approval Panel

When `run.status === "waiting"`, an amber alert card appears between the summary cards and the event feed:

- **Detection:** Finds the last step with `status === "waiting_human"` and extracts `prompt`, `reviewType`, `choices`, `formFields` from its output.
- **Card styling:** `border-amber-300 bg-amber-50 dark:bg-amber-950/30` with AlertCircle icon and "Human Review Required" heading.
- **3 form types based on `reviewType`:**

| reviewType | UI Rendered | Decision Payload |
|---|---|---|
| `approve_deny` (default) | Approve (green) + Deny (red) buttons, optional comment textarea | `{ approved: boolean, comment? }` |
| `choice` | Radio buttons for each choice string, optional comment, Submit button (disabled until selection) | `{ choice: string, comment? }` |
| `form` | Dynamic fields from `formFields` config — Input, Textarea, Select with options. Submit disabled until all required fields filled. | `{ [key]: value, ... }` |

- **Submit:** POSTs to `/api/workflows/{id}/runs/{rid}/resume` with `{ decision }`.
- **On success:** reloads run detail (panel disappears as status changes from "waiting").
- **On error:** inline error text shown below the form.

### 13.3 Step Status Colors

| Node Type | Color |
|-----------|-------|
| input | #3b82f6 (blue) |
| output | #10b981 (green) |
| agent | #9333ea (purple) |
| llm | #c026d3 (fuchsia) |
| condition | #f59e0b (amber) |
| switch | #ea580c (orange) |
| loop | #6366f1 (indigo) |
| iteration | #7c3aed (violet) |
| delay | #94a3b8 (gray) |
| sub_workflow | #0284c7 (sky) |
| knowledge_search | #db2777 (pink) |
| tool | #0d9488 (teal) |
| http_request | #0891b2 (cyan) |
| code | #475569 (slate) |
| transform | #0e7490 (dark cyan) |
| aggregate | #059669 (emerald) |
| human_review | #dc2626 (red) |

---

## 14. Security Measures

| Layer | Protection |
|-------|-----------|
| **API auth** | All endpoints require JWT via `withRBAC()`. WORKFLOWS module, level 10 for read, level 20 for write. |
| **Tenant isolation** | Every query includes `WHERE tenant_id = ?` from JWT claims. |
| **Audit logging** | Create, update, update_edges, run, resume all create audit entries. |
| **SSRF protection** | HTTP request nodes block private IPs, localhost, cloud metadata endpoints, and perform DNS rebinding checks. |
| **Code sandbox** | `node:vm` with frozen state, no access to Node.js APIs, 5s timeout, safe Math/JSON only. |
| **Command safety** | `exec_command` blocks 17 dangerous patterns (see 06_tools.md section 2.6). |
| **Template injection** | Blocked keys prevent prototype pollution; max depth 10 prevents DoS. |
| **Execution limits** | MAX_STEPS = 200, MAX_PARALLEL = 10, delay capped at 300s, run timeout 1 hour, loop max iterations. |
| **Input validation** | Zod schemas on all endpoints; node type enum enforced in DB. |
| **Version control** | Optimistic locking via auto-incrementing version on updates. |
| **Recovery** | Stale step detection (90s heartbeat threshold) and timeout enforcement via periodic sweep. |

---

## 15. Progress Events

The workflow engine emits progress spans via `progressBus` for real-time UI updates:

| Event | Phase | Timing |
|-------|-------|--------|
| Workflow started | `start` | On trigger |
| Node started | `start` | Before each node execution |
| Node paused | `progress` | When human_review node pauses |
| Node completed | `complete` | After successful node execution |
| Node error | `error` | After failed node execution |
| Workflow paused | `progress` | When run enters waiting state |
| Workflow completed | `complete` | After all steps done |
| Workflow error | `error` | After unrecoverable failure |

Each span includes: `traceId` (runId), `tenantId`, `spanKind` (workflow/node), `name`, `message`, `durationMs`, `nodeId`.
