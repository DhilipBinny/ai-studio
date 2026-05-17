# 04 — Agent Sessions

Comprehensive documentation for the Agent Sessions (Runs) feature in Kairo Studio. Everything below is based on implemented code.

---

## 0. Architecture Overview

### Component Diagram

```
session-runner.ts  (orchestrator — owns the tool loop)
    │                (imports tools via ./tool-executor barrel file, not directly from tools/)
    │
    ├── prompt-builder.ts        Build system prompt from agent persona/rules
    ├── llm-caller.ts            Thin adapter: ProviderConfig → provider-factory → chat()
    │       └── provider-factory  Creates provider instance (Anthropic/OpenAI/Ollama)
    ├── compaction.ts            Context-window management (summarize older messages)
    ├── model-pricing.ts         Cost lookup (DB → hardcoded tables → fuzzy match → $0)
    ├── tools/
    │   ├── tool-loader.ts       Assemble tool definitions per session (assigned + safe builtins + KB + MCP)
    │   └── executor.ts          Dispatch: loop detect → risk check → route (MCP / context / builtin / legacy)
    │       ├── risk-map.ts      Static risk classification for builtin tools
    │       ├── builtin-executors.ts   get_current_time, calculate, echo
    │       └── context-executors.ts   knowledge_search (needs session context)
    ├── mcp-executor.ts          Route mcp__* calls to MCP bridge (sibling to tools/, not nested)
    └── progress-bus.ts          Emit real-time spans for every lifecycle event
```

### Why a Loop?

The session runner is structured as a bounded loop (`MAX_TOOL_ROUNDS = 10`) because LLM responses are non-deterministic — the model may request zero or many tool calls before producing a final text answer. Each iteration:

1. Checks whether context compaction is needed
2. Reloads the full message history from the DB (compaction may have replaced older messages with a summary)
3. Calls the LLM
4. If the stop reason is `tool_use`, executes every requested tool and continues
5. If the stop reason is `end_turn`, persists the text response and breaks

The loop terminates on: final text response, `MAX_TOOL_ROUNDS` exhausted, or an unhandled exception.

### Session State Machine

```
pending ──► running ──► waiting ──► running ──► waiting  (multi-turn conversation)
               │            │           │
               │            ▼           ▼
               │      waiting_approval ──► waiting  (on approve)
               │            │               │
               │            │               ▼
               │            │           running  (next user message triggers)
               ▼            ▼
             failed       failed  (on deny or error)

pending|running ──► cancelled  (via cancel API)
```

Transitions are DB-driven: the runner sets `running` at entry, `waiting` on successful completion, `waiting_approval` when a dangerous tool pauses execution, and `failed` on any caught exception or security block. The runner checks the current status before overwriting — it will not downgrade `waiting_approval` to `waiting`.

### End-to-End Data Flow

