# 10. Observability — Progress Tracking & Event Streaming

Real-time execution observability for agent sessions and workflow runs. Provides live SSE streaming during active runs and historical replay from the database.

---

## 0. Architecture Overview

### Architecture Diagram

```
Emitters (session-runner, workflow engine, node handlers, tool executor)
    │
    │  progressBus.emit({ traceId, spanKind, phase, ... })
    ▼
┌──────────────────────────────────────────────────────────────────┐
│  ProgressBus  (globalThis singleton, survives hot reloads)       │
│                                                                  │
│  Per-trace ring buffer (200 spans)                               │
│  ┌─────────────────────────────┐                                 │
│  │  trace abc: [span0..span199]│                                 │
│  │  trace def: [span0..span42] │                                 │
│  └─────────────────────────────┘                                 │
│                                                                  │
│  3 subscriber tiers:                                             │
│  ├── Trace subscribers      subscribe(traceId, tenantId, fn)     │
│  │   (SSE endpoints — 1 per browser tab viewing a run)           │
│  ├── Tenant wildcards       subscribeAll(tenantId, fn)           │
│  │   (future: dashboard live feeds)                              │
│  └── Global subscribers     subscribeGlobal(fn)                  │
│       (ProgressWriter — exactly 1 instance)                      │
│                                                                  │
│  Cleanup: TTL 30 min from trace creation, sweep every 5 min     │
│  Eager cleanup: trace deleted immediately if 0 subs + 0 spans   │
└──────────────────────────────────────────────────────────────────┘
    │                            │
    │  Trace subscriber          │  Global subscriber
    ▼                            ▼
SSE endpoint                 ProgressWriter
(/api/progress)              (progress-writer.ts)
    │                            │
    │  Replay-then-live:         │  Batched flush:
    │  1. ~4KB flush padding (4096-byte payload)      │  buffer spans in memory
    │  2. getHistory(afterSeq)   │  flush every 500ms OR
    │  3. replay.start/end       │  when buffer >= 50 spans
    │  4. Switch to live mode    │  INSERT into progress_spans
    │  5. 15s keepalive          │  (non-fatal on DB error)
    ▼                            ▼
Browser (EventSource)        PostgreSQL (progress_spans table)
    │                            │
    │  useProgressStream hook    │  /api/progress/history
    │  ├─ spans[] (max 500)      │  GET with traceId|sessionId
    │  ├─ tree (parentId)        │  Returns persisted spans
    │  ├─ connected              │  for completed runs
    │  ├─ replaying (boolean)    │
    │  ├─ clearSpans (callback)  │
    │  └─ latestSpan             │
    ▼                            ▼
EventFeed (live)             HistoricalEventFeed (from DB)
CompactStatus (one-liner)
```

### The Pub/Sub Model

The `ProgressBus` is a class-based in-memory event bus with three subscription tiers:

| Tier | Method | Scope | Use Case |
|------|--------|-------|----------|
| Trace | `subscribe(traceId, tenantId, fn)` | Single session or workflow run | SSE endpoint streams spans for one specific run |
| Tenant wildcard | `subscribeAll(tenantId, fn)` | All traces in a tenant | Future: dashboard live activity feed |
| Global | `subscribeGlobal(fn)` | Every span across all tenants | ProgressWriter DB persistence |

Each trace gets its own ring buffer of 200 spans. When the buffer is full, the oldest span is overwritten (circular). Subscribers receive spans via direct function call — exceptions in subscriber callbacks are caught and swallowed to ensure the emitter is never crashed by a faulty subscriber.

Subscriber limits: max 20 per trace (prevents resource exhaustion from runaway browser tabs). Backpressure: if a subscriber accumulates > 50 pending events (`BACKPRESSURE_HIGH_WATER`), the SSE stream disconnects that subscriber. The backpressure counter resets to 0 on each successful write, so only sustained slow consumers trigger disconnection.

### Real-Time Streaming: SSE with Resume

The `/api/progress` endpoint implements Server-Sent Events with a **replay-then-live** pattern to handle reconnects:

