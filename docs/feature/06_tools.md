# 06 - Tools

Tool registry with CRUD, builtin/MCP/custom tool types, risk-based access control, sandboxed workspace execution, dangerous tool approval flow, and context-aware knowledge search.

---

## 0. Architecture Overview

### 3-Layer Model

```
Layer 1: CODE (Definitions + Executors — hardcoded)
├── ai-studio-core/packages/tools-common/src/
│   ├── files.ts      → read_file, write_file, edit_file, list_directory
│   ├── exec.ts       → exec_command, batch_exec (with 17 safety patterns)
│   ├── web.ts        → web_fetch, web_search (with SSRF protection)
│   ├── grep.ts, glob.ts, patch.ts, pdf.ts
│   └── index.ts      → exports allBuiltinTools[] (all above merged)
├── ai-studio-app/packages/agent-runtime/src/tools/
│   ├── builtin-executors.ts  → get_current_time, calculate, echo (inline)
│   ├── context-executors.ts  → knowledge_search (needs session context)
│   └── risk-map.ts           → BUILTIN_TOOL_RISK + BUILTIN_TOOL_CATEGORY

Layer 2: DATABASE (Registry — seeded from code + admin-created custom tools)
├── tools table         → ALL tools stored per tenant (builtin + custom + mcp)
└── agent_tools table   → many-to-many: which tools assigned to which agent

Layer 3: RUNTIME (Assembled per session)
└── tool-loader.ts → loadToolDefinitions() builds the final tool list
```

### Why Hardcoded Names?

Executor logic (the actual code that runs) cannot be stored in a database. So:

| What | Where | Why |
|------|-------|-----|
| Executor function | Code (`tools-common`, `builtin-executors`) | Executable code, not data |
| Risk level | Code (`risk-map.ts`) | Security decision, not user-configurable |
| Safety patterns | Code (`exec.ts` blocked commands) | Security enforcement |
| Tool name, description, schema | DB (`tools` table) | Seeded from code; visible to admin UI |
| Agent-tool assignment | DB (`agent_tools` table) | Admin manages via UI |
| Custom tools | DB only | User-defined, no hardcoded executor |
| MCP tools | Dynamic (MCP servers) | Discovered at runtime per connector |

### End-to-End Flow

**1. Seeding** (first session per tenant) — `seedBuiltinToolsForTenant(tenantId)`:
- Takes names from `allBuiltinTools` keys + `["get_current_time", "calculate", "echo"]`
- Looks up risk from `BUILTIN_TOOL_RISK`, category from `BUILTIN_TOOL_CATEGORY`
- `INSERT INTO tools ... ON CONFLICT DO NOTHING` (idempotent)

**2. Assignment** (admin UI) — `POST /api/agents/{id}/tools`:
- Admin assigns tools to agents via `agent_tools` junction table
- Safe builtins are auto-included even if not explicitly assigned

**3. Session loading** — `loadToolDefinitions(agentId, tenantId)`:
- A: Query `agent_tools` → explicitly assigned tools
- B: Auto-add ALL safe builtins (read_file, grep, etc.)
- C: If agent has knowledge bases → add `knowledge_search`
- D: If agent has MCP connectors → load MCP tools dynamically
- Returns: `{ definitions[], mcpConnectorMap, workspaceConfig }`

**4. Execution** — `executeTool(call)` dispatch priority:
1. Loop detection check
2. Risk check → if "dangerous", require human approval
3. Route by priority: `mcp__*` → `CONTEXT_EXECUTORS` → `builtinToolMap` → `BUILTIN_EXECUTORS` → error
4. Execute with tenant-scoped workspace context
5. Record result in `agent_session_tool_calls` table

---

## 1. Tool Registry (CRUD)

### 1.1 Behavior

- Tools are scoped to a tenant. Name must be unique per tenant (DB unique constraint `tenantId + name`).
- Tool names must be lowercase with underscores, matching pattern `/^[a-z][a-z0-9_]*$/`.
- Every update increments `version` counter (`version = version + 1`).
- Soft delete via `is_active = false` with `deactivated_at` timestamp (no hard delete).
- Tool types: `builtin`, `custom`, `mcp`, `api`, `code`.
- Safe builtin tools are auto-seeded per tenant on first tool load if none exist.
- All write operations create audit log entries.

