# 18 - Multi-Agent Framework

Shared project workspaces, sub-agent invocation, and autonomous execution for multi-agent collaboration on codebases.

---

## 1. Overview

The multi-agent framework enables multiple agents to collaborate on a shared codebase through:

- **Project Workspace**: a shared folder all agents read/write to
- **invoke_agent Tool**: spawn sub-agents from within a session
- **Auto-approve**: automated channels skip human tool approval
- **One-shot completion**: sub-agent/workflow/cron sessions auto-complete

---

## 2. Project Workspace

### 2.1 Concept

A "project" is a shared filesystem folder scoped to a tenant. Multiple agents can read/write the same files when bound to the same project.

**Path structure:**
```
DATA_ROOT/tenants/<tenant_id>/projects/<project_id>/
  .git/                 ← optional, initialized via API
  _source/              ← reference codebase (read-only convention)
  src/                  ← target code (agents write here)
  PROGRESS.md           ← agent checkpoint file (convention)
```

### 2.2 How It Works

1. Admin creates a project via API
2. Agent sessions receive `projectId` in metadata
3. File tools (`read_file`, `write_file`, `edit_file`, `glob`, `grep`) resolve relative to the project folder instead of the agent's isolated workspace
4. `exec_command` / `batch_exec` use the project folder as `cwd`
5. All agents with the same projectId share the same filesystem

### 2.3 Path Resolution Priority

```
if (config.projectId)     → DATA_ROOT/tenants/{tid}/projects/{pid}/
else if (config.workflowRunId) → DATA_ROOT/tenants/{tid}/workspace/runs/{rid}/
else                      → DATA_ROOT/tenants/{tid}/workspace/agents/{aid}/
```

### 2.4 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/projects` | SETTINGS 10 | List projects (paginated) |
| POST | `/api/projects` | SETTINGS 20 | Create project |
| GET | `/api/projects/[id]` | SETTINGS 10 | Get project details + filesystem path |
| PATCH | `/api/projects/[id]` | SETTINGS 20 | Update name/description/status |
| POST | `/api/projects/[id]` | SETTINGS 20 | Actions: clone, copy, init_git |
| DELETE | `/api/projects/[id]` | SETTINGS 20 | Archive (soft delete) |

**POST actions:**

| Action | Input | Behavior |
|--------|-------|----------|
| `clone` | `{ action: "clone", gitUrl: "..." }` | `git clone <url> .` into project folder |
| `copy` | `{ action: "copy", sourcePath: "..." }` | Copies source directory contents into project folder |
| `init_git` | `{ action: "init_git" }` | Runs `git init` in project folder |