1. **Flush padding** — Sends ~4KB flush padding (4096-byte payload) to force proxy buffers (Cloudflare, nginx) to flush immediately.
2. **Subscribe** — Registers a trace subscriber; any spans arriving during replay are captured in an early buffer.
3. **Replay** — Calls `getHistory(traceId, afterSeq)` to get buffered spans. If the client sends `Last-Event-ID`, only spans with `seq > lastEventId` are replayed (dedup on reconnect).
4. **Switch to live** — Flushes the early buffer (skipping spans already replayed), then forwards all new spans directly to the SSE stream.
5. **Keepalive** — Sends `: keepalive` comments every 15 seconds to prevent proxy timeouts.
6. **Auto-reconnect** — Sends `retry: 3000` directive so the browser reconnects after 3 seconds on disconnect.

### Persistence: ProgressWriter

The `ProgressWriter` subscribes globally and batches spans for DB persistence:

- **Buffer threshold:** Flush when buffer reaches 50 spans OR every 500ms timer tick (whichever comes first).
- **Batch INSERT:** Up to 50 spans per INSERT into `progress_spans`.
- **Non-fatal:** DB write failures are silently caught — spans remain available in the ring buffer for SSE delivery. The writer degrades gracefully under DB pressure.
- **Lifecycle:** Started by `instrumentation.ts` on server boot via `startProgressWriter()`. Stopped via `stopProgressWriter()` (unsubscribes global listener and clears flush timer, with a final drain).

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Ring buffers (not unbounded arrays) | Sessions with heavy tool loops can emit hundreds of spans. A fixed-size ring buffer (200) caps memory per trace at ~200 spans regardless of session length. Old spans are overwritten but remain in the DB via ProgressWriter. |
| `globalThis` singleton | Next.js hot reloads in development destroy module-scoped variables. Using `globalThis.__progressBus` ensures the bus survives reloads, preventing subscriber leaks and lost span history between code changes. |
| In-memory, not Redis | The bus serves real-time SSE streams where latency matters (sub-millisecond emit). Redis pub/sub would add network round-trips for every span. The trade-off is single-process — in a multi-instance deployment, each instance has its own bus. This is acceptable because SSE connections are sticky to the instance that received the request. |
| 5-minute cleanup interval with 30-minute TTL | Traces accumulate over time. The cleanup sweep removes traces older than 30 minutes *from creation time* (not last activity) that have no active subscribers. The 5-minute sweep interval amortizes the cost of iterating all traces. Eager cleanup (`maybeCleanupTrace`) immediately removes traces with 0 subscribers AND 0 buffered spans, handling the common case without waiting for the sweep. |
| Tenant isolation in SSE callback | The `onSpan` callback in the SSE endpoint checks `span.tenantId !== auth.tenantId` before forwarding. Even though trace subscription is already scoped by traceId, this check prevents information leaks if a trace ID is guessed or shared. |

---

## 10.1 Progress Types

**File:** `packages/agent-runtime/src/progress-types.ts`

### SpanKind and SpanPhase

Every progress event is a "span" classified by kind and phase:

| SpanKind    | Description                        |
|-------------|------------------------------------|
| `workflow`  | Workflow execution lifecycle       |
| `node`      | Individual workflow node execution |
| `agent`     | Agent session lifecycle            |
| `llm`       | LLM API call                       |
| `tool`      | Tool execution                     |
| `approval`  | Human approval gate                |

| SpanPhase   | Description                       |
|-------------|-----------------------------------|
| `start`     | Execution began                   |
| `progress`  | Intermediate update               |
| `complete`  | Finished successfully             |
| `error`     | Failed with error                 |

### ProgressSpan Interface

| Field          | Type              | Description                                      |
|----------------|-------------------|--------------------------------------------------|
| `id`           | `string` (UUID)   | Unique span identifier                           |
| `seq`          | `number`          | Per-trace sequence number (monotonic)            |
| `traceId`      | `string` (UUID)   | Groups all spans for one run (session/workflow)  |
| `parentId`     | `string \| null`  | Parent span for hierarchical tree display        |
| `tenantId`     | `string` (UUID)   | Tenant isolation                                 |
| `spanKind`     | `SpanKind`        | What type of work                                |
| `phase`        | `SpanPhase`       | Lifecycle phase                                  |
| `timestamp`    | `number`          | Epoch ms when emitted                            |
| `durationMs`   | `number?`         | Elapsed time (set on complete/error)             |
| `name`         | `string`          | Human-readable label                             |
| `message`      | `string?`         | Additional detail                                |
| `tokens`       | `number?`         | Total tokens (input + output)                    |
| `inputTokens`  | `number?`         | Input tokens                                     |
| `outputTokens` | `number?`         | Output tokens                                    |
| `costUsd`      | `number?`         | Cost in USD                                      |
| `argsPreview`  | `string?`         | Truncated input args (max 500 chars)             |
| `argsLen`      | `number?`         | Full args length                                 |
| `resultPreview`| `string?`         | Truncated result (max 500 chars)                 |
| `resultLen`    | `number?`         | Full result length                               |
| `agentId`      | `string?`         | Agent UUID                                       |
| `agentName`    | `string?`         | Agent display name                               |
| `sessionId`    | `string?`         | Agent session UUID                               |
| `nodeId`       | `string?`         | Workflow node ID                                 |
| `modelId`      | `string?`         | LLM model identifier                             |
| `toolName`     | `string?`         | Tool name (for tool spans)                       |