### 1.2 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tools` | RBAC: TOOLS level 10 | Paginated list, filterable by type and category |
| POST | `/api/tools` | RBAC: TOOLS level 20 | Create a new tool |
| GET | `/api/tools/[id]` | RBAC: TOOLS level 10 | Get tool detail |
| PATCH | `/api/tools/[id]` | RBAC: TOOLS level 20 | Update tool |
| POST | `/api/tools/[id]/deactivate` | RBAC: TOOLS level 20 | Soft delete (set is_active=false) |

**GET /api/tools** query params:
- `page`, `pageSize` (standard pagination)
- `type` (optional) -- filter by tool_type enum
- `category` (optional) -- filter by category string

**POST /api/tools** request body:
```json
{
  "name": "string (1-255, lowercase+underscores, required)",
  "displayName": "string (1-255, required)",
  "description": "string (max 2000, optional)",
  "toolType": "builtin | custom | mcp | api | code (default: custom)",
  "category": "string (max 100, optional, default: general)",
  "parametersSchema": "object (optional, JSON Schema for inputs)",
  "returnsSchema": "object (optional, JSON Schema for outputs)",
  "config": "object (optional, tool-specific config)"
}
```

**PATCH /api/tools/[id]** request body (all optional):
```json
{
  "displayName": "string (1-255)",
  "description": "string (max 2000)",
  "category": "string (max 100)",
  "parametersSchema": "object",
  "returnsSchema": "object",
  "config": "object"
}
```

**Error codes:**
- `NAME_EXISTS` (409) -- duplicate name in same tenant.
- `NOT_FOUND` (404) -- tool not found or wrong tenant.
- `VALIDATION_ERROR` (400) -- Zod schema failure.

### 1.3 DB Table: `tools`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| tenant_id | uuid FK -> tenants | cascade delete |
| name | text | not null, machine-readable identifier |
| display_name | text | not null, human-readable label |
| description | text | default "" |
| tool_type | tool_type enum | builtin, custom, mcp, api, code |
| category | text | default "general" |
| parameters_schema | jsonb | default {} -- JSON Schema for inputs |
| returns_schema | jsonb | default {} -- JSON Schema for outputs |
| risk_level | text | default "safe" |
| config | jsonb | default {} -- tool-specific configuration |
| version | integer | default 1, incremented on update |
| is_active | boolean | default true |
| deactivated_at | timestamptz | null until deactivated |
| created_by | uuid FK -> users | set null on delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Indexes:** `idx_tools_tenant(tenant_id)`, `idx_tools_type(tenant_id, tool_type)`, `idx_tools_category(tenant_id, category)`.
**Unique constraint:** `(tenant_id, name)`.

### 1.4 DB Table: `tool_permissions`

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial PK | auto-increment |
| tenant_id | uuid FK -> tenants | cascade delete |
| role | text | user role name |
| tool_pattern | text | tool name or glob pattern |
| permission | tool_permission_level enum | allow, deny, confirm, power_user |
| created_at | timestamptz | |

**Indexes:** `idx_tool_perms_tenant(tenant_id)`, `idx_tool_perms_lookup(tenant_id, role)`.

### 1.5 Validation Schemas

Defined in `packages/validation/src/tools.ts`:

- `createToolSchema` -- name (1-255, regex validated), displayName (1-255), description (max 2000 optional), toolType (enum, default "custom"), category (max 100 optional), parametersSchema (optional), returnsSchema (optional), config (optional).
- `updateToolSchema` -- all fields optional except name and toolType (not updatable).

---

## 2. Builtin Tools

### 2.1 Tool Categories and Sources

Builtin tools are defined in `ai-studio-core/packages/tools-common/` and loaded via `allBuiltinTools`. Additional simple executors live in `packages/agent-runtime/src/tools/builtin-executors.ts`.

### 2.2 File Operation Tools