**Security:** The `copy` action blocks system directories (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`, `/proc`, `/sys`, `/dev`, `/root`).

### 2.5 DB Table: `projects`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK → tenants | cascade delete |
| name | text | not null, unique per tenant |
| description | text | default "" |
| source_url | text | nullable (clone URL) |
| status | text | "active", "archived" |
| created_by | uuid FK → users | set null on delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Indexes:** `(tenant_id)`, UNIQUE `(tenant_id, name)`  
**RLS:** enabled, policy filters by `tenant_id`

### 2.6 Binding Agents to Projects

Projects are bound at session-trigger time via metadata, not at agent configuration:

```json
POST /api/agents/{id}/sessions
{
  "message": "...",
  "metadata": { "projectId": "uuid-of-project" }
}
```

For workflows, pass `projectId` in the workflow input:
```json
POST /api/workflows/{id}/run
{ "input": { "projectId": "uuid-of-project", ... } }
```

The workflow agent node automatically extracts `input.projectId` and passes it to spawned sessions.

---

## 3. invoke_agent Tool

### 3.1 Purpose

Allows one agent (parent) to spawn another agent (sub-agent) and wait for its response. Enables coordinator patterns where a manager agent delegates specialized tasks.

### 3.2 Tool Definition

```json
{
  "name": "invoke_agent",
  "description": "Spawn a sub-agent session and wait for it to complete.",
  "input_schema": {
    "type": "object",
    "properties": {
      "agent_id": { "type": "string", "description": "UUID of the agent to invoke" },
      "message": { "type": "string", "description": "The task/prompt to send to the sub-agent" },
      "project_id": { "type": "string", "description": "Optional project ID for shared workspace" },
      "timeout_ms": { "type": "number", "description": "Max wait (default: 600000, max: 600000)" }
    },
    "required": ["agent_id", "message"]
  }
}
```

### 3.3 Execution Flow

```
Parent agent calls invoke_agent(agent_id, message, project_id)
    │
    ├─ Validate: target agent exists + same tenant
    ├─ Insert agent_tasks row (status: running)
    ├─ Call runSession() with channel: "sub_agent"
    │   └─ Sub-agent runs tool loop → auto-completes
    ├─ Update agent_tasks (status: completed/failed, result, duration)
    │
    ▼
Return to parent: session ID, response, usage, duration
```

### 3.4 Restrictions

| Rule | Rationale |
|------|-----------|
| No nesting | Sub-agents cannot invoke further sub-agents. `invoke_agent` is stripped from sub-agent tool lists. |
| Tenant isolation | Target agent must belong to the same tenant. Validated before spawn. |
| Timeout | Max 10 minutes. Timer properly cleared on completion or error. |
| One-shot | Sub-agent sessions auto-complete (don't linger in "waiting") |

### 3.5 Tool Availability

- **Always loaded** for parent agents (added in tool-loader after knowledge search tools)
- **Stripped** from sub-agent sessions (`isSubAgent` flag in metadata → tool-loader excludes it)

### 3.6 DB Table: `agent_tasks`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK → tenants | cascade delete |
| project_id | uuid FK → projects | set null on delete |
| parent_session_id | uuid FK → agent_sessions | set null (the caller) |
| child_session_id | uuid FK → agent_sessions | set null (the spawned session) |
| agent_id | uuid FK → agents | cascade delete |
| status | text | "running", "completed", "failed" |
| description | text | first 200 chars of message |
| prompt | text | full message sent to sub-agent |
| result | text | sub-agent response (max 5000 chars) |
| error_message | text | error if failed |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| duration_ms | integer | |
| notified | boolean | default false |
| created_at | timestamptz | |

**Indexes:** `(tenant_id)`, `(parent_session_id)`, `(tenant_id, status)`  
**RLS:** enabled, policy filters by `tenant_id`

---

## 4. Auto-Approve for Automated Channels

### 4.1 Problem

Dangerous tools (`exec_command`, `batch_exec`) require human approval in interactive sessions. But automated pipelines (workflows, sub-agents, cron jobs) have no human present to approve.

### 4.2 Solution

Sessions with `channel` in `["sub_agent", "workflow", "cron"]` skip the approval gate. The design-time configuration (admin assigned the tool to the agent) IS the authorization.

### 4.3 Safety Layers

| Layer | Protection |
|-------|-----------|
| **Blocked patterns** | `exec_command` safety blocklist blocks rm -rf, mkfs, git push --force, etc. regardless of channel |
| **SSRF protection** | HTTP requests still validate URLs against private IPs |
| **Tool assignment** | Agents only have tools explicitly assigned by admin |
| **Workspace isolation** | File tools can't escape project/tenant boundary (path traversal blocked) |
| **Approval** | Interactive (studio) sessions still require human approval for dangerous tools |

### 4.4 Implementation

In `executor.ts`, before the approval flow:
```typescript
if (toolRisk === "dangerous") {
  const [sessionRow] = await db.select({ channel: agentSessions.channel })...
  const autoApproveChannels = ["sub_agent", "workflow", "cron"];
  if (autoApproveChannels.includes(sessionRow.channel)) {
    // Skip approval — proceed directly to execution
  }
}
```

---

## 5. One-Shot Session Completion

### 5.1 Problem

`runSession()` always returned `status: "waiting"` after the tool loop — designed for interactive chat where the user sends follow-up messages. Sub-agents and workflow agents don't need follow-ups.

### 5.2 Solution

Sessions with channel `sub_agent`, `workflow`, or `cron` auto-complete:
- Set `status = "completed"` in DB
- Set `completedAt` timestamp
- Return `status: "completed"` to caller

Interactive sessions (channel `studio`, `api`) retain the `waiting` behavior for multi-turn conversations.

---

## 6. Exec Command Enhancements

### 6.1 Per-Agent Timeout

| Field | Location | Behavior |
|-------|----------|----------|
| `exec_timeout_ms` | agents table | Maximum timeout ceiling for this agent |
| `timeout` | tool call input | Per-call override (clamped to agent ceiling) |
| Default | constant | 30 seconds |
| Hard max | constant | 120 seconds |

Resolution: `min(args.timeout, agentMaxTimeout, EXEC_MAX_TIMEOUT_SECONDS)`

### 6.2 Project Workspace as CWD

When `projectId` is set on the workspace config:
- `exec_command` runs in the project folder (not temp workspace)
- `batch_exec` runs in the project folder (not temp workspace)
- Agents can run `git status`, `dotnet build`, `ng build` in the project root

### 6.3 Git Safety Blocklist

Added patterns:
| Pattern | Reason |
|---------|--------|
| `git push --force` | Force push (destructive) |
| `git reset --hard` | Hard reset (destructive) |
| `git clean -f` | Forced clean (destructive) |
| `git branch -D main/master` | Delete main branch |

All other git commands (status, add, commit, branch, checkout, diff, merge, log) are allowed.

---

## 7. Workflow Integration

### 7.1 Passing projectId to Agent Nodes

Workflow agent nodes automatically extract `projectId` from:
1. `node.config.projectId` (explicit node configuration), OR
2. `state.input.projectId` (from workflow trigger input)

This means triggering a workflow with `{ input: { projectId: "..." } }` gives all agent nodes in that workflow access to the shared project folder.

### 7.2 Example: Migration Workflow

```
Workflow input: { projectId: "abc", module: "agents" }

[Input] → state.input = { projectId: "abc", module: "agents" }
[Agent: Schema] → spawns session with projectId="abc", reads _source/, writes migration.sql
[Agent: Backend] → spawns session with projectId="abc", reads migration.sql, writes controllers
[Agent: Frontend] → spawns session with projectId="abc", writes Angular components
[Agent: Test] → spawns session with projectId="abc", runs dotnet build in project folder
```

All agents share the same project folder and can see each other's output files.

---

## 8. Security Measures

| Layer | Protection |
|-------|-----------|
| **Tenant isolation** | Projects scoped to tenant_id. Agents can only access projects in same tenant. |
| **Path traversal** | `resolveTenantPath()` validates all file paths stay within workspace boundary. Symlinks validated. |
| **No absolute paths** | File tools reject absolute paths. Only relative paths within project folder. |
| **Source copy restriction** | API blocks copying from system directories (/etc, /var, /usr, /proc, etc.) |
| **Exec blocklist** | 21 dangerous command patterns blocked regardless of channel. |
| **No recursion** | Sub-agents cannot spawn further sub-agents (max depth = 1). |
| **Timeout enforcement** | invoke_agent has 10-min hard cap. exec_command clamped to 120s. |
| **Audit trail** | Project create/update/archive logged. Agent task lifecycle tracked. |
| **RLS** | Row-level security on projects + agent_tasks tables. |

---

## 9. Migration

**Migration 024** (`024_projects_and_agent_tasks.sql`):
- Creates `projects` table with RLS
- Creates `agent_tasks` table with RLS
- Adds `project_id` column to `agent_sessions`
- Adds `exec_timeout_ms` column to `agents`