---

## 10.2 ProgressBus (In-Memory Pub/Sub)

**File:** `packages/agent-runtime/src/progress-bus.ts`

Singleton in-process event bus held on `globalThis` to survive Next.js hot reloads.

### Behavior

- **Ring buffer per trace:** Each traceId gets a circular buffer of 200 spans (RING_BUFFER_SIZE).
- **Three subscription levels:**
  - `subscribe(traceId, tenantId, fn)` — single trace (max 20 subscribers per trace)
  - `subscribeAll(tenantId, fn)` — all spans for a tenant (wildcard)
  - `subscribeGlobal(fn)` — all spans globally (used by ProgressWriter)
- **Subscriber isolation:** Exceptions in subscriber callbacks are caught and swallowed — never crashes the emitter.
- **Backpressure:** High-water mark at 50 buffered events (`BACKPRESSURE_HIGH_WATER`); if exceeded, the SSE stream is disconnected.
- **Trace TTL:** 30 minutes from trace creation time (not last activity); cleanup runs every 5 minutes.
- **Eager cleanup (`maybeCleanupTrace`):** When a trace has 0 subscribers AND 0 buffered spans, it is cleaned up immediately rather than waiting for the TTL sweep.
- **Replay:** `getHistory(traceId, afterSeq?)` returns buffered spans, optionally filtering by sequence number.

### Configuration Constants

| Constant                    | Value     | Purpose                              |
|-----------------------------|-----------|--------------------------------------|
| `RING_BUFFER_SIZE`          | 200       | Max spans per trace in memory        |
| `MAX_SUBSCRIBERS_PER_TRACE` | 20        | Subscriber cap per trace             |
| `BACKPRESSURE_HIGH_WATER`   | 50        | Disconnect threshold for SSE         |
| `TRACE_TTL_MS`              | 30 min    | Auto-cleanup from trace creation     |
| `BACKPRESSURE_LIMIT`        | 50        | Alias for BACKPRESSURE_HIGH_WATER    |

### Stats

`getStats()` returns `{ activeTraces, totalSubscribers, totalSpansEmitted }` — exposed via the health endpoint.

### Methods

| Method                     | Description                                                              |
|----------------------------|--------------------------------------------------------------------------|
| `emit(span)`               | Emit a span to all subscribers and ring buffer                           |
| `subscribe(traceId, ...)`  | Subscribe to a specific trace                                            |
| `subscribeAll(tenantId, fn)` | Subscribe to all spans for a tenant                                   |
| `subscribeGlobal(fn)`      | Subscribe to all spans globally                                          |
| `getHistory(traceId, afterSeq?)` | Get buffered spans, optionally from a sequence number               |
| `getStats()`               | Returns `{ activeTraces, totalSubscribers, totalSpansEmitted }`          |
| `clearTrace(traceId)`      | Remove a trace's ring buffer, subscribers, and metadata                  |

### Interfaces

- **`EmitSpanOptions`** — Options passed to `emit()`, includes the `ProgressSpan` fields plus optional overrides.

### Utility: truncatePreview

`truncatePreview(value, maxLen=500)` — serializes any value to a string preview, truncating with "..." if over limit.

---

## 10.3 SSE Endpoint (Real-Time Streaming)

**File:** `web/src/app/api/progress/route.ts`

### API

| Method | Path             | Auth        | Description                     |
|--------|------------------|-------------|---------------------------------|
| GET    | `/api/progress`  | JWT (cookie)| SSE stream for a specific trace |

