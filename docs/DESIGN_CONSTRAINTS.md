# Kairo Studio — Design Constraints, Constants & Configuration

> **Source of truth** for every hardcoded limit, timeout, threshold, and design constraint in the platform.
> Before adding a new constant or changing an existing one, update this document.

---

## 1. Agent Runtime (Centralized Defaults)

**File:** `ai-studio-app/packages/agent-runtime/src/config.ts`  
**Override:** DB (`system_config` key `agent_runtime`) → env var → code default

| Constant | Default | Unit | Controls |
|----------|---------|------|----------|
| `MAX_TOOL_ROUNDS` | 100 | rounds | Max LLM→tool cycles per session |
| `DEFAULT_MAX_TOKENS_PER_TURN` | 16,384 | tokens | Max output tokens per LLM call |
| `WORKFLOW_NODE_TIMEOUT_MS` | 1,800,000 | ms (30 min) | Per-node workflow execution timeout |
| `INVOKE_AGENT_TIMEOUT_MS` | 600,000 | ms (10 min) | Sub-agent invocation timeout |
| `EPHEMERAL_AGENT_TTL_MS` | 86,400,000 | ms (24 hr) | Ephemeral agent session cleanup TTL |
| `EXEC_MAX_STDOUT_BYTES` | 51,200 | bytes (50 KB) | Max stdout from exec_command |
| `EXEC_MAX_STDERR_BYTES` | 10,240 | bytes (10 KB) | Max stderr from exec_command |
| `EXEC_MAX_TIMEOUT_SECONDS` | 300 | sec (5 min) | Hard ceiling on exec_command timeout |
| `EXEC_DEFAULT_TIMEOUT_SECONDS` | 30 | sec | Default exec_command timeout |
| `FILE_MAX_WRITE_BYTES` | 10,485,760 | bytes (10 MB) | Max file write size |
| `RECOVERY_SWEEP_INTERVAL_MS` | 120,000 | ms (2 min) | Recovery sweep polling interval |
| `CLEANUP_INTERVAL_MS` | 3,600,000 | ms (1 hr) | Ephemeral agent cleanup interval |

**Config cache:** `CACHE_TTL_MS = 60,000` (1 min) — hardcoded at line 30. DB config changes take up to 60s to propagate.

---

## 2. Workflow Engine

### Graph Executor (`workflow/graph-executor.ts`)

| Constant | Value | Configurable | Notes |
|----------|-------|-------------|-------|
| `MAX_STEPS` | 200 | Hardcoded | Total node executions per run |
| `MAX_PARALLEL` | 10 | Hardcoded | Max parallel nodes per batch |

### Retry Policy (`workflow/retry.ts`, `workflow/types.ts`)

| Constant | Default | Configurable |
|----------|---------|-------------|
| `onError` | `"stop"` | Per-node `errorPolicy` |
| `maxRetries` | 0 | Per-node |
| `retryDelayMs` | 1,000 ms | Per-node |
| `retryBackoff` | `"fixed"` | Per-node (`"fixed"` or `"exponential"`) |
| `timeoutMs` | 0 (use global) | Per-node |
| Heartbeat interval | 15,000 ms (15s) | Hardcoded |

### Node Handlers (`workflow/node-handlers.ts`)

| Node Type | Constant | Value | Configurable |
|-----------|----------|-------|-------------|
| HTTP request | Default timeout | 30,000 ms | Per-node config |
| Code (VM) | Sandbox timeout | 5,000 ms | Hardcoded |
| Delay | Max delay | 300,000 ms (5 min) | Hardcoded ceiling |
| Loop | Max iterations | 100 | Per-node config |
| Loop | Batch size | 5 | Per-node config |
| ForEach | Max items | 1,000 | Per-node config |

---

## 3. Session Runner

**File:** `agent-runtime/src/session-runner.ts`