```
User message
    │
    ▼
sanitizeInput() + detectPromptInjection()   ── block → session failed
    │
    ▼
Persist user message to agent_session_messages
    │
    ▼
loadToolDefinitions(agentId, tenantId)       ── assigned tools + safe builtins + KB search + MCP
    │
    ▼
buildSystemPrompt(agentConfig)               ── persona sections + rules (sorted by priority) + datetime
    │
    ▼
getModelPricing()                            ── DB costs → builtin table (Anthropic/OpenAI/Google) → fuzzy → Ollama=$0 → $0 (called ONCE)
    │
    ▼
┌─── TOOL LOOP (max 10 rounds) ──────────────────────────────────────┐
│  checkAndCompact()       estimate tokens (chars/4), summarize if   │
│                          >= 75% of contextWindow AND enough msgs   │
│  Load history            SELECT ... ORDER BY createdAt ASC         │
│  Format messages         Reconstruct tool_use blocks for provider  │
│  callLLM()               provider-factory → chat(); returns text,  │
│                          toolCalls[], inputTokens, outputTokens    │
│  calculateCost()         input*rate + output*rate (uses pricing    │
│                          resolved above)                           │
│  INSERT usage_record     Per-call row with tokens + cost           │
│  emit progress spans     llm.start → llm.complete                 │
│                                                                    │
│  if toolCalls.length > 0:                                          │
│      persist assistant message with tool_use blocks (JSONB)        │
│      for each tool call:                                           │
│          executeTool() ── loop detect → risk check → dispatch      │
│          persist tool result message (role=tool, toolCallId)       │
│      continue loop                                                 │
│  else:                                                             │
│      persist assistant text message → break                        │
└────────────────────────────────────────────────────────────────────┘
    │
    ▼
UPDATE agent_sessions: totals (atomic SQL +=), status → waiting
    │
    ▼
Return { sessionId, response, usage, status }
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `MAX_TOOL_ROUNDS = 10` | Safety cap to prevent runaway LLM tool-call chains. Agents typically finish in 1-3 rounds; 10 allows complex multi-step reasoning without unbounded cost. |
| Compaction as LLM-based summarization | Context windows are finite. Summarizing older messages into a system-role `[Context Summary]` preserves key decisions and facts while freeing token budget. The most recent `KEEP_RECENT_MESSAGES = 6` messages are always preserved. Compaction is skipped if the total message count is <= 8 (`KEEP_RECENT_MESSAGES + 2`), ensuring there is meaningful content to summarize. Compaction is also skipped silently on LLM failure — the session continues with a full (oversized) context rather than crashing. |
| Usage records separate from sessions | A single session turn may include multiple LLM calls (one per tool loop round). Per-call usage records enable granular cost attribution by model, user, and time period — the session row only holds running totals. |
| Atomic SQL for session totals | `total_input_tokens = total_input_tokens + $new` prevents lost-update races if a follow-up message arrives while the runner is still updating. |
| History reloaded from DB each round | After tool execution, new messages exist in the DB. Reloading ensures the LLM always sees the latest state — and compaction may have replaced older messages with a summary between rounds. |
| Ollama always returns $0 | Ollama runs local models with no per-token cost. The pricing lookup short-circuits for Ollama providers, returning $0 without consulting the builtin pricing table or fuzzy matching. |
| `traceId = workflowRunId \|\| sessionId` | When a session runs inside a workflow, progress spans are grouped under the workflow's trace so the UI can show a unified execution tree. Standalone sessions use their own ID as the trace. |

---

## 1. Overview

A session is a single conversation between a user (or automation) and an agent. Sessions are created when a message is sent to an agent. The session runner orchestrates the full cycle: prompt construction, LLM calls, tool execution, loop detection, compaction, cost tracking, and progress events. Sessions are viewable in the Runs page.

---

## 2. Session Creation

### 2.1 Channels

Sessions can be created through five channels:

| Channel | Entry Point | Auth Method | Description |
|---|---|---|---|
| `studio` | `/api/agents/[id]/sessions` | JWT cookie (withRBAC) | Interactive chat from the UI |
| `api` | `/api/v1/agents/[slug]/sessions` | API key (Bearer ask_...) | External REST API |
| `workflow` | `session-runner.ts` via workflow engine | Internal (tenantId passed) | Agent node within a workflow |
| `connector` | Future — connector-triggered | Internal | Inbound webhook/event triggers |
| `cron` | `cron-scheduler.ts` | Internal (tenantId from job) | Scheduled cron job execution |

### 2.2 Studio Channel

**Endpoint:** `POST /api/agents/[id]/sessions`  
**Auth:** `withRBAC("AGENTS", 10)` (read-level access is sufficient to chat)

**Request:**
```json
{
  "message": "Review this document for compliance gaps.",
  "metadata": {}  // optional
}
```

**Response (201):**
```json
{
  "sessionId": "uuid",
  "response": "I'll review the document...",
  "usage": { "inputTokens": 1234, "outputTokens": 567, "costUsd": 0.012345 },
  "status": "waiting"
}
```

**Follow-up messages** to an existing session: `POST /api/agents/[id]/sessions/[sid]/messages`  
- Validates the session exists, belongs to the specified agent, and is not in a terminal state (completed, failed, cancelled).
- Same request/response shape as initial creation.

### 2.3 External API Channel

**Endpoint:** `POST /api/v1/agents/[slug]/sessions`  
**Auth:** API key via `Authorization: Bearer ask_...` header

**Behavior:**
- Looks up agent by slug (not ID) within the API key's tenant.
- Agent must be `active` and `isActive = true`.
- If the API key has `scopedAgentIds`, checks the agent is in the allowed list.
- Channel set to `"api"`. `triggeredBy` is set to `null` (API keys don't represent a user), but `userId` in the session runner context is set to `auth.keyId` (the API key's UUID, not a user UUID). This means `usage_records.user_id` will contain the API key ID rather than an actual user reference for API-triggered sessions.
- CORS headers provided (`Access-Control-Allow-Origin: *`).

**Response (201):**
```json
{
  "sessionId": "uuid",
  "response": { "text": "...", "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0 } },
  "status": "waiting"
}
```

**Follow-up messages:** `POST /api/v1/agents/[slug]/sessions/[sid]/messages`  
**Get message history:** `GET /api/v1/agents/[slug]/sessions/[sid]/messages`  
Both require the same API key auth and return filtered fields (role, content, createdAt).

### 2.4 Cron Channel

**Entry:** `cron-scheduler.ts` → `runSession()`

- The cron scheduler runs a `tick()` every 60 seconds.
- For each enabled cron job with `triggerType = "agent"`, it evaluates the cron expression against the current time in the job's timezone.
- On match, calls `runSession()` with `channel: "cron"` and metadata containing the cron job ID and name.
- Supports cron expressions with standard 5-field format (minute, hour, day-of-month, month, day-of-week), ranges, steps, and wildcards.
- Concurrent execution of the same job is prevented via a `runningJobs` Set.
- Job results (success text or error message) and run count are persisted back to the `cron_jobs` table.

### 2.5 Workflow Channel

When a workflow contains an agent node, the workflow engine calls `runSession()` with:
- `channel`: uses `input.channel || "studio"` fallback -- if the workflow input specifies a channel it is used, otherwise defaults to `"studio"`
- `metadata.workflowRunId` — links the session to the workflow run
- `metadata.parentSpanId` — links progress events to the workflow's trace tree

---

## 3. Session Runner Flow

The session runner (`session-runner.ts`) is the core orchestration engine. Here is the complete flow:

```
 1. Load agent from DB (verify active + has model)
 2. Load provider model config (verify active)
 3. Create or resume session row
 4. Security check: sanitize input, detect prompt injection
 5. Persist user message
 6. Load tool definitions (assigned + safe builtins + KB search + MCP)
 7. Build system prompt (persona/rules assembly)
 8. Initialize loop detector
 9. Begin tool loop (max 10 rounds):
    a. Check & compact context if needed
    b. Load full message history
    c. Call LLM with system prompt + messages + tool definitions
    d. Track token usage, calculate cost, write usage record
    e. If LLM requests tool calls:
       - Persist assistant message with tool_use blocks
       - For each tool call:
         - Execute tool (builtin / MCP / context / dangerous-with-approval)
         - Persist tool result message
       - Continue loop (go to step a)
    f. If LLM returns text (no tool calls):
       - Persist assistant message
       - Break loop
10. Update session totals (tokens, cost, turns, tool calls)
11. Set session status to "waiting" (or "waiting_approval" if a dangerous tool paused it)
12. Return { sessionId, response, usage, status }
```

### 3.1 Pre-flight Checks

Before the loop starts, the runner validates:
- Agent exists and `status === "active"`
- Agent has a `providerModelId` assigned
- Provider model is active and its parent provider is active
- Input passes security screening (sanitization + prompt injection detection)

If any check fails, the session is either not created or immediately set to `failed`.

### 3.2 The Tool Loop

The runner loops up to `MAX_TOOL_ROUNDS = 10` times. In each round:
1. Context compaction is checked (see Section 9)
2. Full message history is loaded from DB
3. Messages are formatted for the LLM (tool_use blocks as structured content)
4. LLM is called with the system prompt, message history, and tool definitions
5. If the LLM's stop reason is `tool_use`, tool calls are executed and results appended
6. If the LLM returns a final text response, the loop exits

### 3.3 Error Handling

If any exception occurs during the session:
- The session status is set to `failed`
- `errorMessage` is captured (truncated to 500 chars for progress events)
- `completedAt` is set to now
- The error is returned in the response: `{ status: "failed", error: "..." }`

---

## 4. Message Model

### 4.1 Message Roles

| Role | Description | Content |
|---|---|---|
| `user` | Human or API caller message | Plain text (sanitized) |
| `assistant` | LLM response | Plain text or text + tool_use blocks in `toolCalls` JSONB |
| `system` | Context summaries from compaction | `[Context Summary]\n{summary text}` |
| `tool` | Tool execution result | Result text, with `toolCallId` linking to the tool_use block |

### 4.2 Assistant Messages with Tool Calls

When the LLM requests tool calls, the assistant message stores both text and tool blocks in the `tool_calls` JSONB column:

```json
[
  { "type": "text", "text": "I'll search for that information." },
  { "type": "tool_use", "id": "toolu_01abc...", "name": "knowledge_search", "input": { "query": "ISO 27001 controls" } }
]
```

On subsequent LLM calls, these blocks are reconstructed into the provider's expected format with `tool_calls` arrays.

### 4.3 Tool Result Messages

Tool results are stored as role `"tool"` with:
- `content`: The result text (or error message)
- `toolCallId`: References the tool_use block's `id` from the assistant message

---

## 5. Tool Call Execution

### 5.1 Tool Resolution Order

The tool executor (`executor.ts`) resolves tools in this priority:

1. **MCP tools** — if name starts with `mcp__` and a connector map entry exists
2. **Context-aware executors** — `knowledge_search` (requires agent/tenant/session context)
3. **Builtin tools from `@ais/tools-common`** — tools registered via `allBuiltinTools` (read_file, write_file, etc.) that need a workspace config
4. **Legacy builtin executors** — `get_current_time`, `calculate`, `echo` (simple stateless functions)
5. **No executor found** — returns error: `Tool "{name}" has no executor`

### 5.2 Builtin Tool Execution

Builtin tools from `@ais/tools-common` receive a `BuiltinToolContext` with:
- `workspace`: `{ dataRoot, tenantId, agentId, sessionId, workflowRunId }` — file system sandbox
- `braveApiKey`: for web search tool (from `BRAVE_API_KEY` env var)

Tools with `validateInput()` are validated before execution. If validation fails, the error is returned without executing.

### 5.3 MCP Tool Execution

MCP tools are dynamically discovered from assigned connectors:
1. Tool loader reads `agent_connectors` where `connector_type = "mcp"`
2. For each connector, connects via `MCPBridge` (stdio or SSE transport)
3. Discovers tools via MCP protocol
4. Tools are namespaced: `mcp__{connector_slug}__{tool_name}`
5. At execution time, the bridge routes the call to the correct MCP server
6. Connector credentials (env vars) are decrypted from encrypted storage at runtime

### 5.4 Context-Aware Tool: `knowledge_search`

**Injected when:** Agent has at least one knowledge base assigned.

**Definition:**
```json
{
  "name": "knowledge_search",
  "description": "Search the agent's assigned knowledge bases for relevant information.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "top_k": { "type": "number", "description": "Number of results (default: 5)" }
    },
    "required": ["query"]
  }
}
```

**Execution flow:**
1. Gets all KB assignments for the agent via `DrizzleSearchStore`
2. Builds embedding config from the first KB's settings (builtin or provider-based)
3. Creates embedder (and optional reranker)
4. Calls `ragSearchKnowledge()` for hybrid vector + full-text search
5. Returns formatted results with score, KB name, document name, and content

### 5.5 Loop Detection

A `LoopDetector` (from `@ais/tool-platform`) is created per session run. It tracks tool calls and detects repeated identical calls (same name + same arguments). If a loop is detected, it returns an error immediately without executing the tool, preventing infinite loops.

---

## 6. Tool Approval Flow (Human-in-the-Loop)

### 6.1 Trigger Conditions

A tool requires approval when:
- Its `riskLevel` is `"dangerous"` (from `BUILTIN_TOOL_RISK` map or the `tools` table)
- There is no existing approved tool call record matching the same name + arguments for this session

### 6.2 Approval Flow

```
 1. LLM requests dangerous tool call (e.g., exec_command)
 2. Executor checks risk level → "dangerous"
 3. Executor looks for existing approved call with matching args
 4. No approved call found:
    a. Insert into agent_session_tool_calls with:
       - requiresApproval = true
       - status = "pending"
       - result = "Awaiting human approval"
    b. Set session status to "waiting_approval"
    c. Return message to LLM: "This tool requires human approval..."
 5. Session pauses — UI shows approval banner
 6. Admin approves or denies via POST /api/runs/{id}/approve
 7. On approve:
    - Tool call updated: approvalStatus = "approved", approvedBy, approvedAt
    - Session status set to "waiting"
    - On next user message, the runner retries and finds the approved call
 8. On deny:
    - Tool call updated: approvalStatus = "denied", status = "denied"
    - Session status set to "failed"
