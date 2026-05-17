# 14. Infrastructure — Tech Stack, Database, Docker, Configuration

Platform infrastructure covering the tech stack, database setup, Docker configuration, ORM, Next.js config, health checks, instrumentation, and dev workflow.

---

## 14.1 Tech Stack Summary

| Layer          | Technology                               | Version/Notes                    |
|----------------|------------------------------------------|----------------------------------|
| **Frontend**   | Next.js + React                          | Next.js 16, React 19            |
| **UI Library** | shadcn/ui + Tailwind CSS                 | Tailwind v4                      |
| **Language**    | TypeScript                               | Strict mode                      |
| **Backend**    | Next.js API Routes                       | Node.js runtime                  |
| **Database**   | PostgreSQL + pgvector                    | PostgreSQL 17                    |
| **ORM**        | Drizzle ORM                              | PostgreSQL dialect               |
| **Auth**       | Custom JWT (jose) + Argon2id + OTP       |                                  |
| **Email**      | Nodemailer                               | SMTP                             |
| **AI/LLM**     | Anthropic SDK + OpenAI SDK               | Multi-provider                   |
| **Embeddings** | HuggingFace Transformers + ONNX Runtime  | Local inference                  |
| **Vector DB**  | PostgreSQL pgvector (default) or Qdrant  | Toggle via `VECTOR_DB=qdrant`    |
| **MCP**        | @modelcontextprotocol/sdk                | Tool execution protocol          |
| **Package Mgr**| pnpm                                     | Workspace monorepo               |
| **Bundler**    | Webpack (Turbopack disabled)             |                                  |

---

## 14.2 PostgreSQL 17 + pgvector

### Docker Image

`pgvector/pgvector:pg17` — PostgreSQL 17 with the pgvector extension for vector similarity search (used by RAG/knowledge bases).

### Default Credentials (Dev)

| Setting   | Value                    |
|-----------|--------------------------|
| User      | `aistudio`               |
| Password  | `aistudio_dev_2026`      |
| Database  | `aistudio`               |
| Host      | `localhost`              |
| Port      | `5480`                   |

### Connection String

```
postgresql://aistudio:aistudio_dev_2026@localhost:5480/aistudio
```

Configured via `DATABASE_URL` environment variable. Falls back to default in non-production.

---

## 14.3 Docker Compose Configuration

**File:** `ai-studio-app/infra/docker-compose.yml`

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: aistudio-postgres
    restart: unless-stopped
    ports:
      - "${POSTGRES_PORT:-5480}:5432"
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-aistudio}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-aistudio_dev_2026}
      POSTGRES_DB: ${POSTGRES_DB:-aistudio}
    volumes:
      - ../.data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER:-aistudio}"]
      interval: 10s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:v1.17.1
    container_name: aistudio-qdrant
    restart: unless-stopped
    ports:
      - "${QDRANT_PORT:-6333}:6333"
    volumes:
      - ../.data/qdrant:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
    mem_limit: 2g
```

**Key details:**
- Data persisted to `ai-studio-app/.data/postgres/` and `ai-studio-app/.data/qdrant/` (both gitignored).
- PostgreSQL port configurable via `POSTGRES_PORT` env (default 5480 to avoid conflict with system PostgreSQL).
- Qdrant port configurable via `QDRANT_PORT` env (default 6333).
- PostgreSQL health check: `pg_isready` every 10 seconds.
- Qdrant health check: `curl /healthz` every 10 seconds with 10-second start period.
- Qdrant memory limited to 2 GB.
- Environment variables loaded from `ai-studio-app/.env`.

### Qdrant Vector Database

**Toggle:** Set `VECTOR_DB=qdrant` in `.env` to use Qdrant for vector search. Without this, pgvector is used (default).

**Client:** `packages/agent-runtime/src/stores/qdrant-client.ts` — uses `@qdrant/js-client-rest`, singleton via `globalThis`. Configured by `QDRANT_URL` (default `http://localhost:6333`) and optional `QDRANT_API_KEY`.

**Collections:** Two collections are auto-initialized on startup (`ensureQdrantCollections()` called from `instrumentation.ts`):

| Collection | Purpose |
|------------|---------|
| `knowledge_chunks` | Document chunk embeddings for vector search |
| `graph_entities` | GraphRAG entity embeddings for graph expansion |

**Named Vectors:** Each collection supports five named vectors for different embedding dimensions:

| Vector Name | Dimension | Typical Provider |
|-------------|-----------|-----------------|
| `dim_384` | 384 | bge-small, all-MiniLM-L6 (built-in) |
| `dim_768` | 768 | bge-base, nomic-embed-text (Ollama) |
| `dim_1024` | 1024 | bge-large, Cohere embed-v3 |
| `dim_1536` | 1536 | text-embedding-ada-002, text-embedding-3-small (OpenAI) |
| `dim_3072` | 3072 | text-embedding-3-large (OpenAI) |

Named vectors allow a single collection to support KBs with different embedding providers/dimensions simultaneously.

**Payload Indexes:**
- `tenant_id` — keyword index with `is_tenant: true` for tenant isolation
- `knowledge_base_id` — keyword index for KB-scoped filtering
- `document_id` — keyword index for document-level operations (delete)

**HNSW Config:** `payload_m: 16`, `m: 0` (payload-indexed HNSW).

**Collection Initialization:** Idempotent — `ensureQdrantCollections()` checks `collectionExists()` before creating. Safe to call on every startup.

### Start Database

```bash
cd ai-studio-app/infra && docker compose --env-file ../.env up -d
```

---

## 14.4 Database Connection — globalThis Singleton

**File:** `packages/database/src/connection.ts`

### Pattern

Uses `globalThis` pattern to maintain a single database connection pool across Next.js hot reloads:

```typescript
const globalForDb = globalThis as unknown as {
  _db: ReturnType<typeof drizzle> | undefined;
  _sql: ReturnType<typeof postgres> | undefined;
};
```

### Functions

| Function               | Description                                     |
|------------------------|-------------------------------------------------|
| `getDb()`              | Returns Drizzle ORM instance (creates on first call) |
| `getSql()`             | Returns raw postgres.js client                  |
| `closeDb()`            | Closes the connection pool and clears `globalThis` references. Returns `Promise<void>`. |
| `getConnectionString()`| Returns `DATABASE_URL` env or default. In production (`NODE_ENV=production`), throws an error if `DATABASE_URL` is not set. |

### Exports

| Export     | Description                                             |
|------------|---------------------------------------------------------|
| `Database` | TypeScript type alias for the Drizzle ORM instance type |

### Connection Pool

- Driver: `postgres` (postgres.js)
- Pool size: `max: 10` connections
- Schema: All Drizzle schemas imported from `./schema/index`

---

## 14.5 Drizzle ORM

### Configuration

**File:** `packages/database/drizzle.config.ts`

```typescript
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || "postgres://..." },
});
```

### Schema Files

All schemas in `packages/database/src/schema/`:

| File                  | Tables                                             |
|-----------------------|----------------------------------------------------|
| `enums.ts`            | All PostgreSQL enums (15 total)                    |
| `tenants.ts`          | `tenants`                                          |
| `users.ts`            | `users`                                            |
| `profiles.ts`         | `profiles`                                         |
| `otp.ts`              | `otp`                                              |
| `password-reset.ts`   | `password_reset_requests`                          |
| `password-history.ts` | `password_history`                                 |
| `system-config.ts`    | `system_config`                                    |
| `audit-log.ts`        | `audit_log`                                        |
| `sessions.ts`         | `sessions` (refresh token sessions)                |
| `providers.ts`        | `providers`, `provider_models`                     |
| `tools.ts`            | `tools`, `tool_permissions`                        |
| `agents.ts`           | `agents`, `agent_tools`, `agent_knowledge_bases`   |
| `knowledge-bases.ts`  | `knowledge_bases`, `documents`, `document_chunks`, `rag_evaluations`, `graph_entities`, `graph_relationships` |
| `connectors.ts`       | `connectors`                                       |
| `agent-connectors.ts` | `agent_connectors`                                 |
| `agent-sessions.ts`   | `agent_sessions`, `agent_session_messages`, `agent_session_tool_calls` |
| `workflows.ts`        | `workflows`, `workflow_nodes`, `workflow_edges`, `workflow_runs`, `workflow_run_steps` |
| `usage-records.ts`    | `usage_records`                                    |
| `cron-jobs.ts`        | `cron_jobs`, `background_tasks`                    |
| `api-keys.ts`         | `api_keys`                                         |
| `progress-spans.ts`   | `progress_spans`                                   |
| `revoked-tokens.ts`   | `revoked_tokens`                                   |

### PostgreSQL Enums