| Tool | Description | Risk | Parameters | Sandbox |
|------|-------------|------|-----------|---------|
| `read_file` | Read file contents from agent workspace. Supports offset/limit for line ranges. | safe | `path`, `offset?`, `limit?` | Workspace-jailed |
| `write_file` | Write content to a file. Creates parent dirs. Max 10MB. | moderate | `path`, `content` | Workspace-jailed |
| `edit_file` | Find-and-replace exact text in a file. Supports single or all occurrences. | moderate | `path`, `old_string`, `new_string`, `replace_all?` | Workspace-jailed |
| `list_directory` | List files and directories at a path. Shows dirs with trailing `/`. | safe | `path?` | Workspace-jailed |
| `read_pdf` | Extract text from PDF files. Max 50 pages. | safe | `path`, `pages?` | Workspace-jailed |

### 2.3 Search Tools

| Tool | Description | Risk | Parameters | Sandbox |
|------|-------------|------|-----------|---------|
| `glob` | List files matching a glob pattern, sorted by modification time (newest first). Respects .gitignore. | safe | `pattern`, `path?` (search root), `head_limit?` (max results) | Workspace-jailed |
| `grep` | Search file contents with ripgrep. Output modes: files_with_matches (default), content, count. | safe | `pattern`, `path?` (alias `glob`, search root), `type?`/`output_mode?` (files_with_matches/content/count), `case_insensitive?`, `context_lines?`, `head_limit?` | Workspace-jailed |

### 2.4 Patch Tool

| Tool | Description | Risk | Parameters | Sandbox |
|------|-------------|------|-----------|---------|
| `apply_patch` | Apply a git-formatted unified diff patch to files. Uses `git apply`. | moderate | `patch` | Workspace-jailed |

### 2.5 Web Tools

| Tool | Description | Risk | Parameters | Sandbox |
|------|-------------|------|-----------|---------|
| `web_fetch` | Fetch a URL and extract readable text content. Strips HTML/scripts/styles. Max 50,000 chars default. | safe | `url`, `maxChars?` | SSRF-protected |
| `web_search` | Search the web via Brave Search API. Returns titles, URLs, snippets. | safe | `query`, `count?` (1-10) | Requires BRAVE_API_KEY |

**SSRF protection for web_fetch:**
- Only HTTP/HTTPS allowed.
- Blocks: localhost, loopback, private IPs (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x, 100.64-127.x, 240+).
- Blocks: cloud metadata endpoints (metadata.google.internal, instance-data).
- DNS rebinding check: resolves hostname, validates resolved IP.
- Redirect validation: re-checks SSRF on each redirect (max 5 redirects).
- 30-second timeout per request.

### 2.6 Execution Tools

| Tool | Description | Risk | Parameters | Sandbox |
|------|-------------|------|-----------|---------|
| `exec_command` | Execute a shell command in the agent's temp workspace. | dangerous | `command`, `timeout?` (default 30s, max 120s) | Sandboxed env |
| `batch_exec` | Run up to 10 shell commands in parallel. | dangerous | `commands[]`, `timeout?` | Sandboxed env |

**Exec sandboxing:**
- Runs in a temp directory scoped to the session: `.data/tenants/{tenantId}/temp/{sessionId}/`.
- Uses a stripped environment (only PATH, HOME, USER, SHELL, TERM, LANG, TZ, etc.).
- Max command length: 10,000 chars.
- Max stdout: 10KB. Max stderr: 5KB.
- Blocked command patterns (17 patterns):
  - `rm -rf /` and recursive deletes on root
  - `mkfs`, `dd of=/dev/`, `shutdown`, `reboot`, `init 0/6`, `kill -9 1`
  - `curl|sh`, `wget|sh` (remote code execution)
  - LD_PRELOAD/DYLD injection
  - Reading credential files (.ssh, .aws, .env, secrets.json, .docker/config)
  - Reading shell history
  - Disabling critical services via systemctl
  - Redirect to disk device (`> /dev/[sh]d`)
  - LD_LIBRARY_PATH hijacking

### 2.7 Utility Tools (Inline Executors)