```

### 6.3 Approval API

**Endpoint:** `POST /api/runs/[id]/approve`  
**Auth:** `withRBAC("RUNS", 20)` (write access)

**Request:**
```json
{
  "toolCallId": "123",
  "action": "approve"  // or "deny"
}
```

**Validation:**
- Session must exist within the tenant
- Session must be in `waiting_approval` status
- Tool call must exist, belong to the session, and have `requiresApproval = true`
- Tool call must not already have an `approvalStatus` (prevents double-approval)

**Error types:** `SessionNotFoundError`, `InvalidStateError`, `ToolCallNotFoundError`, `AlreadyDecidedError`.

### 6.4 UI for Approvals

The session detail view (`SessionDetailView`) shows an amber approval banner when `session.status === "waiting_approval"`:
- Lists all pending tool calls (where `requiresApproval = true` and no `approvalStatus`)
- Shows tool name and arguments (formatted JSON)
- "Approve" and "Deny" buttons for each pending call
- On action, calls the approve API and reloads the session detail

---

## 7. Session Status Lifecycle

```
pending ──> running ──> waiting ──> running ──> waiting ──> ... (multi-turn)
               |            |           |
               |            v           v
               |      waiting_approval ──> running (on approve)
               |            |
               v            v
             failed       failed (on deny)
               