| Enum Name                | Values                                                              |
|--------------------------|---------------------------------------------------------------------|
| `user_role`              | super_admin, admin, member, viewer                                  |
| `agent_status`           | draft, active, disabled, archived                                   |
| `tool_type`              | builtin, custom, mcp, api, code                                     |
| `tool_permission_level`  | allow, deny, confirm, power_user                                    |
| `document_status`        | uploaded, processing, ready, error                                  |
| `connector_type`         | database, rest_api, mcp, webhook, graphql                           |
| `connector_status`       | active, inactive, error, testing                                    |
| `workflow_status`        | draft, active, disabled, archived                                   |
| `workflow_node_type`     | agent, tool, llm, condition, loop, human_review, output, input, transform, delay, switch, iteration, sub_workflow, knowledge_search, http_request, code, aggregate |
| `run_status`             | pending, running, waiting, waiting_approval, completed, failed, cancelled, timeout |
| `run_step_status`        | pending, running, completed, failed, skipped, waiting_human, retrying |
| `message_role`           | user, assistant, system, tool                                        |
| `tool_call_status`       | pending, success, error, denied, timeout                             |
| `provider_type`          | anthropic, openai, ollama, azure_openai, google, custom, openai_compatible |
| `provider_status`        | active, inactive, error                                              |

### Migrations

**File:** `packages/database/src/migrate.ts`

Custom migration runner (not Drizzle Kit migrations):
1. Creates `schema_migrations` tracking table if not exists.
2. Reads `.sql` files from `packages/database/src/migrations/`, sorted by numeric prefix.
3. Applies each migration in order, records version number.
4. Skips already-applied migrations.

| Migration | Name                       | Description                                    |
|-----------|----------------------------|------------------------------------------------|
| 001       | initial_schema             | Core tables: tenants, users, profiles, etc.    |
| 002       | cron_background_tasks      | Cron jobs and background tasks                 |
| 003       | sessions                   | Refresh token sessions                         |
| 004       | openai_compatible_enum     | Add openai_compatible provider type            |
| 005       | drop_fallback_model        | Remove fallback model concept                  |
| 006       | agent_sessions_and_persona | Agent sessions, messages, tool calls, persona  |
| 007       | api_keys                   | External API keys                              |
| 008       | hybrid_rag                 | RAG tables: documents, chunks, embeddings      |
| 009       | rag_phase2                 | RAG enhancements                               |
| 010       | agent_connectors           | Agent-connector junction table                 |
| 011       | encrypt_secrets            | Encrypt existing plaintext secrets (TypeScript, **NOT auto-applied** by the SQL-based migration runner — must be run manually) |
| 012       | builtin_tools              | Built-in tool definitions                      |
| 013       | password_history_and_hnsw  | Password history + HNSW index                  |
| 014       | approval_flow              | Human approval workflow support                |
| 015       | cron_enhancements          | Cron job improvements                          |
| 016       | workflow_engine_v2         | Workflow engine v2 tables                      |
| 017       | progress_events            | Progress spans table                           |
| 018       | token_revocation           | Token revocation table                         |
| 019       | row_level_security         | RLS policies on all tables                     |
| 020       | unique_constraints         | Additional unique constraints                  |
| 021       | rag_overhaul              | RAG P0+P1+P2: new tables (rag_evaluations, graph_entities, graph_relationships), new columns on knowledge_bases (contextual_enrichment, query_expansion, query_decomposition, graph_extraction, modality_type) and document_chunks (contextual_description), RLS on 3 new tables |

### Tenant Scope Helper

**File:** `packages/database/src/tenant-scope.ts`

```typescript
withTenantScope(tenantId, async (db) => { /* queries scoped by RLS */ })
```

Wraps queries in a transaction with `SET LOCAL app.current_tenant_id` for RLS enforcement.

---

## 14.6 Next.js Configuration

**File:** `web/next.config.ts`

### Transpile Packages

Packages bundled by webpack (not treated as external):

| Package                | Purpose                     |
|------------------------|-----------------------------|
| `@ais-app/auth`        | Auth utilities              |
| `@ais-app/database`    | DB schemas + connection     |
| `@ais-app/email`       | Email templates             |
| `@ais-app/types`       | Shared types                |
| `@ais-app/validation`  | Zod schemas                 |
| `@ais/agent-core`      | Agent core logic            |
| `@ais/mcp-client`      | MCP client                  |
| `@ais/memory-engine`   | Memory engine               |
| `@ais/provider-bridge`  | Provider abstraction        |
| `@ais/rag-engine`      | RAG engine                  |
| `@ais/security`        | Input/output security       |
| `@ais/tool-platform`   | Tool platform               |
| `@ais/tools-common`    | Common tool utilities       |
| `@ais/types`           | Core types                  |

### Server External Packages

Packages that must run in Node.js (not bundled):

