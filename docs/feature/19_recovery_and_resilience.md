# 19 — Recovery & Resilience

Session and workflow lifecycle management — heartbeat monitoring, stale process recovery, and fault tolerance for the agent runtime.

---

## 0. Problem Statement

Agent sessions and workflow runs are long-lived processes (seconds to hours). They can become orphaned when:
- Server restarts (deploy, crash, OOM)
- Network partition kills an LLM streaming connection
- Process hangs (deadlock, unresponsive downstream)

Without active recovery, these processes stay in `running` state forever — consuming no resources but confusing users and blocking dependent work.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────┐
│  Session Runner (per session)                        │
│                                                      │
│  ┌──────────────────────────────────┐               │
│  │ Heartbeat Interval (30s)         │               │
│  │ UPDATE last_heartbeat_at = NOW() │               │
│  └──────────────────────────────────┘               │
│                                                      │
│  Tool Loop: LLM call → tools → LLM → tools → done  │
│  On exit: clearInterval(heartbeat)                   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Recovery Sweep (runs every 2 min via setInterval)   │
│                                                      │
│  1. Workflow steps: last_heartbeat_at < NOW() - 90s  │
│     → mark step + run as failed                      │
│                                                      │
│  2. Workflow runs: timeout_at < NOW()                │
│     → mark as timeout                                │
│                                                      │
│  3. Agent sessions: last_heartbeat_at < NOW() - 60s  │
│     → mark as failed ("server restart")              │
│                                                      │
│  Only affects sessions WITH heartbeat (not legacy)   │
└─────────────────────────────────────────────────────┘
```

---

## 2. Heartbeat Mechanism

### How It Works

1. **Session starts** → immediate heartbeat (`UPDATE last_heartbeat_at = NOW()`)
2. **Every 30s** → heartbeat ticks (setInterval)
3. **LLM thinking (2-3 min)** → heartbeat still ticking (independent of tool calls)
4. **Session completes** → `clearInterval(heartbeat)`
5. **Server crashes** → heartbeat stops → recovery sweep detects within 60s

### Schema

```sql
-- Migration 025
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
```

### Implementation (session-runner.ts)

```typescript
// Start heartbeat at beginning of tool loop
const heartbeatInterval = setInterval(async () => {
  try {
    await db.update(agentSessions)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(agentSessions.id, sessionId));
  } catch { /* non-fatal */ }
}, 30_000);

// Immediate first heartbeat
await db.update(agentSessions)
  .set({ lastHeartbeatAt: new Date() })
  .where(eq(agentSessions.id, sessionId));

// ... tool loop runs ...

// Clear on exit
clearInterval(heartbeatInterval);
```

---

## 3. Recovery Sweep

### Thresholds

| Target | Stale Threshold | Rationale |
|--------|----------------|-----------|
| Workflow steps | 90s | Steps have heartbeats via `last_heartbeat_at` on `workflow_run_steps` |
| Workflow runs (timeout) | `timeout_at` column | Explicit deadline set at trigger time |
| Agent sessions | 60s | Heartbeat ticks every 30s; 60s = missed 2 cycles = definitely dead |

### Safety: Only Heartbeat-Enabled Sessions

```sql
WHERE status = 'running'
AND last_heartbeat_at IS NOT NULL           -- only new sessions with heartbeat
AND last_heartbeat_at < threshold::timestamptz
```

Sessions without `last_heartbeat_at` (legacy, pre-migration) are never touched by the sweep.

### Recovery Actions

| Condition | Action |
|-----------|--------|
| Stale workflow step | Set step `status=failed`, set run `status=failed` |
| Timed-out workflow run | Set run `status=timeout` |
| Stale agent session | Set session `status=failed`, `error_message="Session interrupted (server restart)"` |

### Schedule

- Runs every **120 seconds** (2 min) via `setInterval` in `instrumentation.ts`
- First sweep runs immediately on server startup (catches orphans from previous crash)
- Non-blocking: errors in sweep are caught and logged, never crash the server

---

## 4. LLM Call Retry

When an LLM streaming call fails (timeout, network abort, rate limit), the caller retries automatically.

### Classification (provider-bridge/errors.ts)

```typescript
classifyError(e, attempt) → {
  type: 'timeout' | 'rate_limit' | 'connection_error' | 'server_error' | ...
  action: 'retry_immediately' | 'failover' | 'give_up'
  retriable: boolean
  retryDelayMs: number
}
```

### Retry Logic (llm-caller.ts)

```typescript
const MAX_RETRIES = 3;

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    return await provider.chat(chatArgs);
  } catch (e) {
    const classified = classifyError(e, attempt);
    if (classified.retriable && attempt < MAX_RETRIES) {
      if (classified.retryDelayMs > 0) await sleep(classified.retryDelayMs);
      continue;
    }
    throw e;
  }
}
```

### Retry Behavior by Error Type

| Error | Classified As | Action | Delay |
|-------|--------------|--------|-------|
| "Request was aborted" | timeout | Retry immediately | 0 |
| AbortError (idle timeout) | timeout | Retry immediately | 0 |
| HTTP 429 | rate_limit | Retry with backoff | 1s, 2s, 4s |
| ECONNRESET | connection_error | Retry immediately | 0 |
| HTTP 529 (overloaded) | server_error | Retry with backoff | 1s, 2s, 4s |
| HTTP 401 | auth_error | Give up | — |
| HTTP 400 | invalid_request | Give up | — |

---

## 5. Streaming Timeout (TTFT + Idle)

Protects against dead connections without killing slow-but-active streams.

```
┌─────────── TTFT timer (60s) ───────────┐
│ Waiting for first streaming event...    │
│ If no event → abort                     │
└─────────────────────────────────────────┘
         ↓ first event arrives