running ──> failed (on error)
pending|running ──> cancelled (via cancel API)
```

| Status | Description | Entered When |
|---|---|---|
| `pending` | Session created, not yet started | Session row inserted (new session) |
| `running` | LLM call or tool execution in progress | `runSession()` starts or resumes |
| `waiting` | Turn complete, ready for next user message | Runner finishes a turn successfully |
| `waiting_approval` | Paused — dangerous tool needs admin approval | Dangerous tool call without prior approval |
| `completed` | Session finished (not currently set by runner) | Reserved for explicit close |
| `failed` | Session errored or tool denied | Exception, injection block, or tool denial |
| `cancelled` | Session manually cancelled by user | Cancel API called |
| `timeout` | Session timed out | Reserved (not currently triggered) |

**Note:** The session runner sets status to `waiting` after each successful turn, not `completed`. Sessions remain in `waiting` indefinitely until the next message or manual closure. The `expiresAt` field exists in the schema but is not currently enforced.

---

## 8. Cost Tracking

### 8.1 Token Counting

Tokens are reported by the LLM provider on each call:
- `inputTokens`: tokens consumed by system prompt + message history + tool definitions
- `outputTokens`: tokens generated by the LLM response

### 8.2 Cost Calculation

Cost is calculated per LLM call using `model-pricing.ts`:

**Priority for pricing:**
1. **DB-stored costs** — `provider_models.cost_per_input_token` and `cost_per_output_token` (if > 0)
2. **Built-in pricing tables** — hardcoded for Anthropic, OpenAI, and Google models
3. **Fuzzy matching** — strips date suffixes (e.g., `-20250101`) and colon-based suffixes (`:.*`, e.g., `:latest`) to match model families
4. **Ollama** — always $0 (local models)
5. **Fallback** — $0 if no match found

**Built-in pricing coverage:**

| Provider | Models |
|---|---|
| Anthropic | claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6, claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5, claude-opus-4-1, claude-opus-4, claude-sonnet-4, claude-3-7-sonnet, claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus, claude-3-sonnet, claude-3-haiku |
| OpenAI | gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-4, gpt-3.5-turbo, o3, o3-mini, o1, o1-mini |
| Google | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |

**Formula:** `cost = (inputTokens * inputPerToken) + (outputTokens * outputPerToken)`

### 8.3 Cost Margin Factor

The session service applies a configurable margin multiplier when displaying costs:
- Stored in `system_config` table under key `"billing"` → `cost_margin_factor`
- Default: `1.0` (no markup)
- **Floor enforcement:** Any `cost_margin_factor` value less than `1.0` is clamped to `1.0`. This means the margin can only increase costs, never reduce them below the raw provider cost.
- Applied: `displayedCost = rawCost * max(marginFactor, 1.0)`
- Only applied in the session list and detail views — not in the raw usage records

### 8.4 Usage Records

Every LLM call creates a `usage_records` row with:

| Field | Description |
|---|---|
| `tenant_id` | Tenant scope |
| `user_id` | Who triggered (null for API/cron) |
| `agent_id` | Agent that ran |
| `agent_session_id` | Session the call belongs to |
| `provider_model_id` | Model used |
| `model` | Model ID string |
| `provider` | Provider type string |
| `input_tokens` | Input tokens for this call |
| `output_tokens` | Output tokens for this call |
| `cache_read_tokens` | Cache read tokens (reserved) |
| `cache_write_tokens` | Cache write tokens (reserved) |
| `cost_usd` | Cost in USD for this call |
| `request_type` | `"chat"` |

### 8.5 Session Totals

The session row accumulates totals across all LLM calls:
- `total_input_tokens` += per-call input tokens
- `total_output_tokens` += per-call output tokens
- `total_cost_usd` += per-call cost
- `total_tool_calls` += number of tool calls in this turn
- `total_turns` += 1 per `runSession()` invocation

All updates use atomic SQL: `total_input_tokens = total_input_tokens + $new_value`.

---

## 9. Model Compaction (Context Window Management)

### 9.1 When Compaction Triggers

Compaction is checked at the **start of each tool loop round** via `checkAndCompact()`:

1. Load the model's `contextWindow` from `provider_models` (default: 128,000)
2. Estimate total tokens in the session's message history (using `chars / 4` heuristic)
3. If `estimatedTokens >= contextWindow * 0.75` AND `messageCount > KEEP_RECENT_MESSAGES + 2`:
   - Trigger compaction

**Constants:**
- `COMPACTION_THRESHOLD = 0.75` (75% of context window)
- `KEEP_RECENT_MESSAGES = 6` (most recent messages preserved)
- `CHARS_PER_TOKEN = 4` (estimation heuristic)

### 9.2 Compaction Process

```
 1. Split messages into "older" (to summarize) and "recent" (to keep)
 2. Build summary prompt from older messages:
    - Format: "[Role]: {content up to 1000 chars}" per message
    - Instruction: "Summarize concisely. Focus on: what was discussed,
      key decisions, facts mentioned, what the user is working on.
      Keep under 1500 characters."
 3. Call LLM (same provider as the agent) with the summary prompt
 4. Delete ALL messages for this session
 5. Insert system message: "[Context Summary]\n{summary}"
    with metadata: { compacted: true, originalMessageCount: N }
 6. Re-insert the recent messages (preserving content and tool_calls)