| Constant | Value | Configurable | Notes |
|----------|-------|-------------|-------|
| Default `maxTurns` | 25 | Per-agent in DB | Fallback if agent.maxTurns not set |
| Heartbeat tick | 30,000 ms (30s) | Hardcoded | Liveness heartbeat during tool loop |
| Memory injection limit | 10 memories | Hardcoded | Top N memories injected into prompt |
| Memory content truncation | 500 chars | Hardcoded | Per-memory content cap in prompt |

---

## 4. Context Compaction

### App-level (`agent-runtime/src/compaction.ts`)

| Constant | Value | Configurable |
|----------|-------|-------------|
| `COMPACTION_THRESHOLD` | 0.75 | Hardcoded |
| `KEEP_RECENT_MESSAGES` | 6 | Hardcoded |
| `CHARS_PER_TOKEN` | 4 | Hardcoded |

### Core-level (`agentic-core/src/compaction.ts`)

| Constant | Default | Configurable |
|----------|---------|-------------|
| Hard compaction threshold | 0.75 | `config.agent.compactionThreshold` |
| Soft compaction threshold | 0.50 | `config.agent.softCompactionThreshold` |
| Keep recent messages | 10 | `config.agent.keepRecentMessages` |
| Short message skip | 200 chars | Hardcoded |

---

## 5. Progress & Streaming

### Progress Bus (`agent-runtime/src/progress-bus.ts`)

| Constant | Value | Notes |
|----------|-------|-------|
| `RING_BUFFER_SIZE` | 200 events | Replay buffer per trace |
| `MAX_SUBSCRIBERS_PER_TRACE` | 20 | Max SSE connections per session |
| `BACKPRESSURE_HIGH_WATER` | 50 | Queue depth before backpressure |
| `TRACE_TTL_MS` | 1,800,000 ms (30 min) | In-memory trace lifetime |
| Preview truncation | 500 chars | Tool event payload preview |

### Progress Writer (`agent-runtime/src/progress-writer.ts`)

| Constant | Value | Notes |
|----------|-------|-------|
| `FLUSH_INTERVAL_MS` | 500 ms | DB flush cadence |
| `BATCH_SIZE` | 50 | Spans per DB insert |

### Text Delta Bus (`agent-runtime/src/text-delta-bus.ts`)

| Constant | Value | Notes |
|----------|-------|-------|
| Backpressure limit | 100,000 chars | Frontend `useTextStream` cap |

---

## 6. Authentication & Security

**File:** `packages/auth/src/config.ts`

### JWT

| Constant | Value | Notes |
|----------|-------|-------|
| Algorithm | HS256 | Hardcoded |
| Access token expiry | 15 min | Hardcoded |
| Refresh token expiry | 7 days | Hardcoded |
| Min secret length | 32 chars | `JWT_SECRET` validation |
| Issuer / Audience | `ais` / `ais-app` | Hardcoded |

### Password Policy

| Constant | Value | Notes |
|----------|-------|-------|
| Min length | 12 | Hardcoded |
| Max length | 128 | Hardcoded |
| Min zxcvbn strength | 3 (of 4) | Hardcoded |
| History count | 5 | Previous passwords stored |
| Reset token expiry | 30 min | Hardcoded |

### OTP

| Constant | Value | Notes |
|----------|-------|-------|
| Validity | 300s (5 min) | Hardcoded |
| Max resend | 5 | Hardcoded |
| Block duration | 30 min | Hardcoded |

### Rate Limiting

| Constant | Value | Notes |
|----------|-------|-------|
| Login attempts | 5 per 15 min | Per IP+email |
| OTP verify | 5 per 15 min | Per IP+ETUS |
| Rate limiter map size | 10,000 entries | In-memory cap |
| API key RPM | 60 | Per-key default, DB configurable |

---

## 7. Tool Implementations

**File:** `ai-studio-core/packages/tools-common/src/`

### exec_command

| Constant | Value |
|----------|-------|
| Command max length | 10,000 chars |
| Max stdout | 50 KB |
| Max stderr | 10 KB |
| Default timeout | 30s |
| Hard ceiling | 300s |
| `maxBuffer` (Node.js) | 1 MB |
| `multi_exec` max commands | 10 |

