# 09 - Connectors

Comprehensive documentation for the Connector system in Echol AI Studio, covering connector types, CRUD operations, credentials encryption, connection testing, MCP integration, and agent-connector assignments.

---

## Architecture Overview

| Layer | Package | Responsibility |
|-------|---------|---------------|
| Core MCP client | `ai-studio-core/packages/mcp-client/` | MCP protocol client, command allowlist, secure env handling |
| DB schema | `ai-studio-app/packages/database/src/schema/connectors.ts` | Connector + agent_connectors tables |
| Validation | `ai-studio-app/packages/validation/src/connectors.ts` | Zod schemas for create/update |
| API routes | `ai-studio-app/web/src/app/api/connectors/` | REST endpoints for CRUD and testing |
| Agent API routes | `ai-studio-app/web/src/app/api/agents/[id]/connectors/` | Agent-connector assignment endpoints |
| Auth/encryption | `ai-studio-app/packages/auth/src/encryption.ts` | AES-256-GCM for credentials |

---

## 1. Connector Types

| Type | Enum Value | Description |
|------|-----------|-------------|
| Database | `database` | Direct database connections (connection strings, etc.) |
| REST API | `rest_api` | External REST API endpoints |
| MCP | `mcp` | Model Context Protocol servers (stdio transport only -- SSE is NOT IMPLEMENTED) |
| Webhook | `webhook` | Outbound webhook endpoints |
| GraphQL | `graphql` | GraphQL API endpoints |

### Connector Type Enum (DB)
```sql
CREATE TYPE connector_type AS ENUM ('database', 'rest_api', 'mcp', 'webhook', 'graphql');
```

### Connector Status Enum (DB)
```sql
CREATE TYPE connector_status AS ENUM ('active', 'inactive', 'error', 'testing');
```

---

## 2. Connector CRUD

### Behavior
- Each connector belongs to a tenant and has a unique name within that tenant.
- Credentials (`credentialsRef`) are encrypted with AES-256-GCM before storage.
- Environment variables in `connectionConfig.env` are also individually encrypted.
- All secrets are masked as `"****"` in responses.
- Deletion is soft-delete (`is_active=false`, `deactivated_at` set).
- MCP connectors have additional command validation against an allowlist.

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/connectors` | CONNECTORS:10 (read) | List connectors with pagination |
| POST | `/api/connectors` | CONNECTORS:20 (write) | Create a new connector |
| GET | `/api/connectors/[id]` | CONNECTORS:10 | Get connector detail |
| PATCH | `/api/connectors/[id]` | CONNECTORS:20 | Update connector |
| DELETE | `/api/connectors/[id]` | CONNECTORS:20 | Soft-delete connector |

### Request / Response Shapes

**POST /api/connectors** (create)
```json
{
  "name": "GitHub MCP",
  "description": "GitHub MCP server for code search",
  "connectorType": "mcp",
  "connectionConfig": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"
    }
  },
  "credentialsRef": "optional-credential-string",
  "healthCheckUrl": "https://api.github.com"
}
```

**PATCH /api/connectors/[id]** (update -- partial)
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "connectionConfig": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_TOKEN": "new-token"
    }
  }
}
```

### Response (secrets masked)
```json
{
  "id": "uuid",
  "name": "GitHub MCP",
  "connectorType": "mcp",
  "connectionConfig": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_TOKEN": "****"
    }
  },
  "credentialsRef": "****",
  "status": "active",
  "lastTestedAt": "2026-05-15T...",
  "lastError": null
}
```

### Validation (Zod)

| Schema | File |
|--------|------|
| `createConnectorSchema` | `packages/validation/src/connectors.ts` |
| `updateConnectorSchema` | `packages/validation/src/connectors.ts` |

Key constraints:
- `name`: 1-255 chars, unique per tenant
- `description`: max 2000 chars
- `connectorType`: one of the 5 enum values
- `connectionConfig`: required object (freeform)
- `credentialsRef`: max 2000 chars, optional
- `healthCheckUrl`: valid URL, optional

---

## 3. DB Table: `connectors`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | References `tenants.id`, cascade delete |
| name | text | NOT NULL, unique per tenant |
| description | text | Default `""` |
| connector_type | enum | `connector_type` enum |
| connection_config | jsonb | Transport, command, args, env, url, etc. |
| credentials_ref | text | Encrypted credential string, nullable |
| health_check_url | text | Optional URL for health checks |
| status | enum | `active`, `inactive`, `error`, `testing` |
| last_tested_at | timestamptz | Updated on test |
| last_error | text | Last error message, nullable |
| is_active | boolean | Soft-delete flag |
| deactivated_at | timestamptz | Set on soft-delete |
| created_by | uuid FK | References `users.id` |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Indexes:** `idx_connectors_tenant(tenant_id)`, `idx_connectors_type(tenant_id, connector_type)`, unique on `(tenant_id, name)`.