```

### 9.3 Compaction Result

Returns `{ compacted, tokensBefore, tokensAfter, messagesBefore, messagesAfter }`.

If the LLM call fails or returns empty text, compaction is silently skipped (returns `{ compacted: false }`).

---

## 10. Session Cancellation

**Endpoint:** `POST /api/runs/[id]/cancel`  
**Auth:** `withRBAC("RUNS", 20)`

**Behavior:**
- Session must be in `running` or `pending` status (otherwise: `InvalidStateError`)
- Sets `status = "cancelled"` and `completedAt = now()`
- Creates `session.cancel` audit log entry
- Returns `{ success: true }`

**Note:** Cancellation is a status update only. It does not abort in-flight LLM calls or tool executions. The runner checks session status at the end of its run and will not override a `waiting_approval` status with `waiting`.

---

## 11. Progress Events (Real-time Observability)

### 11.1 Progress Bus

The `ProgressBus` is an in-memory pub/sub system for real-time session events:
- Uses a ring buffer (200 events per trace) for history
- Supports per-trace, per-tenant wildcard, and global subscribers
- Max 20 subscribers per trace
- `BACKPRESSURE_HIGH_WATER = 50` — when a subscriber's pending event count exceeds 50, the bus applies backpressure (drops events to prevent memory buildup from slow consumers)
- Traces auto-cleanup after 30 minutes with no subscribers
- Cleanup interval: every 5 minutes

### 11.2 Span Types

**spanKind values:** `agent`, `llm`, `tool`, `workflow`, `node`, `approval`

**phase values:** `start`, `complete`, `error`, `progress`

| spanKind | phase | When |
|---|---|---|
| `agent` | `start` | Session runner begins |
| `agent` | `complete` | Session runner finishes successfully |
| `agent` | `error` | Session runner fails |
| `agent` | `progress` | Intermediate agent progress update |
| `llm` | `start` | LLM call begins (per round) |
| `llm` | `complete` | LLM call returns |
| `tool` | `start` | Tool execution begins |
| `tool` | `complete` | Tool execution succeeds |
| `tool` | `error` | Tool execution fails |
| `workflow` | `start` | Workflow run begins |
| `workflow` | `complete` | Workflow run finishes |
| `workflow` | `error` | Workflow run fails |
| `node` | `start` | Workflow node execution begins |
| `node` | `complete` | Workflow node execution finishes |
| `node` | `error` | Workflow node execution fails |
| `approval` | `start` | Tool approval request raised |
| `approval` | `complete` | Tool approval granted or denied |

Each span includes: traceId, parentId, tenantId, agentId, agentName, sessionId, modelId, tokens, cost, duration, and optional preview fields.

### 11.3 Progress Writer (Batched DB Persistence)

Spans are persisted to the `progress_spans` table via `progress-writer.ts`, which batches writes for efficiency:

| Constant | Value | Description |
|---|---|---|
| `FLUSH_INTERVAL_MS` | `500` | Flush pending spans to DB every 500ms |
| `BATCH_SIZE` | `50` | Maximum spans per DB insert batch |

The progress writer subscribes to the ProgressBus and accumulates spans in memory. Every `FLUSH_INTERVAL_MS`, it flushes accumulated spans to the database in batches of up to `BATCH_SIZE`. This prevents per-span DB round trips during high-throughput tool loops.

### 11.4 UI Display

The UI displays:
- `EventFeed` (SSE-based) for live sessions (running / waiting_approval)
- `HistoricalEventFeed` for completed sessions (loaded from DB)

---

## 12. API Endpoints

### 12.1 Internal API (Runs / Sessions)

| Method | Path | Auth Level | Description |
|---|---|---|---|
| `GET` | `/api/runs` | RUNS:10 | List sessions (paginated, filterable by status/agentId) |
| `GET` | `/api/runs/[id]` | RUNS:10 | Get session detail (messages, tool calls, cost with margin) |
| `POST` | `/api/runs/[id]/approve` | RUNS:20 | Approve or deny a dangerous tool call |
| `POST` | `/api/runs/[id]/cancel` | RUNS:20 | Cancel a running/pending session |

### 12.2 Internal API (Agent Sessions)

| Method | Path | Auth Level | Description |
|---|---|---|---|
| `POST` | `/api/agents/[id]/sessions` | AGENTS:10 | Create new session (run agent with message) |
| `POST` | `/api/agents/[id]/sessions/[sid]/messages` | AGENTS:10 | Send follow-up message to existing session |
| `GET` | `/api/agents/[id]/sessions/[sid]/messages` | AGENTS:10 | Get message history for a session |

### 12.3 External API (v1)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/agents/[slug]/sessions` | API key | Create session via external API |
| `POST` | `/api/v1/agents/[slug]/sessions/[sid]/messages` | API key | Send follow-up message via API |
| `GET` | `/api/v1/agents/[slug]/sessions/[sid]/messages` | API key | Get message history via API |
| `OPTIONS` | `/api/v1/agents/[slug]/sessions` | none | CORS preflight |
| `OPTIONS` | `/api/v1/agents/[slug]/sessions/[sid]/messages` | none | CORS preflight |