### File tools

| Constant | Value |
|----------|-------|
| `write_file` max size | 10 MB |
| File preview max (API) | 100 KB |
| Binary detection window | 8,192 bytes |

### Search tools

| Tool | Max output | Timeout | Default limit |
|------|-----------|---------|--------------|
| `grep` | 4 MB | 30s | 250 lines |
| `glob` | 2 MB | 15s | 200 lines |
| `web_fetch` | 50,000 chars | 30s | — |
| `web_search` (Brave) | 10 results | 15s | 5 results |

### Other tools

| Tool | Constant | Value |
|------|----------|-------|
| `batch_replace` | Max files | 1,000 |
| `pdf_read` | Max pages | 50 |
| `pdf_read` | Timeout | 60s |
| `patch_apply` | Timeout | 30s |

---

## 8. Tool Platform

**File:** `ai-studio-core/packages/tool-platform/src/`

| Constant | Value | Notes |
|----------|-------|-------|
| Result budget per turn | 256 KB | `DEFAULT_RESULT_BUDGET_BYTES` |
| Persist threshold | 16 KB | Results > 16KB written to disk |
| Persisted preview | 1,024 chars | Shown in context for large results |
| Loop detector window | 5 calls | Sliding window |
| Loop detector threshold | 3 repeats | Trips loop detection |
| Hook timeout | 5,000 ms | Before/after tool hooks |
| Hook max stdout | 64 KB | Hook process output cap |
| Ring buffer (core) | 200 events | Progress event replay |

---

## 9. Tool Assignment Rules

**File:** `agent-runtime/src/tools/tool-loader.ts`

| Rule | Condition | Tools Added |
|------|-----------|-------------|
| Assigned tools | Always | Agent's explicitly assigned tools |
| Safe builtins | Always (auto-seed) | All `riskLevel="safe"` tools |
| KB tools | Agent has KB links | `knowledge_search`, `knowledge_refine_search` |
| Agent tools | Not a sub-agent | `list_agents`, `invoke_agent` |
| Memory tools | Always | `remember`, `recall`, `forget` |
| Meta-tools | `trusted` AND `metadata.platformTools=true` | `create_agent`, `create_workflow`, `trigger_workflow`, `get_config`, `set_config` |
| MCP tools | Agent has connectors | Tools from MCP connector discovery |

---

## 10. RAG Engine

**File:** `ai-studio-core/packages/rag-engine/src/`

### Chunking

| Constant | Default | Configurable |
|----------|---------|-------------|
| Chunk size | 2,048 chars | Per-KB config |
| Chunk overlap | 200 chars | Per-KB config |
| Min chunk length | 10 chars | Hardcoded |
| Parent chunk size | 2,048 chars | Per-KB config |
| Child chunk size | 512 chars | Per-KB config |

### Search & Retrieval

| Constant | Value | Notes |
|----------|-------|-------|
| Default `top_k` | 5 | Per-KB config |
| Default similarity threshold | 0.3 | Per-KB config |
| RRF constant `k` | 60 | Hardcoded |
| Query decomposition max | 3 sub-queries | Hardcoded |
| Contextual enrichment max doc | 8,000 chars | Hardcoded |
| Contextual enrichment concurrency | 5 | Hardcoded |
| Enrichment max tokens | 150 | Hardcoded |
| HyDE hypothesis max tokens | 300 | Hardcoded |
| Graph extraction max tokens | 1,000 | Hardcoded |
| Embedding batch size | 100 | Hardcoded |
| Embedding concurrency | 5 | Hardcoded |
| Multimodal concurrency | 3 | Hardcoded |
| Cross-query score boost | +10% per hit | Hardcoded |

### Document Ingestion

| Constant | Value | Notes |
|----------|-------|-------|
| Chunk upsert batch | 50 | Both Qdrant and Drizzle stores |
| Max upload size | 50 MB | KB document upload route |

---

## 11. Provider Bridge