| Package                         | Reason                      |
|---------------------------------|-----------------------------|
| `@ais-app/agent-runtime`       | Native dependencies         |
| `@node-rs/argon2`              | Native addon (Argon2)       |
| `postgres`                     | Database driver              |
| `nodemailer`                   | SMTP client                  |
| `otplib`                       | OTP library                  |
| `@anthropic-ai/sdk`            | Anthropic API client         |
| `openai`                       | OpenAI API client            |
| `@huggingface/transformers`    | ML inference                 |
| `@modelcontextprotocol/sdk`    | MCP protocol                 |
| `onnxruntime-node`             | ONNX ML runtime              |

### Output File Tracing

`outputFileTracingRoot` is set in `next.config.ts` to the monorepo root, ensuring Next.js traces file dependencies correctly across workspace packages during production builds.

### Webpack Customization

`@node-rs/argon2` explicitly added to webpack externals for server builds (ensures native addon is not bundled).

### Turbopack

**Disabled.** Dev server must run with `NEXT_TURBOPACK=0` due to compatibility issues with native dependencies and the monorepo structure.

---

## 14.7 Health Check Endpoint

**File:** `web/src/app/api/health/route.ts`

### Public Mode (GET /api/health)

No authentication required.

```json
{
  "status": "healthy",
  "timestamp": "2026-05-15T10:30:00.000Z",
  "uptime": 3600
}
```

Status: `healthy`, `degraded`, or `unhealthy`. Returns 200 for healthy, 503 otherwise.

### Detail Mode (GET /api/health?detail=true)

Requires JWT authentication + admin or super_admin role.

```json
{
  "status": "healthy",
  "timestamp": "2026-05-15T10:30:00.000Z",
  "uptime": 3600,
  "version": "dev",
  "node": "v20.x.x",
  "checks": {
    "database": { "status": "healthy", "latencyMs": 3 },
    "memory": { "status": "healthy", "detail": "RSS 256MB (threshold 8192MB), Heap 128MB" }
  },
  "progressBus": {
    "activeTraces": 2,
    "totalSubscribers": 5,
    "totalSpansEmitted": 1250
  }
}
```

**Checks:**
- **Database:** `SELECT 1` with latency measurement. Unhealthy on failure.
- **Memory:** RSS vs configurable threshold (`HEALTH_MAX_RSS_MB`, default 8192MB). Degraded if exceeded.
- **ProgressBus:** Active traces, subscribers, total emitted spans from `progressBus.getStats()`.

---

## 14.8 Instrumentation — Startup Hooks

**File:** `web/src/instrumentation.ts`

Runs once at Next.js server startup (Node.js runtime only):

### Startup Tasks

| Task                       | Function                        | Behavior                             |
|----------------------------|---------------------------------|--------------------------------------|
| Cron Scheduler             | `startCronScheduler()`          | 60-second tick interval              |
| Progress Writer            | `startProgressWriter()`         | Global subscriber + 500ms flush      |
| Recovery Sweep             | `recoverStaleWorkflowRuns()`    | Immediate + every 2 minutes          |
| Token Revocation Cleanup   | `cleanupExpiredRevocations()`   | Every 1 hour                         |
| Qdrant Collection Init     | `ensureQdrantCollections()`     | Idempotent; creates `knowledge_chunks` + `graph_entities` collections if missing. Failure is caught and logged (non-fatal — PG vector search still works). |

### Recovery Sweep

**File:** `packages/agent-runtime/src/workflow/recovery.ts`

- Finds workflow run steps stuck in "running" with stale heartbeat (>90 seconds).
- Marks them as "failed" with "Execution interrupted" message.
- Also finds timed-out runs (past `timeoutAt`) and sets status to "timeout".
- Runs every 2 minutes and once at startup.

### Token Revocation Cleanup

Deletes rows from `revoked_tokens` where `expiresAt < now()`. Runs every hour.

### globalThis Guards

All intervals stored on `globalThis` to prevent duplicate timers across hot reloads:
- `__recoverySweepInterval`
- `__revocationCleanupInterval`
- `__progressBus` (in progress-bus.ts)
- `__progressBusCleanupInterval` (in progress-bus.ts)

---

## 14.9 Dev Workflow

### dev.sh Script

**File:** `web/dev.sh`

| Command   | Action                                          |
|-----------|--------------------------------------------------|
| `start`   | Kill port 3099, launch dev server in background  |
| `stop`    | Kill process on port 3099                        |
| `restart` | Stop + start                                     |
| `check`   | Run `tsc --noEmit` (type check only)            |
| `status`  | Check if server running + call /api/health       |

Dev server logs written to `/tmp/ais-dev.log`. Waits up to 30 seconds for health check to pass.

### Dev Server Command

```bash
NEXT_TURBOPACK=0 pnpm dev --port 3099
```

- Port: 3099 (avoids conflicts with common dev ports).
- Turbopack disabled via `NEXT_TURBOPACK=0` env.