These are defined directly in `builtin-executors.ts`:

| Tool | Description | Risk | Parameters |
|------|-------------|------|-----------|
| `get_current_time` | Returns current date/time in specified timezone. | safe | `timezone?` (default UTC) |
| `calculate` | Evaluate a math expression (numbers and +,-,*,/,(),%  only). | safe | `expression` |
| `echo` | Return the input message. | safe | `message` |

---

## 3. Tool Permissions and Risk Levels

### 3.1 Risk Levels

Defined in `packages/agent-runtime/src/tools/risk-map.ts`:

| Risk Level | Tools | Behavior |
|------------|-------|----------|
| **safe** | read_file, list_directory, glob, grep, web_fetch, web_search, read_pdf, get_current_time, calculate, echo | Automatically available to all agents. No approval needed. All tools in this list are present in both risk-map and category-map. |
| **moderate** | write_file, edit_file, apply_patch | Must be explicitly assigned to agent. No approval needed. |
| **dangerous** | exec_command, batch_exec | Requires human approval before execution (approval flow). |

### 3.2 Risk Map

```typescript
{
  read_file: "safe",      list_directory: "safe",   glob: "safe",
  grep: "safe",           web_fetch: "safe",        web_search: "safe",
  read_pdf: "safe",       get_current_time: "safe", calculate: "safe",
  echo: "safe",
  write_file: "moderate", edit_file: "moderate",     apply_patch: "moderate",
  exec_command: "dangerous", batch_exec: "dangerous",
  // ✅ FIXED: "echo" is now included in the risk-map (safe).
}
```

### 3.3 Category Map

```typescript
{
  read_file: "file_operations",  write_file: "file_operations",
  edit_file: "file_operations",  list_directory: "file_operations",
  glob: "file_operations",       read_pdf: "file_operations",
  apply_patch: "file_operations", grep: "search",
  web_fetch: "web",             web_search: "web",
  exec_command: "execution",    batch_exec: "execution",
  get_current_time: "utility",  calculate: "utility",
  echo: "utility",
  // ✅ FIXED: "echo" is now included in the category-map (utility).
}
```

### 3.4 Permission Levels (DB Enum)

The `tool_permission_level` enum supports:
- `allow` -- tool can be used freely.
- `deny` -- tool is blocked for this role.
- `confirm` -- requires confirmation before use.
- `power_user` -- elevated access.

---

## 4. Tool Execution Flow

### 4.1 Overview

**File:** `packages/agent-runtime/src/tools/executor.ts`

The `executeTool()` function is the central dispatch for all tool calls:

```
Tool Call -> Loop Detection -> Risk Check -> Approval Check -> Dispatch -> Record Result
```

### 4.2 Execution Steps

1. **Loop detection**: `loopDetector.record(name, input)` checks for repeated identical calls (prevents infinite tool loops).
2. **Risk assessment**: looks up risk level from `BUILTIN_TOOL_RISK` map first, then falls back to the `tools` table for custom tools.
3. **Dangerous tool approval** (if risk = "dangerous"):
   - Checks for an existing approved tool call record in `agent_session_tool_calls`.
   - If no approval found or arguments don't match: creates a `pending` tool call record, sets session to `waiting_approval`, returns a message telling the LLM that approval is needed.
   - If previously approved with matching arguments: proceeds with execution.
4. **Dispatch** (in priority order):
   - **MCP tools** (name starts with `mcp__`): routes to `executeMCPTool()`.
   - **Context executors** (e.g. `knowledge_search`): calls context-aware executor with agent/tenant context.
   - **Builtin tools** (from `allBuiltinTools`): validates input if `validateInput` exists, then calls executor with workspace config and Brave API key.
   - **Inline executors** (from `BUILTIN_EXECUTORS`): simple function call.
   - **Unknown**: returns error "Tool has no executor".
5. **Record**: inserts into `agent_session_tool_calls` with tool name, arguments, result, status (success/error), and duration.

### 4.3 Result Conversion