---

## 4. Credentials Encryption

### Behavior
Connector secrets are encrypted at multiple levels:

### 4.1 credentialsRef
- The `credentialsRef` field is encrypted with `encryptSecret()` on create/update.
- Stored as `v{n}:{iv}:{ciphertext}:{tag}` format.
- Decrypted on demand when needed for connection.

### 4.2 connectionConfig.env Values
- Each individual value in the `connectionConfig.env` object is encrypted separately.
- On create: `{ "GITHUB_TOKEN": "ghp_xxx" }` becomes `{ "GITHUB_TOKEN": "v1:iv:ct:tag" }`.
- On update: new env values are encrypted before storage.
- On test: each env value is checked with `isEncrypted()` and decrypted if needed.

### 4.3 Response Masking
The `maskConnectorSecrets()` function masks:
- `credentialsRef` -> `"****"`
- Each key in `connectionConfig.env` -> `"****"`

**Note:** `maskConnectorSecrets()` is duplicated across two route files (`web/src/app/api/connectors/route.ts` and `web/src/app/api/connectors/[id]/route.ts`). Both contain identical implementations rather than sharing a single utility.

### Encryption Details
Same AES-256-GCM implementation as provider API keys. See `packages/auth/src/encryption.ts`:
- Algorithm: AES-256-GCM
- IV: 12 bytes random
- Key: 32 bytes from `ENCRYPTION_KEY` env var
- Versioned keys supported

---

## 5. MCP Command Validation

### Behavior
MCP connectors have an additional security layer: the `command` field in `connectionConfig` is validated against an allowlist of safe executables.

### Allowed Commands
```typescript
ALLOWED_COMMANDS = new Set([
  "npx", "node", "python", "python3", "uvx", "docker", "deno", "bun"
]);
```

### Validation Logic
1. Extract the `command` field from `connectionConfig`.
2. If the command contains `/` (a path), extract the basename.
3. Check if the basename is in `ALLOWED_COMMANDS`.
4. If not allowed, return 400 with error code `INVALID_COMMAND`.

### Enforcement Points
- Connector create (`POST /api/connectors`) -- when `connectorType === "mcp"`.
- Connector update (`PATCH /api/connectors/[id]`) -- when connector is MCP type and `connectionConfig` is being updated.
- MCP client instantiation (`MCPClient` constructor) -- throws if command not in allowlist.

### Source
The `ALLOWED_COMMANDS` set is defined in `ai-studio-core/packages/mcp-client/src/client.ts` and exported via `@ais/mcp-client`.

---

## 6. Connection Testing

### Behavior
Currently, only MCP connectors support automated connection testing. The test connects to the MCP server, discovers available tools, and updates the connector status.

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/connectors/[id]/test` | CONNECTORS:20 | Test MCP connection and discover tools |

### Guard
- Returns 400 (`INVALID_TYPE`) if the connector is not of type `mcp`.

### Test Flow
1. Load connector from DB (scoped by tenant).
2. Build `MCPServerConfig` from `connectionConfig`:
   - `transport`: `"stdio"` or `"sse"`
   - `command`: executable to run
   - `args`: array of arguments
   - `env`: decrypted environment variables
   - `url`: for SSE transport
3. Create `MCPClient` and call `connect()`.
   **Note:** `MCPClient.connect()` only implements the `stdio` transport. If `transport` is `"sse"`, it throws "SSE transport not yet supported". SSE is documented in the config schema but is NOT IMPLEMENTED at the client level.
4. On success:
   - Call `listTools()` to discover available tools.
   - Update connector status to `active`.
   - Store discovered tools in `connectionConfig.discoveredTools`.
   - Set `lastTestedAt`, clear `lastError`.
   - Disconnect the client.
5. On failure:
   - Update connector status to `error`.
   - Store error message in `lastError`.
   - Set `lastTestedAt`.
   - Attempt graceful disconnect.
6. Create audit entry with success/failure, latency, and tool count.

### Response Shape (success)
```json
{
  "success": true,
  "latencyMs": 2345,
  "tools": [
    { "name": "search_code", "description": "Search code in repositories" },
    { "name": "get_file_contents", "description": "Get file contents from a repo" }
  ]
}
```

### Response Shape (failure)
```json
{
  "success": false,
  "latencyMs": 5000,
  "error": "Connection timed out",
  "tools": []
}
```

### Discovered Tools Storage
On successful test, the full tool schemas are stored in `connectionConfig`:
```json
{
  "transport": "stdio",
  "command": "npx",
  "args": ["..."],
  "discoveredTools": [
    {
      "name": "search_code",
      "description": "Search code in repositories",
      "inputSchema": { "type": "object", "properties": { ... } }
    }
  ]
}
```

---

## 7. Agent-Connector Assignments

### Behavior
Connectors are linked to agents through the `agent_connectors` junction table. An agent can have multiple connectors; a connector can be shared across agents (within the same tenant).

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/agents/[id]/connectors` | AGENTS:10 | List assigned connectors with enriched info |
| POST | `/api/agents/[id]/connectors` | AGENTS:20 | Assign a connector to an agent |
| DELETE | `/api/agents/[id]/connectors/[acid]` | AGENTS:20 | Remove connector assignment |