### Query Parameters

| Parameter | Required | Description          |
|-----------|----------|----------------------|
| `traceId` | Yes      | Trace UUID to follow |

### Headers

| Header          | Purpose                                            |
|-----------------|----------------------------------------------------|
| `Last-Event-ID` | Resume from a specific sequence number (reconnect) |

### SSE Events

| Event          | Data                         | Description                    |
|----------------|------------------------------|--------------------------------|
| `replay.start` | `{ count: number }`          | Beginning of history replay    |
| `span`         | Full `ProgressSpan` JSON     | Each span has `id: <seq>`      |
| `replay.end`   | `{}`                         | End of history replay          |
| `: keepalive`  | (comment)                    | Every 15 seconds               |
| `retry: 3000`  | (SSE retry directive)        | Auto-reconnect after 3 seconds |

### Behavior

1. Authentication via `getAuthContext()` — requires valid JWT cookie. This checks token revocation (JTI lookup in `revoked_tokens`), user active status (`isActive`), and account lock status (`isLocked`) on every request — not just JWT signature verification.
2. Sends ~4KB flush padding (4096-byte payload, CF_FLUSH_PADDING) to force proxy buffering flush.
3. Subscribes to the trace on ProgressBus.
4. Replays ring buffer history (respects `Last-Event-ID` for dedup).
5. Switches to live mode — early-buffer pattern prevents missed events between replay and live subscription.
6. Tenant isolation: span.tenantId must match auth.tenantId.
7. Backpressure: if buffered > 50, stream disconnects.
8. Cleanup on abort signal, stream cancel, or backpressure.

### Response Headers

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

---

## 10.4 Historical Event Feed API

**File:** `web/src/app/api/progress/history/route.ts`

### API

| Method | Path                     | Auth        | Description                          |
|--------|--------------------------|-------------|--------------------------------------|
| GET    | `/api/progress/history`  | JWT (withAuth) | Load persisted spans from database |

### Query Parameters

| Parameter   | Required | Description                               |
|-------------|----------|-------------------------------------------|
| `traceId`   | No*      | Trace UUID (* at least one required)      |
| `sessionId` | No*      | Session UUID                              |

**Note:** Both `traceId` and `sessionId` can be provided simultaneously. When both are present, they are combined with OR logic — spans matching either identifier are returned.

### Response

```json
{
  "spans": [ { "id": "...", "seq": 1, "spanKind": "agent", "phase": "start", ... } ]
}
```

Spans are ordered by `seq ASC`. All queries are scoped by `tenantId` from the JWT.

---

## 10.5 Progress Writer (DB Persistence)

**File:** `packages/agent-runtime/src/progress-writer.ts`

### Behavior

- **Global subscriber:** Subscribes to all spans via `progressBus.subscribeGlobal()`.
- **Batched writes:** Spans are buffered in-memory and flushed to `progress_spans` table.
  - Flush trigger: buffer >= 50 spans OR every 500ms (timer).
  - Batch size: 50 spans per INSERT.
- **Non-fatal:** DB write failures are silently caught — spans remain in the ring buffer for SSE delivery.
- **Lifecycle:** Started by `instrumentation.ts` on server boot via `startProgressWriter()`. Stopped via `stopProgressWriter()` (unsubscribes global listener and clears flush timer).

---

## 10.6 Database Table: progress_spans

**File:** `packages/database/src/schema/progress-spans.ts`