`toolResultToString()` normalizes tool results from the core `ToolResult` type:
- String results: returned as-is.
- Object with `content[]` array: extracts text blocks and joins with newlines.
- Object with `error`: formats as "Error: {message}".
- Other objects: JSON stringified.

---

## 5. MCP Tool Integration

### 5.1 Architecture

**File:** `packages/agent-runtime/src/mcp-executor.ts`

MCP (Model Context Protocol) tools are loaded from connectors of type `"mcp"` that are assigned to an agent.

### 5.2 Loading MCP Tools

`loadMCPTools(agentId, tenantId)`:

1. Queries `agent_connectors` joined with `connectors` table for active MCP connectors assigned to the agent.
2. For each connector:
   - Parses `connectionConfig` for transport type (`stdio` or `sse`), command, args, env.
   - Decrypts env vars if encrypted (using `decryptSecret()`).
   - Connects to MCP server via `MCPBridge` (lazy singleton).
   - Lists tools from the MCP server.
   - Maps each tool to a namespaced name: `mcp__{slug}__{toolname}` where slug is the slugified connector name.
3. Returns `{ tools: ToolDefinition[], connectorMap: Map<fullName, connectorId> }`.

### 5.3 Executing MCP Tools

`executeMCPTool(fullToolName, args, connectorMap)`:

1. Parses the name: splits on `__`, validates prefix is `mcp`.
2. Extracts the actual tool name (parts after the slug).
3. Looks up the connector ID from the map.
4. Calls `mcpBridge.callTool(connectorId, actualToolName, args)`.

### 5.4 Naming Convention

```
mcp__{connector_slug}__{tool_name}
```

Example: connector "GitHub Integration" with tool "get_issue" -> `mcp__github_integration__get_issue`.

---

## 6. Context Tools

### 6.1 Knowledge Search

**File:** `packages/agent-runtime/src/tools/context-executors.ts`

The `knowledge_search` tool is a context-aware executor that requires agent and tenant context:

| Field | Value |
|-------|-------|
| Name | `knowledge_search` |
| Description | Search the agent's assigned knowledge bases for relevant information |
| Input | `query` (string, required), `top_k` (number, default 5) |
| Output | Formatted results with score, knowledge base name, document name, content |

**Behavior:**
1. Calls `searchKnowledge(query, agentId, tenantId, { topK })` (vector similarity search).
2. If no results: returns "No relevant documents found."
3. Results formatted as numbered list: `[N] (score: 0.XXX) [KB Name / Doc Name]\n{content}` separated by `---`.

**Auto-loading**: knowledge_search is automatically added to the tool definitions if the agent has any knowledge base assignments (checked via `agent_knowledge_bases` table).

**Note:** `knowledge_search` is available both as a tool (via agent sessions or workflow `tool` nodes) and as a dedicated workflow node type. The `knowledge_search` node handler is now implemented in `executeNode()` using a lazy import of `searchKnowledge`, accepting `knowledgeBaseId`, `query`, `topK`, and `scoreThreshold` config fields.

### 6.2 Knowledge Refine Search (Agentic RAG)

**File:** `packages/agent-runtime/src/tools/context-executors.ts`

The `knowledge_refine_search` tool enables agentic retrieval refinement — the LLM can iteratively refine its search when initial results are insufficient.

| Field | Value |
|-------|-------|
| Name | `knowledge_refine_search` |
| Description | Refine a previous knowledge search with a new query. Previously returned chunks are excluded. |
| Input | `query` (string, required), `reason` (string, required — why previous results were insufficient), `top_k` (number, default 5) |
| Output | Formatted results (same format as `knowledge_search`), or exhaustion message |

**Session-Scoped Search State:**

The tool maintains a `SearchSessionState` across the session lifetime:

```typescript
interface SearchSessionState {
  seenChunkIds: Set<number>;    // chunk IDs already returned
  iterationCount: number;        // how many refinements so far
  previousQueries: string[];     // history of all queries
}
```

