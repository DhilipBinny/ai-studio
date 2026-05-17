# 20 — Assistant Mode (Personal Agent)

Design for a persistent, interactive AI assistant that users converse with — complementing the autonomous workflow mode.

---

## 0. Vision

Two modes of interaction with the platform:

```
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│  WORKFLOW MODE (existing)         │    │  ASSISTANT MODE (new)             │
│                                   │    │                                   │
│  Autonomous, fire-and-forget      │    │  Interactive, conversational      │
│  Multiple agents in pipeline      │    │  One agent, multi-turn            │
│  Fixed task, finite               │    │  Open-ended, ongoing              │
│  No human during execution        │    │  Human guides in real-time        │
│  Good for: bulk generation,       │    │  Good for: debugging, testing,    │
│  migration, parallel work         │    │  exploration, platform management │
└──────────────────────────────────┘    └──────────────────────────────────┘
```

Both use the SAME engine (session runner, tools, providers, compaction).

---

## 1. What Changes

| Aspect | Workflow Mode | Assistant Mode |
|--------|-------------|----------------|
| Session lifecycle | One message → complete | Multi-message → stays active |
| Tool rounds per message | 100 (configurable) | 100 (same — user sends focused messages) |
| Compaction | Disabled (short sessions) | Enabled (long conversations) |
| End condition | First `end_turn` = done | `end_turn` = respond to user, wait for next |
| Channel | `workflow` / `cron` / `sub_agent` | `studio` / `api` |
| Memory | None (ephemeral) | Persistent (cross-session) |
| Tools available | Task-specific subset | All tools + platform meta-tools |

---

## 2. Multi-Turn Session (Core Change)

### Current Behavior

```
User sends message → runSession() → tool loop → end_turn → status = "completed"
```

### New Behavior (studio/api channel)

```
User sends message → runSession() → tool loop → end_turn → status = "waiting"
                                                              ↓
User sends another message → resumeSession() → tool loop → end_turn → status = "waiting"
                                                              ↓
User sends "bye" / closes → status = "completed"
```

### Implementation

**session-runner.ts** — After tool loop, for interactive channels:
```typescript
// At end of runSession():
if (["studio", "api"].includes(input.channel || "studio")) {
  // Don't complete — wait for next message
  await db.update(agentSessions)
    .set({ status: "waiting" })
    .where(eq(agentSessions.id, sessionId));
} else {
  // Autonomous channels: complete immediately
  await db.update(agentSessions)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(agentSessions.id, sessionId));
}
```

**New API endpoint** — `POST /api/agents/{id}/sessions/{sid}/messages`:
```typescript
// Appends user message to existing session, re-enters tool loop
// Returns assistant response (sync) or 202 (async)
```

### Session State Machine (Updated)

```
                          ASSISTANT MODE
pending → running → waiting → running → waiting → running → ... → completed
              │         ↑         │         ↑
              │         │         │         │
              │    user sends    │    user sends
              │    next message  │    next message
              │                  │
              └── (error) ──► failed
```

---

## 3. Memory System

Persistent knowledge that survives across sessions. The agent remembers the user, their projects, preferences, and past decisions.

### Schema

```sql
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',  -- user, project, preference, fact
  embedding VECTOR(1536),                     -- for semantic search
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, agent_id, key)
);
```

### Memory Tools

| Tool | Purpose |
|------|---------|
| `remember` | Save a fact/preference: `remember({key, content, category})` |
| `recall` | Semantic search: `recall({query, limit})` → returns relevant memories |
| `forget` | Delete: `forget({key})` |
| `list_memories` | List all by category: `list_memories({category})` |

### Memory Injection

On every assistant turn, inject relevant memories into system prompt:
```typescript
const memories = await searchMemories(agentId, tenantId, userMessage, limit=5);
if (memories.length > 0) {
  systemPrompt += "\n\n## Remembered Context\n" + memories.map(m => `- ${m.content}`).join("\n");
}
```

### What Gets Remembered