**File:** `ai-studio-core/packages/provider-bridge/src/`

### Timeouts

| Constant | Value | Notes |
|----------|-------|-------|
| TTFT (first token) | 60,000 ms | Before any token arrives |
| Idle (between tokens) | 120,000 ms | Between streaming tokens |
| Anthropic OAuth idle | 120,000 ms | Specific to OAuth path |
| Connection test | 15,000 ms | Provider test endpoint |
| Opus model timeout | 180,000 ms | Extended for Claude Opus |
| Standard model timeout | 120,000 ms | Default streaming timeout |

### Retries

| Constant | Value | Notes |
|----------|-------|-------|
| Max retries | 3 | Provider call retries |
| Base backoff delay | 1,000 ms | Exponential base |
| Max backoff delay | 30,000 ms | Backoff cap |
| Overloaded (529) base | 2,000 ms | Higher base for overloaded |

### Other

| Constant | Value | Notes |
|----------|-------|-------|
| Default max output tokens | 8,192 | Fallback if not in API response |
| Default context window | 128,000 | OpenAI fallback |
| Thinking budget minimum | 10,000 tokens | Anthropic thinking mode |

---

## 12. Database & Connection

| Constant | Value | Location | Notes |
|----------|-------|----------|-------|
| Connection pool max | 10 | `database/src/connection.ts` | Per-process |
| Message max length | 100,000 chars | API routes (Zod validation) | User message cap |
| Pagination default | 15 rows | `web/src/lib/client-config.ts` | All list views |
| Dashboard activity | 20 items | Hardcoded in route | Recent activity feed |
| Dashboard top agents | 10 items | Hardcoded in route | Top agents widget |
| Input sanitization max | 50,000 chars | `security/src/input.ts` | Default `sanitizeInput` length |

---

## 13. Frontend Constants

### Chat Assistant (`web/src/components/chat-assistant/`)

| Constant | Value | Notes |
|----------|-------|-------|
| Poll interval | 2,500 ms | Async session polling |
| Text stream backpressure | 100,000 chars | `useTextStream` accumulator cap |
| Chat upload max size | 10 MB | `/api/chat/upload` |
| Text file inline threshold | 500,000 bytes | Text content returned inline if below |

### Health Check (`api/health`)

| Constant | Default | Configurable |
|----------|---------|-------------|
| Max RSS MB | 8,192 | `HEALTH_MAX_RSS_MB` env var |

---

## 14. Memory System

| Constant | Value | Location | Notes |
|----------|-------|----------|-------|
| Memory key max | 200 chars | `context-executors.ts` | Per-memory key |
| Memory content max | 50,000 chars | `context-executors.ts` | Per-memory value |
| Recall limit | 20 (max), 5 (default) | `context-executors.ts` | Per-query |
| Prompt injection | 10 memories, 500 chars each | `session-runner.ts` | Auto-injected at session start |

---

## Design Principles

1. **3-tier override:** DB (per-tenant) → env var → code default. All runtime config in `config.ts` follows this.
2. **Hardcoded = intentional ceiling.** Things like `MAX_STEPS=200`, `MAX_PARALLEL=10`, `VM_TIMEOUT=5s` are safety boundaries, not tuning knobs.
3. **Per-entity overrides in DB:** Agent-level (`maxTurns`, `maxTokensPerTurn`), KB-level (chunk size, threshold), API-key-level (`rateLimitRpm`), workflow-node-level (`errorPolicy`).
4. **Cache invalidation gap:** Config cache has 60s TTL. DB changes to `agent_runtime` config take up to 60s to propagate. This caused the timeout override to not take effect in the eSentinel workflow run.

---

## Known Gaps

- [ ] Config cache has no invalidation signal — relies on TTL expiry only
- [ ] No per-workflow-node tool whitelist/blacklist
- [ ] No agent template system for predefined prompts + tool configs
- [ ] No per-step cost limit enforcement
- [ ] No completion criteria enforcement in session runner
- [ ] Dashboard query limits hardcoded — not tenant-configurable