**Behavior:**
1. Checks `iterationCount >= 3` (MAX_ITERATIONS) — if exceeded, returns a message telling the LLM to work with existing results.
2. Increments `iterationCount`, records the query in `previousQueries`.
3. Calls `searchKnowledge(query, agentId, tenantId, { topK })`.
4. **Deduplicates:** Filters out any chunk IDs already in `seenChunkIds` — only new/unseen chunks are returned.
5. Adds new chunk IDs to `seenChunkIds`.
6. If no fresh results: returns a message listing previous queries.

**Key constraints:**
- Maximum 3 iterations per session (prevents runaway LLM loops).
- Chunk deduplication across iterations (the LLM always gets fresh content).
- `reason` parameter is required — forces the LLM to explain why it needs more results.
- The `knowledge_search` tool initializes the search state (if not already present) and tracks returned chunk IDs, so a subsequent `knowledge_refine_search` call correctly deduplicates.

**Auto-loading:** `knowledge_refine_search` is automatically added alongside `knowledge_search` when the agent has knowledge base assignments.

---

## 7. Tool Loading and Agent Assignment

### 7.1 Tool Loader

**File:** `packages/agent-runtime/src/tools/tool-loader.ts`

`loadToolDefinitions(agentId, tenantId, sessionId?, workflowRunId?)`:

1. **Assigned tools**: loads tools assigned to the agent via `agent_tools` join with `tools` table (active only).
2. **Safe builtins**: loads all tenant builtin tools with `riskLevel = "safe"`. If none exist, auto-seeds the tenant with `seedBuiltinToolsForTenant()`.
3. **Knowledge search**: added if agent has knowledge base links.
4. **MCP tools**: loaded via `loadMCPTools()`.
5. **Workspace setup**: if any builtin tools are present and a session ID exists, creates the workspace directory structure.

Returns `{ definitions, mcpConnectorMap, workspaceConfig }`.

### 7.2 Builtin Tool Seeding

`seedBuiltinToolsForTenant(tenantId)`:

Inserts all builtin tool names into the `tools` table for the tenant with:
- `toolType = "builtin"`
- Display names auto-generated from snake_case (e.g. "read_file" -> "Read File").
- Risk levels and categories from the risk map.
- Uses `onConflictDoNothing()` for idempotent seeding.

### 7.3 Workspace Configuration

When tools are loaded, a `WorkspaceConfig` is created:

```typescript
interface WorkspaceConfig {
  dataRoot: string;      // process.env.DATA_ROOT || ".data"
  tenantId: string;
  agentId: string;
  sessionId: string;
  workflowRunId?: string;
}
```

Workspace paths:
- **Agent workspace**: `.data/tenants/{tenantId}/workspace/agents/{agentId}/`
- **Workflow run workspace**: `.data/tenants/{tenantId}/workspace/runs/{workflowRunId}/`
- **Shared workspace**: `.data/tenants/{tenantId}/workspace/shared/`
- **Temp directory**: `.data/tenants/{tenantId}/temp/{sessionId}/`

---

## 8. Tool Approval Flow (Dangerous Tools)

### 8.1 Trigger

When a tool with `riskLevel = "dangerous"` is called:

1. The executor checks `agent_session_tool_calls` for a matching approved record (same session, tool name, and argument hash).
2. If no match:
   - Creates a `pending` record in `agent_session_tool_calls` with `requiresApproval = true`.
   - Updates the agent session status to `"waiting_approval"`.
   - Returns a message to the LLM: *"This tool requires human approval before execution. The session is paused until an admin approves or denies this tool call."*
3. If a previously approved record exists with matching arguments:
   - Proceeds with normal execution.

### 8.2 Approval Decision

The session remains paused with `status = "waiting_approval"` until an admin:
- Approves: sets `approvalStatus = "approved"` on the tool call record. The next session turn re-calls the tool and finds the approval.
- Denies: sets `approvalStatus = "denied"`. The tool call returns an error.

### 8.3 Argument Matching

Approval is tied to specific arguments. The executor serializes arguments with `JSON.stringify(call.input)` and compares against the stored record's arguments. If the agent retries with different arguments, a new approval is needed.

---

## 9. Workspace Sandboxing

### 9.1 Path Resolution

**File:** `ai-studio-core/packages/tools-common/src/workspace.ts`