The agent decides what to remember (like Claude Code's memory):
- User preferences: "I prefer concise responses"
- Project context: "This project uses .NET 10 + Angular 21"
- Decisions: "We chose PostgreSQL over MySQL for unified DB"
- Facts: "The eSentinel repo is on Azure DevOps"

---

## 4. Platform Meta-Tools

The assistant can manage the platform itself — no web UI needed:

### Agent Management
```
create_agent({name, slug, persona, rules, model, tools})
update_agent({id, changes})
list_agents({filter?})
delete_agent({id})
```

### Workflow Management
```
create_workflow({name, nodes, edges})
update_workflow({id, changes})
trigger_workflow({id, input})
list_workflows()
get_workflow_status({runId})
```

### Scheduling
```
create_schedule({agentId, cron, message})
list_schedules()
delete_schedule({id})
```

### Workspace
```
browse_files({scope, path})
upload_file({path, content})
download_file({path})
```

### Settings
```
get_config({key?})
set_config({key, value})
```

### Implementation

Each meta-tool calls the existing service layer directly (not HTTP — internal function call). This avoids auth overhead and gives full access within the tenant scope.

---

## 5. Conversation API

### Start Conversation

```
POST /api/agents/{id}/sessions
{
  "message": "Hello, let's work on the eSentinel project",
  "channel": "studio"
}
→ 200 { sessionId, response, status: "waiting" }
```

### Continue Conversation

```
POST /api/agents/{id}/sessions/{sid}/messages
{
  "message": "Can you check if dotnet build passes?"
}
→ 200 { response, toolCallCount, status: "waiting" }
```

### End Conversation

```
POST /api/agents/{id}/sessions/{sid}/close
→ 200 { status: "completed", summary }
```

### Stream Responses (SSE)

```
GET /api/progress?traceId={sessionId}
→ SSE stream of: thinking, tool calls, text chunks
```

---

## 6. Mobile App (Future)

The assistant API is client-agnostic. A mobile app simply calls the same endpoints:

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Web UI      │     │  Mobile App     │     │  CLI / API       │
│  (React)     │     │  (React Native) │     │  (curl/SDK)      │
└──────┬───────┘     └────────┬────────┘     └────────┬─────────┘
       │                      │                       │
       ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  POST /api/v1/agents/{slug}/sessions/{sid}/messages             │
│  GET  /api/progress?traceId={sid}  (SSE for streaming)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Session Runner     │
                    │  (same engine)      │
                    └─────────────────────┘
```

---

## 7. Implementation Status

### Phase 1: Floating Chat Widget + Multi-Turn — DONE
- [x] Floating button (bottom-right, all pages)
- [x] Chat panel (400x560px card, fullscreen mobile)
- [x] Agent selector dropdown (all active agents)
- [x] Multi-turn sessions (sessionStorage persistence)
- [x] Markdown rendering with syntax highlighting (rehype-highlight)
- [x] Copy code button + copy message button
- [x] Live activity indicator (CompactStatus via SSE)
- [x] Accessibility (ARIA labels, escape key, role="dialog", role="log")
- [x] Image rendering in markdown responses

### Phase 1.5: Trust Level + Tool Approval + Project Context — DONE
- [x] `trust_level` column on agents (supervised/trusted/restricted)
- [x] Executor checks trust level before requiring approval
- [x] Trust level dropdown in agent edit form
- [x] In-widget tool approval cards (amber, Approve/Deny)
- [x] Auto-approve checkbox (pre-checked for trusted agents)
- [x] Project selector dropdown in widget header
- [x] Async mode: widget sends with `async:true`, polls for result
- [x] Token/cost display per assistant message
- [x] Messages endpoint supports `async: true`

### Phase 2: Memory (Future)
- [ ] Migration: `agent_memories` table
- [ ] Memory tools: remember, recall, forget, list_memories
- [ ] Memory injection in prompt builder
- [ ] Embedding generation for semantic recall (uses existing provider-bridge)
- **Enables:** Persistent context, user preferences, project knowledge

### Phase 3: Platform Meta-Tools (Future)
- [ ] Agent management tools (create, update, list, delete)
- [ ] Workflow management tools (create, trigger, status)
- [ ] Schedule tools (create, list, delete)
- [ ] Workspace tools (browse, upload)
- [ ] Settings tools (get, set)
- **Enables:** "Create a workflow that does X" via chat

### Phase 4: Mobile Client
- [ ] React Native app with chat UI
- [ ] Push notifications via SSE → Firebase
- [ ] Biometric auth
- [ ] Offline queue (send messages when back online)
- **Effort:** Separate project
- **Enables:** Agent access from anywhere

---

## 8. How Workflows + Assistant Work Together

```
User: "Migrate the providers module to Angular"
Assistant: "I'll create a workflow for that. Let me set it up..."
         → calls create_workflow() + trigger_workflow()
         → "Workflow running. I'll monitor it."

[5 min later]
Assistant: "Workflow completed. 3 modules migrated. Build passes.
            But there are 2 SQL quoting issues in UserController."
User: "Fix them"
Assistant: → calls batch_replace() → fixes both
         → "Fixed. dotnet build passes. Want me to test the endpoints?"
User: "Yes"
Assistant: → starts server → curls endpoints → reports results
```

The assistant orchestrates workflows for bulk work, then handles the interactive follow-up. Best of both worlds.

---

## 9. Trust Level Model

Per-agent setting that controls tool approval behavior across all channels.

### Enum Values

| Level | Dangerous Tools | Moderate Tools | Safe Tools |
|-------|----------------|----------------|------------|
| `supervised` (default) | Requires approval | Auto-approved | Auto-approved |
| `trusted` | Auto-approved | Auto-approved | Auto-approved |
| `restricted` | Blocked entirely | Requires approval | Auto-approved |

### Widget Behavior

- Agent is `trusted` → "Auto-approve" checkbox pre-checked → tools run without prompts
- Agent is `supervised` → checkbox unchecked → shows amber approval cards inline
- Agent is `restricted` → dangerous tools return error, no approval option
- User can toggle "Auto-approve" per-session (overrides default)

### Implementation

```
executor.ts → check agent.trustLevel:
  "trusted"    → skip approval (same as workflow channel)
  "restricted" → return error for dangerous tools
  "supervised" → current behavior (approval card)
```

### Schema

```sql
ALTER TABLE agents ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'supervised';
```

---

## 10. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Agent modifying other tenants | All meta-tools scoped by tenant_id from JWT |
| Runaway memory growth | Max 500 memories per agent, oldest evicted |
| Credential exposure in memory | Never remember secrets; memory content is not encrypted |
| Meta-tool abuse (delete all agents) | RBAC: meta-tools respect user's permission level |
| Session hijacking | Session bound to user; resumeSession validates ownership |
| Cost runaway in long conversations | Per-session cost tracking + configurable alert/kill threshold |

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Avg messages per session (assistant) | 5-15 (interactive, focused) |
| Tool rounds per message | < 30 (user sends focused requests) |
| Memory recall accuracy | > 80% relevant (semantic search) |
| Task completion with assistant vs workflow-only | 95% vs 60% for complex tasks |
| User satisfaction (debugging with assistant) | Resolved in < 10 messages |