### 12.4 Session List Response

```json
{
  "data": [
    {
      "id": "uuid",
      "agentId": "uuid",
      "agentName": "Document Reviewer",
      "status": "waiting",
      "triggerType": "manual",
      "channel": "studio",
      "totalInputTokens": 1234,
      "totalOutputTokens": 567,
      "totalCostUsd": "0.012345",  // with margin applied
      "totalTurns": 3,
      "totalToolCalls": 2,
      "modelUsed": "claude-sonnet-4-6",
      "startedAt": "2026-05-15T10:30:00Z",
      "completedAt": null,
      "createdAt": "2026-05-15T10:30:00Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3
}
```

### 12.5 Session Detail Response

```json
{
  "id": "uuid",
  "agentId": "uuid",
  "agentName": "Document Reviewer",
  "agentSlug": "document-reviewer",
  "status": "waiting",
  "channel": "studio",
  "triggerType": "manual",
  "totalInputTokens": 1234,
  "totalOutputTokens": 567,
  "totalCostUsd": "0.012345",
  "totalToolCalls": 2,
  "totalTurns": 3,
  "modelUsed": "claude-sonnet-4-6",
  "providerUsed": "anthropic",
  "errorMessage": null,
  "startedAt": "...",
  "completedAt": null,
  "createdAt": "...",
  "messages": [
    { "id": 1, "role": "user", "content": "...", "toolCalls": null, "toolCallId": null, "metadata": null, "createdAt": "..." },
    { "id": 2, "role": "assistant", "content": "...", "toolCalls": [...], "toolCallId": null, "metadata": null, "createdAt": "..." },
    { "id": 3, "role": "tool", "content": "...", "toolCalls": null, "toolCallId": "toolu_01...", "metadata": null, "createdAt": "..." }
  ],
  "toolCalls": [
    {
      "id": 1, "toolName": "knowledge_search", "arguments": { "query": "..." },
      "result": "...", "status": "success", "durationMs": 234,
      "requiresApproval": false, "approvalStatus": null, "approvedBy": null,
      "createdAt": "..."
    }
  ]
}
```

---

## 13. Database Tables

### 13.1 `agent_sessions`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | uuid | PK | Session ID |
| `tenant_id` | uuid | FK tenants, NOT NULL, cascade | Tenant scope |
| `agent_id` | uuid | FK agents, NOT NULL, cascade | Agent that ran |
| `workflow_run_id` | uuid | FK workflow_runs, SET NULL | Link to workflow (if applicable) |
| `channel` | text | NOT NULL, default `studio` | Creation channel |
| `trigger_type` | text | NOT NULL, default `manual` | How the session was triggered |
| `trigger_data` | jsonb | NOT NULL, default `{}` | Trigger metadata |
| `status` | run_status enum | NOT NULL, default `pending` | Session lifecycle status |
| `input` | jsonb | NOT NULL, default `{}` | Session input metadata |
| `output` | jsonb | nullable | Session output data |
| `error_message` | text | nullable | Error message if failed |
| `total_input_tokens` | integer | NOT NULL, default `0` | Cumulative input tokens |
| `total_output_tokens` | integer | NOT NULL, default `0` | Cumulative output tokens |
| `total_cost_usd` | numeric(10,6) | NOT NULL, default `0` | Cumulative cost in USD |
| `total_tool_calls` | integer | NOT NULL, default `0` | Total tool calls across all turns |
| `total_turns` | integer | NOT NULL, default `0` | Number of conversation turns |
| `model_used` | text | nullable | Model ID string |
| `provider_used` | text | nullable | Provider type string |
| `started_at` | timestamptz | nullable | When the first LLM call started |
| `completed_at` | timestamptz | nullable | When session finished/failed/cancelled |
| `expires_at` | timestamptz | nullable | Session expiry (not currently enforced) |
| `triggered_by` | uuid | FK users, SET NULL | User who triggered (null for API/cron) |
| `created_at` | timestamptz | NOT NULL, default now | Row creation |

**Indexes:** `(tenant_id)`, `(agent_id)`, `(tenant_id, status)`, `(tenant_id, created_at)`.