### Build & Test

```bash
# Full build
cd ai-studio-app && pnpm -r build

# Tests
cd ai-studio-app && pnpm test

# Database start
cd ai-studio-app/infra && docker compose --env-file ../.env up -d
```

---

## 14.10 Environment Variables Reference

### Required (.env)

| Variable           | Description                                    | Example                            |
|--------------------|------------------------------------------------|------------------------------------|
| `DATABASE_URL`     | PostgreSQL connection string                   | `postgresql://aistudio:...@localhost:5480/aistudio` |
| `JWT_SECRET`       | JWT signing secret (min 32 chars)              | (random string)                    |
| `ENCRYPTION_KEY`   | AES-256 key for secrets (64 hex chars)         | `openssl rand -hex 32`             |

### PostgreSQL (Docker)

| Variable           | Default              |
|--------------------|----------------------|
| `POSTGRES_USER`    | `aistudio`           |
| `POSTGRES_PASSWORD`| `aistudio_dev_2026`  |
| `POSTGRES_DB`      | `aistudio`           |
| `POSTGRES_PORT`    | `5480`               |

### Optional

| Variable                  | Default        | Description                              |
|---------------------------|----------------|------------------------------------------|
| `DATA_ROOT`               | `.data`        | Workspace file storage root              |
| `APP_URL`                 | `http://localhost:3099` | Application base URL             |
| `ENCRYPTION_KEY_VERSION`  | `1`            | Active encryption key version            |
| `ENCRYPTION_KEY_V{n}`     | --             | Additional key versions for rotation     |
| `CORS_ALLOWED_ORIGINS`    | (none)         | Comma-separated allowed origins          |
| `HEALTH_MAX_RSS_MB`       | `8192`         | Memory threshold for health degradation  |
| `NODE_ENV`                | --             | `production` for secure cookies          |
| `NEXT_TURBOPACK`          | --             | Set to `0` to disable Turbopack         |
| `VECTOR_DB`               | (none)         | Set to `qdrant` to use Qdrant for vector search (default: pgvector) |
| `QDRANT_URL`              | `http://localhost:6333` | Qdrant server URL              |
| `QDRANT_API_KEY`          | (none)         | Optional Qdrant API key for authentication |
| `QDRANT_PORT`             | `6333`         | Docker host port for Qdrant              |

### SMTP (Email)

Required for OTP and password reset emails. Configured via standard Nodemailer environment variables.

---

## 14.11 Core API Routes (Auth & Models)

The following API routes are part of the core infrastructure and are not covered in domain-specific feature docs:

| Method | Path                  | Auth           | Description                                    |
|--------|-----------------------|----------------|------------------------------------------------|
| GET    | `/api/auth/me`        | JWT (withAuth) | Returns current user profile, role, access rights, and tenant info |
| POST   | `/api/auth/login`     | Public         | Email + password login, returns JWT tokens     |
| POST   | `/api/auth/logout`    | JWT (withAuth) | Revokes access token JTI, clears cookies       |
| POST   | `/api/auth/refresh`   | Refresh cookie | Rotates refresh token, issues new access token |
| GET    | `/api/models`         | JWT (withAuth) | Lists available LLM models across all active providers for the tenant |

---

## 14.12 Monorepo Package Structure

```
ai-studio-app/
├── web/                         # Next.js application
│   ├── src/
│   │   ├── app/                 # App Router pages + API routes
│   │   ├── components/          # UI components
│   │   ├── hooks/               # React hooks
│   │   └── lib/                 # Utilities, services
│   ├── .data/                   # Local file storage (gitignored)
│   ├── dev.sh                   # Dev helper script
│   ├── next.config.ts           # Next.js config
│   └── vitest.config.ts         # Test config
├── packages/
│   ├── auth/                    # Password, JWT, OTP, RBAC, encryption
│   ├── database/                # Drizzle schemas, migrations, connection
│   ├── email/                   # Email templates + sending
│   ├── types/                   # Shared TypeScript types
│   ├── validation/              # Zod validation schemas
│   └── agent-runtime/           # Session runner, workflows, cron, progress
├── infra/
│   └── docker-compose.yml       # PostgreSQL container
├── scripts/
│   └── generate-encryption-key.ts
└── .env.example                 # Template for environment variables

ai-studio-core/
├── packages/
│   ├── rag-engine/              # RAG pipeline: chunking, RRF, search, HyDE, query decomposition, graph, evaluation
│   ├── security/                # Input sanitization, prompt injection, output filtering
│   ├── provider-bridge/         # Multi-provider LLM abstraction
│   └── types/                   # Core shared types
```