### Request Shape (POST)
```json
{
  "connectorId": "uuid"
}
```

### Response Shape (GET)
```json
{
  "data": [
    {
      "id": "assignment-uuid",
      "connectorId": "connector-uuid",
      "connectorName": "GitHub MCP",
      "connectorType": "mcp",
      "status": "active"
    }
  ]
}
```

### Validation (Zod)
```typescript
assignConnectorSchema = z.object({
  connectorId: z.string().uuid(),
});
```

### DB Table: `agent_connectors`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | Cascade to `tenants.id` |
| agent_id | uuid FK | Cascade to `agents.id` |
| connector_id | uuid FK | Cascade to `connectors.id` |
| created_at | timestamptz | Auto |

**Constraints:** Unique on `(tenant_id, agent_id, connector_id)`.
**Indexes:** `idx_agent_connectors_agent(agent_id)`, `idx_agent_connectors_connector(connector_id)`.

### Security
- Uses AGENTS permission module (not CONNECTORS).
- Validates connector exists, is active, and belongs to the same tenant.
- Prevents duplicate assignments (returns 409 `ALREADY_ASSIGNED`).
- Deletion is a hard delete (not soft-delete) on the junction row.
- All operations audited.

---

## 8. Security Summary

| Concern | Implementation |
|---------|---------------|
| Tenant isolation | All queries scoped by `tenant_id` from JWT |
| RBAC | CONNECTORS:10 (read), CONNECTORS:20 (write); Agent endpoints use AGENTS module |
| Credentials at rest | AES-256-GCM encryption for `credentialsRef` and `connectionConfig.env` values |
| Credentials in transit | Masked as `"****"` in all API responses |
| MCP command injection | Allowlist validation: only `npx`, `node`, `python`, `python3`, `uvx`, `docker`, `deno`, `bun` |
| MCP env isolation | MCP client builds safe env from allowlisted system vars + encrypted config vars |
| Soft-delete | Connector deletion sets `is_active=false`, preserves data for audit trail |
| Audit logging | Every create, update, delete, and test operation creates an `audit_log` entry |

---

## Key Files Reference

| Purpose | Path |
|---------|------|
| Connector schema | `packages/database/src/schema/connectors.ts` |
| Agent-connector schema | `packages/database/src/schema/agent-connectors.ts` |
| Connector enums | `packages/database/src/schema/enums.ts` |
| Connector validation | `packages/validation/src/connectors.ts` |
| Assignment validation | `packages/validation/src/agents.ts` (`assignConnectorSchema`) |
| Connector API (list/create) | `web/src/app/api/connectors/route.ts` |
| Connector API (get/update/delete) | `web/src/app/api/connectors/[id]/route.ts` |
| Connector test API | `web/src/app/api/connectors/[id]/test/route.ts` |
| Agent-connector API (list/assign) | `web/src/app/api/agents/[id]/connectors/route.ts` |
| Agent-connector API (remove) | `web/src/app/api/agents/[id]/connectors/[acid]/route.ts` |
| Encryption | `packages/auth/src/encryption.ts` |
| MCP client | `ai-studio-core/packages/mcp-client/src/client.ts` |
| MCP client exports | `ai-studio-core/packages/mcp-client/src/index.ts` |
| UI page | `web/src/app/(platform)/connectors/page.tsx` |