### 13.2 `agent_session_messages`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | bigserial | PK | Auto-incrementing message ID |
| `tenant_id` | uuid | FK tenants, NOT NULL, cascade | Tenant scope |
| `agent_session_id` | uuid | FK agent_sessions, NOT NULL, cascade | Parent session |
| `role` | message_role enum | NOT NULL | `user`, `assistant`, `system`, `tool` |
| `content` | text | NOT NULL, default `""` | Message text content |
| `tool_calls` | jsonb | nullable | Tool use blocks (for assistant messages) |
| `tool_call_id` | text | nullable | References tool_use block ID (for tool messages) |
| `metadata` | jsonb | nullable | Extra metadata (e.g., compaction info) |
| `created_at` | timestamptz | NOT NULL, default now | Message timestamp |

**Indexes:** `(agent_session_id)`, `(tenant_id)`.

### 13.3 `agent_session_tool_calls`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | bigserial | PK | Auto-incrementing tool call ID |
| `tenant_id` | uuid | FK tenants, NOT NULL, cascade | Tenant scope |
| `agent_session_id` | uuid | FK agent_sessions, NOT NULL, cascade | Parent session |
| `tool_id` | uuid | FK tools, SET NULL | Tool reference (nullable) |
| `tool_name` | text | NOT NULL | Tool function name |
| `arguments` | jsonb | NOT NULL, default `{}` | Tool call arguments |
| `result` | text | nullable | Tool execution result |
| `status` | tool_call_status enum | NOT NULL, default `pending` | `pending`, `success`, `error`, `denied`, `timeout` |
| `duration_ms` | integer | nullable | Execution time in milliseconds |
| `error_message` | text | nullable | Error details |
| `requires_approval` | boolean | NOT NULL, default `false` | Whether this call needs human approval |
| `approval_status` | text | nullable | `approved` or `denied` (null if not requiring approval) |
| `approved_by` | uuid | FK users, SET NULL | Admin who approved/denied |
| `approved_at` | timestamptz | nullable | When the decision was made |
| `created_at` | timestamptz | NOT NULL, default now | Call timestamp |

**Indexes:** `(agent_session_id)`, `(tenant_id)`, `(tool_name)`.

### 13.4 `usage_records`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | bigserial | PK | Record ID |
| `tenant_id` | uuid | FK tenants, cascade | Tenant scope |
| `user_id` | uuid | FK users, SET NULL | Triggering user |
| `agent_id` | uuid | FK agents, SET NULL | Agent reference |
| `agent_session_id` | uuid | FK agent_sessions, SET NULL | Session reference |
| `provider_model_id` | uuid | FK provider_models, SET NULL | Model reference |
| `model` | text | NOT NULL | Model ID string |
| `provider` | text | NOT NULL | Provider type |
| `input_tokens` | integer | NOT NULL, default `0` | Input tokens this call |
| `output_tokens` | integer | NOT NULL, default `0` | Output tokens this call |
| `cache_read_tokens` | integer | NOT NULL, default `0` | Cache read (reserved) |
| `cache_write_tokens` | integer | NOT NULL, default `0` | Cache write (reserved) |
| `cost_usd` | numeric(10,6) | NOT NULL, default `0` | Cost for this call |
| `request_type` | text | default `chat` | Request type |
| `created_at` | timestamptz | NOT NULL, default now | Record timestamp |

**Indexes:** `(tenant_id)`, `(tenant_id, created_at)`, `(agent_id)`, `(user_id)`.

### 13.5 `progress_spans`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | uuid | PK | Span ID |
| `tenant_id` | uuid | FK tenants, cascade | Tenant scope |
| `trace_id` | uuid | NOT NULL | Groups spans for a session/workflow |
| `parent_id` | uuid | nullable | Parent span (tree structure) |
| `seq` | integer | NOT NULL | Sequence number within trace |
| `span_kind` | varchar(20) | NOT NULL | `agent`, `llm`, `tool` |
| `phase` | varchar(10) | NOT NULL | `start`, `complete`, `error` |
| `name` | varchar(255) | NOT NULL | Span name (model ID, tool name, agent name) |
| `message` | text | nullable | Human-readable status |
| `timestamp_ms` | bigint | NOT NULL | Epoch milliseconds |
| `duration_ms` | integer | nullable | Execution duration |
| `tokens` | integer | nullable | Total tokens |
| `input_tokens` | integer | nullable | Input tokens |
| `output_tokens` | integer | nullable | Output tokens |
| `cost_usd` | numeric(12,6) | nullable | Cost |
| `args_preview` | text | nullable | Truncated tool arguments |
| `result_preview` | text | nullable | Truncated result |
| `args_len` | integer | nullable | Full length of tool arguments before truncation |
| `result_len` | integer | nullable | Full length of tool result before truncation |
| `agent_id`, `agent_name`, `session_id`, `node_id`, `model_id`, `tool_name` | various | nullable | Context fields |

**Indexes:** `(tenant_id, trace_id, seq)`, `(created_at)`, `(session_id)`.

---

## 14. Security Measures

| Measure | Implementation |
|---|---|
| **Tenant isolation** | All session/message/tool-call queries scoped by `tenantId` from JWT or API key. |
| **RBAC** | Session list/detail: RUNS:10 (read). Approve/cancel: RUNS:20 (write). Session creation: AGENTS:10 (read). |
| **API key auth** | SHA-256 hashed keys, checked against `api_keys` table. Supports scoped agent access and expiration. |
| **API key scoping** | If `scopedAgentIds` is set on the key, only those agents are accessible. |
| **Input sanitization** | `sanitizeInput()` from `@ais/security` before any LLM call. |
| **Prompt injection detection** | `detectPromptInjection()` checks for suspicious patterns. If `maxSeverity === "block"`, session is failed immediately. |
| **SSRF protection** | Provider base URLs validated: blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x, 169.254.x), cloud metadata endpoints. |
| **Secret management** | Provider API keys and connector env vars are encrypted at rest, decrypted only at runtime via `decryptSecret()`. |
| **Audit trail** | Session creation, tool approval/denial, and cancellation all write audit log entries. |
| **Loop prevention** | `LoopDetector` prevents infinite tool call loops. `MAX_TOOL_ROUNDS = 10` caps per-turn tool iterations. |
| **Session state validation** | Follow-up messages rejected if session is in terminal state (completed, failed, cancelled). |
| **Cost tracking** | Every LLM call logged to `usage_records` for billing accountability. |