`resolveTenantPath(requestedPath, config)`:

1. **Absolute paths blocked**: throws "Access denied: absolute paths not allowed".
2. **Control characters blocked**: null bytes and control chars rejected.
3. **Shared namespace**: paths starting with `shared/` resolve to the shared workspace.
4. **Path traversal prevention**: resolved path must be within agent workspace or shared workspace. Any escape throws "Access denied: path resolves outside workspace".
5. **Symlink attack prevention**: if the resolved path exists and is a symlink, the real path is checked against workspace boundaries.

### 9.2 File Size Limits

| Limit | Value |
|-------|-------|
| Max file write size | 10 MB |
| Max exec stdout | 10 KB |
| Max exec stderr | 5 KB |
| Max exec timeout | 120 seconds |
| Default exec timeout | 30 seconds |
| Max PDF pages | 50 |
| PDF timeout | 60 seconds |

---

## 10. UI Page

### 10.1 Tools Page

**Route:** `/(platform)/tools`

**List view:**
- Table with columns: Tool (displayName + name + description), Type (badge), Risk (colored badge: green=safe, amber=moderate, red=dangerous), Category, Version, Edit button.
- Pagination at bottom.
- Empty state with "Add Tool" CTA.
- Total count displayed.

**Create dialog:**
- Fields: Machine Name (required, pattern-validated), Display Name (required), Description, Type dropdown (Custom/Builtin/MCP/API/Code), Category.

**Edit dialog:**
- Shows read-only: machine name, type, risk badge, version.
- Editable: Display Name, Description, Category.
- Deactivate (soft delete) with confirmation step.
- Dirty check: requires at least one changed field.

### 10.2 Risk Badge Display

| Risk Level | Colors |
|------------|--------|
| Safe | Green background/text |
| Moderate | Amber background/text |
| Dangerous | Red background/text |

---

## 11. Security Measures

| Layer | Protection |
|-------|-----------|
| **API auth** | All endpoints require JWT via `withRBAC()`. TOOLS module, level 10 for read, level 20 for write. |
| **Tenant isolation** | Every query includes `WHERE tenant_id = ?` from JWT claims. |
| **Audit logging** | Create, update, deactivate all create audit entries. |
| **Workspace sandboxing** | Path traversal prevention, symlink attack detection, absolute path blocking, control character rejection. |
| **SSRF protection** | web_fetch blocks private IPs, localhost, cloud metadata, validates DNS resolution, checks redirects. |
| **Command safety** | exec_command blocks 17 dangerous patterns (rm -rf /, mkfs, curl|sh, credential reading, disk device redirects, LD_LIBRARY_PATH hijacking, etc.). |
| **Env stripping** | exec_command runs with minimal safe environment variables only. |
| **File size limits** | 10MB write cap, 10KB stdout cap, 5KB stderr cap. |
| **Tool approval** | Dangerous tools require human approval with argument matching. Session pauses until admin decision. |
| **Loop detection** | `LoopDetector` prevents infinite repeated identical tool calls. |
| **Input validation** | Zod schemas on all API endpoints; builtin tools have optional `validateInput()` with detailed error messages. |
| **MCP isolation** | MCP tool names are namespaced to prevent collision; connector configs support encrypted env vars. |
| **Version control** | Auto-incrementing version on updates for optimistic locking. |

---

## 12. Tool Types Summary

| Type | Source | Registration | Execution |
|------|--------|-------------|-----------|
| **builtin** | `tools-common` package | Auto-seeded per tenant | `builtinToolMap` lookup -> `executor()` with workspace context |
| **custom** | Created via API | Manual in tools table | Requires a custom executor or API endpoint |
| **mcp** | MCP server connectors | Loaded dynamically from connected servers | `executeMCPTool()` via MCPBridge |
| **api** | Created via API | Manual in tools table | Configured endpoint in `config` |
| **code** | Created via API | Manual in tools table | Custom code executor |

**Inline executors** (get_current_time, calculate, echo) are defined in `BUILTIN_EXECUTORS` as simple async functions and do not require workspace configuration.