┌─────────── Idle timer (120s) ──────────┐
│ Resets on EVERY streaming chunk         │
│ If silence > 120s → abort               │
│ Active generation (chunks flowing) →    │
│   timer keeps resetting, never fires    │
└─────────────────────────────────────────┘
```

### Key Insight

The idle timer fires only if the connection goes completely silent. During active LLM generation (tokens streaming), `onActivity()` resets the timer on every chunk. A 5-minute generation is fine as long as tokens keep flowing.

---

## 6. Configuration

All thresholds are in `config.ts` DEFAULTS (overridable via Settings → Advanced):

```typescript
DEFAULTS = {
  RECOVERY_SWEEP_INTERVAL_MS: 120_000,   // 2 min between sweeps
  // Heartbeat: 30s tick, 60s stale threshold (hardcoded in recovery.ts)
  // Streaming: 60s TTFT, 120s idle (in streaming-timeout.ts)
  // Retry: 3 max attempts (in llm-caller.ts)
}
```

---

## 7. Key Files

| File | Purpose |
|------|---------|
| `agent-runtime/src/session-runner.ts` | Heartbeat start/stop, tool loop |
| `agent-runtime/src/workflow/recovery.ts` | Recovery sweep logic |
| `agent-runtime/src/llm-caller.ts` | Retry loop with error classification |
| `provider-bridge/src/streaming-timeout.ts` | TTFT + idle timer |
| `provider-bridge/src/errors.ts` | Error classification (classifyError) |
| `web/src/instrumentation.ts` | Sweep scheduling (setInterval) |
| `database/src/migrations/025_session_heartbeat.sql` | Schema change |

---

## 8. Observability

### Logs

- Recovery sweep logs recovered count: `"Recovered N stale sessions/steps"`
- LLM retry logs each attempt: `"Retry attempt 2/3 after timeout"`
- Heartbeat is silent (no log per tick — too noisy)

### Progress Spans

- Session failure emits a span: `spanKind: "agent", phase: "error", message: "Session interrupted"`
- Retry emits: `spanKind: "llm", phase: "retry", message: "Attempt 2 after timeout"`

### Health Check

`GET /api/health` (detail mode) could include:
- `staleSessionCount`: sessions in `running` with stale heartbeat
- `lastSweepAt`: timestamp of last successful sweep
- `retryRate`: % of LLM calls that required retry (last hour)

---

## 9. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Server restarts during LLM call | Heartbeat stops → sweep marks failed in 60s |
| LLM takes 3 min thinking (no stream) | TTFT timer fires at 60s → abort → retry (up to 3x) |
| LLM streams slowly (1 token/30s) | Idle timer resets on each token → never fires |
| Network drops mid-stream (no more chunks) | Idle timer fires after 120s → abort → retry |
| Rate limited (429) | Retry with exponential backoff → succeeds on attempt 2-3 |
| Auth revoked mid-session | classifyError → give_up → session fails |
| DB connection lost during heartbeat | try/catch → silently fails → next tick retries |
| Sweep runs during active session | last_heartbeat_at is fresh → not considered stale |
| Legacy session (no heartbeat column) | `last_heartbeat_at IS NULL` → excluded from sweep |