---

## 15. UI Pages

### 15.1 Sessions List Page

**Route:** `/(platform)/runs`  
**Component:** `SessionsPage`

- Table with columns: Agent, Channel, Status, Turns, Tool Calls, Tokens, Cost, Duration, Started.
- Filters: status dropdown (Running/Waiting/Completed/Failed/Cancelled), agent dropdown.
- "Clear filters" button when filters are active.
- Total count displayed.
- Clicking a row navigates to the session detail view.
- Status badges with semantic colors (running=info, completed=success, failed=error, waiting_approval=warning).
- Channel badges (Studio, API, Embedded, Workflow, Connector).
- Cost formatted: `$0.00` for zero, `$X.XXXX` for small amounts, `$X.XX` for larger, `$X.XK` for thousands.
- Duration formatted: ms/s/min based on magnitude.
- Relative timestamps: "Just now", "Xm ago", "Xh ago", or date.

### 15.2 Session Detail View

**Component:** `SessionDetailView`

**Sections:**

1. **Header** — Agent name, session UUID, status badge, back button.

2. **Metrics Grid** (7 cards) — Turns, Tool Calls, Tokens (with in/out breakdown), Cost, Duration, Model, Channel.

3. **Error Banner** — Red alert shown when `errorMessage` is set.

4. **Approval Banner** — Amber alert shown when `status === "waiting_approval"`:
   - Lists pending dangerous tool calls
   - Shows tool name and arguments
   - Approve/Deny buttons per call

5. **Event Feed** — Live SSE event feed for running sessions, historical replay for completed sessions. Shows agent/LLM/tool spans in real-time.

6. **Execution Timeline** — Full message history:
   - **User messages** — avatar, timestamp, plain text
   - **Assistant messages** — avatar, timestamp, Markdown-rendered content, tool call cards (collapsible with args)
   - **Tool results** — collapsible with tool name, duration, status badge, and raw result text
   - **System messages** — compact display of compaction summaries

7. **Tool Calls Summary** — Table of all tool calls: Tool name, Status (badge with icon), Duration, Time.

8. **Workspace Files** — Collapsible file browser showing the agent's workspace directory (files created/modified by tool calls).

---

## 16. Key Source Files

| Purpose | Path |
|---|---|
| Session runner (core) | `packages/agent-runtime/src/session-runner.ts` |
| LLM caller | `packages/agent-runtime/src/llm-caller.ts` |
| Tool executor (router) | `packages/agent-runtime/src/tools/executor.ts` |
| Tool loader | `packages/agent-runtime/src/tools/tool-loader.ts` |
| Tool types | `packages/agent-runtime/src/tools/types.ts` |
| Builtin executors | `packages/agent-runtime/src/tools/builtin-executors.ts` |
| Context executors (KB search) | `packages/agent-runtime/src/tools/context-executors.ts` |
| Risk map | `packages/agent-runtime/src/tools/risk-map.ts` |
| MCP executor | `packages/agent-runtime/src/mcp-executor.ts` |
| Knowledge search | `packages/agent-runtime/src/knowledge-search.ts` |
| Compaction | `packages/agent-runtime/src/compaction.ts` |
| Model pricing | `packages/agent-runtime/src/model-pricing.ts` |
| Prompt builder | `packages/agent-runtime/src/prompt-builder.ts` |
| Provider factory | `packages/agent-runtime/src/provider-factory.ts` |
| Progress bus | `packages/agent-runtime/src/progress-bus.ts` |
| Progress writer (batched persistence) | `packages/agent-runtime/src/progress-writer.ts` |
| Cron scheduler | `packages/agent-runtime/src/cron-scheduler.ts` |
| Runtime types | `packages/agent-runtime/src/types.ts` |
| DB schema (sessions) | `packages/database/src/schema/agent-sessions.ts` |
| DB schema (usage) | `packages/database/src/schema/usage-records.ts` |
| DB schema (progress) | `packages/database/src/schema/progress-spans.ts` |
| Session service | `web/src/lib/services/session.ts` |
| Validation schemas | `packages/validation/src/runs.ts` |
| API key auth | `web/src/lib/api-key-auth.ts` |
| Runs list route | `web/src/app/api/runs/route.ts` |
| Run detail route | `web/src/app/api/runs/[id]/route.ts` |
| Approve route | `web/src/app/api/runs/[id]/approve/route.ts` |
| Cancel route | `web/src/app/api/runs/[id]/cancel/route.ts` |
| v1 session create | `web/src/app/api/v1/agents/[slug]/sessions/route.ts` |
| v1 session messages | `web/src/app/api/v1/agents/[slug]/sessions/[sid]/messages/route.ts` |
| UI sessions page | `web/src/app/(platform)/runs/page.tsx` |
| UI session detail | `web/src/app/(platform)/runs/components/session-detail.tsx` |
| UI message row | `web/src/app/(platform)/runs/components/message-row.tsx` |
| UI agent chat | `web/src/app/(platform)/agents/components/agent-chat.tsx` |

All paths are relative to `ai-studio-app/`.