| Column         | Type                     | Notes                                      |
|----------------|--------------------------|---------------------------------------------|
| `id`           | `uuid` PK                | Random UUID                                 |
| `tenant_id`    | `uuid` FK -> tenants     | Cascade delete                              |
| `trace_id`     | `uuid` NOT NULL          | Groups all spans for a run                  |
| `parent_id`    | `uuid`                   | Hierarchical parent                         |
| `seq`          | `integer` NOT NULL       | Per-trace sequence                          |
| `span_kind`    | `varchar(20)` NOT NULL   | workflow/node/agent/llm/tool/approval       |
| `phase`        | `varchar(10)` NOT NULL   | start/progress/complete/error               |
| `name`         | `varchar(255)` NOT NULL  | Human-readable label                        |
| `message`      | `text`                   | Additional detail                           |
| `timestamp_ms` | `bigint` NOT NULL        | Epoch milliseconds                          |
| `duration_ms`  | `integer`                | Elapsed time                                |
| `tokens`       | `integer`                | Total tokens                                |
| `input_tokens` | `integer`                | Input tokens                                |
| `output_tokens`| `integer`                | Output tokens                               |
| `cost_usd`     | `numeric(12,6)`          | USD cost                                    |
| `args_preview` | `text`                   | Truncated input args                        |
| `args_len`     | `integer`                | Full args length                            |
| `result_preview`| `text`                  | Truncated result                            |
| `result_len`   | `integer`                | Full result length                          |
| `agent_id`     | `uuid`                   | Agent UUID                                  |
| `agent_name`   | `varchar(255)`           | Agent display name                          |
| `session_id`   | `uuid`                   | Agent session UUID                          |
| `node_id`      | `varchar(100)`           | Workflow node ID                            |
| `model_id`     | `varchar(100)`           | LLM model identifier                        |
| `tool_name`    | `varchar(100)`           | Tool name                                   |
| `created_at`   | `timestamptz`            | DB insertion time                           |

### Indexes

| Index                              | Columns                         |
|------------------------------------|---------------------------------|
| `idx_progress_spans_trace`         | `(tenant_id, trace_id, seq)`    |
| `idx_progress_spans_created`       | `(created_at)`                  |
| `idx_progress_spans_session`       | `(session_id)`                  |

---

## 10.7 UI Components

### EventFeed (Live)

**File:** `web/src/components/activity/event-feed.tsx`  
**Component:** `<EventFeed traceId={...} enabled={true} height={400} />`

**Behavior:**
- Connects to `/api/progress?traceId=...` via `useProgressStream` hook (EventSource).
- Builds a hierarchical tree from `parentId` relationships.
- Displays spans as collapsible tree rows with:
  - Timestamp (HH:mm:ss.SSS)
  - Color-coded badge (`spanKind.phase`)
  - Agent name / tool name
  - Message or name
  - Duration and token count
  - Cost in USD
- Expandable detail panels for `argsPreview` and `resultPreview`.
- Auto-scroll toggle, Debug mode toggle, Clear button.
- Green dot indicator when SSE connected ("Live Execution Log").

### HistoricalEventFeed

**Component:** `<HistoricalEventFeed traceId={...} sessionId={...} height={400} />`

**Behavior:**
- Fetches spans from `/api/progress/history` (single GET, not SSE).
- Same tree rendering as EventFeed but without live updates.
- Auto-expands root nodes on load.
- Shows loading state, returns null if no spans.

### CompactStatus

**Component:** `<CompactStatus traceId={...} />`

**Behavior:**
- Shows a single-line status bar with the latest span's message.
- Pulse animation for active state.
- Hides when agent completes.
- Contextual labels: "Calling {model}..." for LLM, "Running {tool}..." for tools.

### useProgressStream Hook

**File:** `web/src/hooks/use-progress-stream.ts`

| Return Field | Type                | Description                                |
|--------------|---------------------|--------------------------------------------|
| `spans`      | `ProgressSpan[]`    | All received spans (max 500, FIFO eviction)|
| `tree`       | `SpanTreeNode[]`    | Hierarchical tree built from parentId      |
| `connected`  | `boolean`           | SSE connection status                      |
| `replaying`  | `boolean`           | True during replay.start → replay.end      |
| `clearSpans` | `() => void`        | Reset span buffer                          |
| `latestSpan` | `ProgressSpan\|null`| Most recent span                           |

---

## 10.8 Integration Points

| Page                            | Component Used            | Data Source     |
|---------------------------------|---------------------------|-----------------|
| Session Detail (`/runs`)        | EventFeed + HistoricalEventFeed | Live SSE + DB |
| Workflow Run Detail (`/workflows`)| EventFeed + HistoricalEventFeed | Live SSE + DB |
| Health Endpoint (`/api/health`) | `progressBus.getStats()`  | In-memory stats |

---

## 10.9 Security

- SSE endpoint requires JWT authentication via cookie.
- Tenant isolation enforced: spans from other tenants are filtered out in the `onSpan` callback.
- Historical API uses `withAuth` wrapper (not `withRBAC`) — queries scoped by `auth.tenantId`.
- No PII in span data by design — only agent/tool names, token counts, and truncated previews.
