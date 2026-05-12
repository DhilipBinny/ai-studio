-- ============================================================================
-- Echol AI Studio — PostgreSQL 17 Initial Schema
-- Version: 1.0.0
-- Date: 2026-05-12
-- Requires: pgvector extension, pgcrypto extension
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'member', 'viewer');
CREATE TYPE agent_status AS ENUM ('draft', 'active', 'disabled', 'archived');
CREATE TYPE tool_type AS ENUM ('builtin', 'custom', 'mcp', 'api', 'code');
CREATE TYPE tool_permission_level AS ENUM ('allow', 'deny', 'confirm', 'power_user');
CREATE TYPE document_status AS ENUM ('uploaded', 'processing', 'ready', 'error');
CREATE TYPE connector_type AS ENUM ('database', 'rest_api', 'mcp', 'webhook', 'graphql');
CREATE TYPE connector_status AS ENUM ('active', 'inactive', 'error', 'testing');
CREATE TYPE workflow_status AS ENUM ('draft', 'active', 'disabled', 'archived');
CREATE TYPE workflow_node_type AS ENUM (
  'agent', 'tool', 'llm', 'condition', 'loop',
  'human_review', 'output', 'input', 'transform', 'delay'
);
CREATE TYPE run_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'cancelled', 'timeout'
);
CREATE TYPE run_step_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'skipped', 'waiting_human'
);
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'tool');
CREATE TYPE tool_call_status AS ENUM ('pending', 'success', 'error', 'denied', 'timeout');
CREATE TYPE provider_type AS ENUM ('anthropic', 'openai', 'ollama', 'azure_openai', 'google', 'custom');
CREATE TYPE provider_status AS ENUM ('active', 'inactive', 'error');

-- ============================================================================
-- GROUP 1: PLATFORM CORE
-- ============================================================================

-- 1.1 Tenants
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free',
  settings    JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN tenants.slug IS 'URL-safe unique identifier (e.g. "echol", "acme-corp")';
COMMENT ON COLUMN tenants.settings IS 'Tenant-level config: token limits, feature flags, branding overrides';

-- 1.2 Profiles (RBAC role definitions with access rights matrix)
CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  access_rights JSONB NOT NULL DEFAULT '{}',
  is_system     BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_profiles_tenant ON profiles(tenant_id);

COMMENT ON COLUMN profiles.access_rights IS 'Permission matrix. Keys: DASHBOARD, AGENTS, TOOLS, KNOWLEDGE, WORKFLOWS, CONNECTORS, RUNS, PROVIDERS, USERS, PROFILES, AUDIT, SETTINGS. Values: 0=none, 10=view, 20=full';
COMMENT ON COLUMN profiles.is_system IS 'System profiles cannot be deleted or have access_rights modified';

-- 1.3 Users
CREATE TABLE users (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id               UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email                    TEXT NOT NULL,
  name                     TEXT NOT NULL DEFAULT '',
  password_hash            TEXT NOT NULL,
  role                     user_role NOT NULL DEFAULT 'member',
  avatar_url               TEXT,
  settings                 JSONB NOT NULL DEFAULT '{}',
  is_locked                BOOLEAN NOT NULL DEFAULT false,
  failed_login_attempts    INTEGER NOT NULL DEFAULT 0,
  locked_at                TIMESTAMPTZ,
  last_login_at            TIMESTAMPTZ,
  password_changed_at      TIMESTAMPTZ,
  require_password_change  BOOLEAN NOT NULL DEFAULT false,
  otp_request_count        INTEGER NOT NULL DEFAULT 0,
  otp_blocked_until        TIMESTAMPTZ,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  deactivated_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_profile ON users(profile_id);

COMMENT ON COLUMN users.password_hash IS 'Argon2id hash. Never store plaintext.';
COMMENT ON COLUMN users.role IS 'Coarse role for quick checks. Fine-grained permissions from profile.access_rights.';
COMMENT ON COLUMN users.settings IS 'User preferences: theme, timezone, notification prefs';

-- 1.4 OTP (2FA)
CREATE TABLE otp (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  etus        TEXT NOT NULL UNIQUE,
  otp_code    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_user ON otp(user_id);
CREATE INDEX idx_otp_etus ON otp(etus);

COMMENT ON COLUMN otp.etus IS 'Echol Temporary Unique String — session token linking OTP to a login attempt';

-- 1.5 Password Reset Requests
CREATE TABLE password_reset_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pw_reset_user ON password_reset_requests(user_id);

COMMENT ON COLUMN password_reset_requests.token_hash IS 'SHA-256 hash of the reset token sent via email. Raw token never stored.';

-- 1.6 System Config (key-value per tenant)
CREATE TABLE system_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}',
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);

CREATE INDEX idx_system_config_tenant ON system_config(tenant_id);

COMMENT ON COLUMN system_config.key IS 'Config key: "auth", "general", "limits", "notifications"';

-- 1.7 Audit Log (tamper-evident hash chain)
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  ip_address    INET,
  user_agent    TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '',
  entry_hash    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_tenant_created ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);

COMMENT ON COLUMN audit_log.action IS 'Dot-namespaced: auth.login, user.create, agent.update, tool.execute, workflow.run';
COMMENT ON COLUMN audit_log.prev_hash IS 'SHA-256 of previous audit entry for this tenant. Empty for first entry.';
COMMENT ON COLUMN audit_log.entry_hash IS 'SHA-256 of (prev_hash + action + user_id + resource_type + resource_id + details + created_at)';

-- ============================================================================
-- GROUP 2: LLM PROVIDERS
-- ============================================================================

CREATE TABLE providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  provider_type   provider_type NOT NULL,
  base_url        TEXT,
  api_key_ref     TEXT,
  config          JSONB NOT NULL DEFAULT '{}',
  status          provider_status NOT NULL DEFAULT 'active',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_providers_tenant ON providers(tenant_id);
CREATE INDEX idx_providers_status ON providers(tenant_id, status);

COMMENT ON COLUMN providers.api_key_ref IS 'Reference to API key, NOT the key itself. Format: "env:ANTHROPIC_API_KEY" or "vault:provider/anthropic"';
COMMENT ON COLUMN providers.config IS 'Provider config: {"max_retries": 3, "timeout_ms": 30000, "rate_limit_rpm": 60}';

CREATE TABLE provider_models (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_id            UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id               TEXT NOT NULL,
  display_name           TEXT NOT NULL,
  capabilities           JSONB NOT NULL DEFAULT '[]',
  context_window         INTEGER,
  max_output_tokens      INTEGER,
  cost_per_input_token   NUMERIC(12, 10) DEFAULT 0,
  cost_per_output_token  NUMERIC(12, 10) DEFAULT 0,
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, provider_id, model_id)
);

CREATE INDEX idx_provider_models_tenant ON provider_models(tenant_id);
CREATE INDEX idx_provider_models_provider ON provider_models(provider_id);

COMMENT ON COLUMN provider_models.model_id IS 'Provider-specific ID: "claude-sonnet-4-20250514", "gpt-4o", "qwen2.5:7b"';
COMMENT ON COLUMN provider_models.capabilities IS 'Capability tags: ["chat", "tool_use", "vision", "streaming", "embeddings"]';
COMMENT ON COLUMN provider_models.cost_per_input_token IS 'USD per input token (e.g. 0.000003 for $3/M tokens)';

-- ============================================================================
-- GROUP 3: AGENT MANAGEMENT
-- ============================================================================

CREATE TABLE agents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL,
  description           TEXT DEFAULT '',
  system_prompt         TEXT NOT NULL DEFAULT '',
  rules                 JSONB NOT NULL DEFAULT '[]',
  model_config          JSONB NOT NULL DEFAULT '{}',
  provider_model_id     UUID REFERENCES provider_models(id) ON DELETE SET NULL,
  fallback_model_id     UUID REFERENCES provider_models(id) ON DELETE SET NULL,
  confidence_threshold  NUMERIC(3, 2) DEFAULT 0.85,
  max_turns             INTEGER DEFAULT 25,
  max_tokens_per_turn   INTEGER DEFAULT 4096,
  temperature           NUMERIC(3, 2) DEFAULT 0.7,
  status                agent_status NOT NULL DEFAULT 'draft',
  tags                  TEXT[] DEFAULT '{}',
  metadata              JSONB NOT NULL DEFAULT '{}',
  version               INTEGER NOT NULL DEFAULT 1,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  deactivated_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_agents_tenant ON agents(tenant_id);
CREATE INDEX idx_agents_status ON agents(tenant_id, status);
CREATE INDEX idx_agents_created_by ON agents(created_by);
CREATE INDEX idx_agents_tags ON agents USING GIN(tags);

COMMENT ON COLUMN agents.slug IS 'URL-safe identifier: "tk3-doc-reviewer", "mvms-anomaly-detector"';
COMMENT ON COLUMN agents.rules IS 'Behavioral rules: [{"rule": "Never auto-reject", "priority": 1}]';
COMMENT ON COLUMN agents.model_config IS 'Advanced: {"routing_tier": "balanced", "stop_sequences": [], "top_p": 0.9}';
COMMENT ON COLUMN agents.confidence_threshold IS 'Minimum confidence for autonomous action. Below this -> human review. Range 0.00-1.00';
COMMENT ON COLUMN agents.version IS 'Auto-incremented on update. Enables config versioning and rollback.';

-- ============================================================================
-- GROUP 4: TOOL REGISTRY
-- ============================================================================

CREATE TABLE tools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  tool_type         tool_type NOT NULL DEFAULT 'custom',
  category          TEXT DEFAULT 'general',
  parameters_schema JSONB NOT NULL DEFAULT '{}',
  returns_schema    JSONB DEFAULT '{}',
  config            JSONB NOT NULL DEFAULT '{}',
  version           INTEGER NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  deactivated_at    TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_tools_tenant ON tools(tenant_id);
CREATE INDEX idx_tools_type ON tools(tenant_id, tool_type);
CREATE INDEX idx_tools_category ON tools(tenant_id, category);

COMMENT ON COLUMN tools.name IS 'Machine name: "read_document", "query_tk3_db", "send_email"';
COMMENT ON COLUMN tools.parameters_schema IS 'JSON Schema for tool input. Used for LLM tool_use and validation.';
COMMENT ON COLUMN tools.config IS 'Type-dependent: API tools {"endpoint", "method", "headers"}, MCP {"server", "tool_name"}, Code {"runtime", "handler"}';

CREATE TABLE tool_permissions (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  tool_pattern  TEXT NOT NULL,
  permission    tool_permission_level NOT NULL DEFAULT 'allow',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tool_perms_tenant ON tool_permissions(tenant_id);
CREATE INDEX idx_tool_perms_lookup ON tool_permissions(tenant_id, role);

COMMENT ON COLUMN tool_permissions.tool_pattern IS 'Glob pattern: exact "read_document", prefix "mcp__*", wildcard "*". Most specific wins.';

-- ============================================================================
-- GROUP 5: AGENT ASSOCIATIONS
-- (agent_knowledge_bases defined after knowledge_bases in Group 6)
-- ============================================================================

CREATE TABLE agent_tools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id         UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  tool_config     JSONB NOT NULL DEFAULT '{}',
  is_required     BOOLEAN NOT NULL DEFAULT false,
  priority        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, agent_id, tool_id)
);

CREATE INDEX idx_agent_tools_agent ON agent_tools(agent_id);
CREATE INDEX idx_agent_tools_tool ON agent_tools(tool_id);

COMMENT ON COLUMN agent_tools.tool_config IS 'Per-agent overrides: {"timeout_ms": 5000, "max_retries": 2}. Merged with tools.config at runtime.';
COMMENT ON COLUMN agent_tools.priority IS 'Ordering hint. Lower = listed first in tool definitions.';

-- ============================================================================
-- GROUP 6: KNOWLEDGE / RAG
-- ============================================================================

CREATE TABLE knowledge_bases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT DEFAULT '',
  embedding_model     TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_dimension INTEGER NOT NULL DEFAULT 1536,
  chunk_config        JSONB NOT NULL DEFAULT '{}',
  document_count      INTEGER NOT NULL DEFAULT 0,
  chunk_count         INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  deactivated_at      TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_kb_tenant ON knowledge_bases(tenant_id);

COMMENT ON COLUMN knowledge_bases.chunk_config IS 'Chunking config: {"method": "recursive", "chunk_size": 1000, "chunk_overlap": 200}';

CREATE TABLE documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL,
  file_size_bytes   BIGINT NOT NULL DEFAULT 0,
  storage_path      TEXT NOT NULL,
  status            document_status NOT NULL DEFAULT 'uploaded',
  chunk_count       INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_tenant ON documents(tenant_id);
CREATE INDEX idx_documents_kb ON documents(knowledge_base_id);
CREATE INDEX idx_documents_status ON documents(knowledge_base_id, status);

COMMENT ON COLUMN documents.storage_path IS 'Relative path: "tenants/{tenant_id}/kb/{kb_id}/{uuid}.pdf"';

CREATE TABLE document_chunks (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  embedding     vector(1536),
  token_count   INTEGER NOT NULL DEFAULT 0,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunks_tenant ON document_chunks(tenant_id);
CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMENT ON COLUMN document_chunks.chunk_index IS 'Zero-based position within document for ordered reconstruction';
COMMENT ON COLUMN document_chunks.embedding IS 'Vector embedding. Dimension must match knowledge_bases.embedding_dimension.';

-- 6.5 Agent-Knowledge Base assignments (many-to-many, after knowledge_bases exists)
CREATE TABLE agent_knowledge_bases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  search_config     JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, agent_id, knowledge_base_id)
);

CREATE INDEX idx_agent_kb_agent ON agent_knowledge_bases(agent_id);
CREATE INDEX idx_agent_kb_kb ON agent_knowledge_bases(knowledge_base_id);

COMMENT ON COLUMN agent_knowledge_bases.search_config IS 'Per-agent search: {"top_k": 5, "similarity_threshold": 0.7, "rerank": true}';

-- ============================================================================
-- GROUP 7: CONNECTORS
-- ============================================================================

CREATE TABLE connectors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT '',
  connector_type    connector_type NOT NULL,
  connection_config JSONB NOT NULL DEFAULT '{}',
  credentials_ref   TEXT,
  health_check_url  TEXT,
  status            connector_status NOT NULL DEFAULT 'inactive',
  last_tested_at    TIMESTAMPTZ,
  last_error        TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  deactivated_at    TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_connectors_tenant ON connectors(tenant_id);
CREATE INDEX idx_connectors_type ON connectors(tenant_id, connector_type);

COMMENT ON COLUMN connectors.connection_config IS 'Type-dependent: database {"host","port","database","dialect"}, rest_api {"base_url","auth_type"}, mcp {"command","args","env"}';
COMMENT ON COLUMN connectors.credentials_ref IS 'Reference to credentials. Format: "env:TK3_DB_PASSWORD" or "vault:connector/tk3-mysql"';

-- ============================================================================
-- GROUP 8: WORKFLOWS
-- ============================================================================

CREATE TABLE workflows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  trigger_config  JSONB NOT NULL DEFAULT '{}',
  status          workflow_status NOT NULL DEFAULT 'draft',
  version         INTEGER NOT NULL DEFAULT 1,
  tags            TEXT[] DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  deactivated_at  TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX idx_workflows_tenant ON workflows(tenant_id);
CREATE INDEX idx_workflows_status ON workflows(tenant_id, status);

COMMENT ON COLUMN workflows.trigger_config IS '{"type": "manual"}, {"type": "webhook", "path": "/trigger/review"}, {"type": "schedule", "cron": "0 */6 * * *"}';

CREATE TABLE workflow_nodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_type     workflow_node_type NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  config        JSONB NOT NULL DEFAULT '{}',
  position_x    REAL NOT NULL DEFAULT 0,
  position_y    REAL NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_nodes_workflow ON workflow_nodes(workflow_id);

COMMENT ON COLUMN workflow_nodes.config IS 'Type-dependent: agent {"agent_id"}, tool {"tool_id","arguments"}, condition {"expression"}, human_review {"assignee_role","timeout_hours"}';

CREATE TABLE workflow_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  from_node_id    UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  to_node_id      UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  condition_label TEXT,
  condition_expr  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_edges_workflow ON workflow_edges(workflow_id);
CREATE INDEX idx_wf_edges_from ON workflow_edges(from_node_id);
CREATE INDEX idx_wf_edges_to ON workflow_edges(to_node_id);

COMMENT ON COLUMN workflow_edges.condition_expr IS 'Evaluatable expression: "result.status == ''approved''". NULL = unconditional (default path).';
COMMENT ON COLUMN workflow_edges.sort_order IS 'Evaluation order for multiple edges from same node. Lower = first.';

CREATE TABLE workflow_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_type  TEXT NOT NULL DEFAULT 'manual',
  trigger_data  JSONB NOT NULL DEFAULT '{}',
  status        run_status NOT NULL DEFAULT 'pending',
  input         JSONB NOT NULL DEFAULT '{}',
  output        JSONB,
  error_message TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  triggered_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_runs_tenant ON workflow_runs(tenant_id);
CREATE INDEX idx_wf_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_wf_runs_status ON workflow_runs(tenant_id, status);
CREATE INDEX idx_wf_runs_created ON workflow_runs(tenant_id, created_at DESC);

CREATE TABLE workflow_run_steps (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_run_id   UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_node_id  UUID NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
  status            run_step_status NOT NULL DEFAULT 'pending',
  input             JSONB NOT NULL DEFAULT '{}',
  output            JSONB,
  error_message     TEXT,
  duration_ms       INTEGER,
  attempt           INTEGER NOT NULL DEFAULT 1,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_run_steps_run ON workflow_run_steps(workflow_run_id);
CREATE INDEX idx_wf_run_steps_status ON workflow_run_steps(workflow_run_id, status);

-- ============================================================================
-- GROUP 9: AGENT EXECUTION
-- ============================================================================

CREATE TABLE agent_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id              UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  workflow_run_id       UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  trigger_type          TEXT NOT NULL DEFAULT 'manual',
  trigger_data          JSONB NOT NULL DEFAULT '{}',
  status                run_status NOT NULL DEFAULT 'pending',
  input                 JSONB NOT NULL DEFAULT '{}',
  output                JSONB,
  error_message         TEXT,
  total_input_tokens    INTEGER NOT NULL DEFAULT 0,
  total_output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd        NUMERIC(10, 6) NOT NULL DEFAULT 0,
  total_tool_calls      INTEGER NOT NULL DEFAULT 0,
  total_turns           INTEGER NOT NULL DEFAULT 0,
  model_used            TEXT,
  provider_used         TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  triggered_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_runs_tenant ON agent_runs(tenant_id);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_id);
CREATE INDEX idx_agent_runs_workflow ON agent_runs(workflow_run_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(tenant_id, status);
CREATE INDEX idx_agent_runs_created ON agent_runs(tenant_id, created_at DESC);

COMMENT ON COLUMN agent_runs.workflow_run_id IS 'Links to parent workflow run if triggered by workflow. NULL for standalone runs.';

CREATE TABLE agent_run_messages (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_run_id  UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  role          message_role NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  tool_calls    JSONB,
  tool_call_id  TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_arm_run ON agent_run_messages(agent_run_id);
CREATE INDEX idx_arm_tenant ON agent_run_messages(tenant_id);

CREATE TABLE agent_run_tool_calls (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_run_id    UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_id         UUID REFERENCES tools(id) ON DELETE SET NULL,
  tool_name       TEXT NOT NULL,
  arguments       JSONB NOT NULL DEFAULT '{}',
  result          TEXT,
  status          tool_call_status NOT NULL DEFAULT 'pending',
  duration_ms     INTEGER,
  error_message   TEXT,
  approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artc_run ON agent_run_tool_calls(agent_run_id);
CREATE INDEX idx_artc_tenant ON agent_run_tool_calls(tenant_id);
CREATE INDEX idx_artc_tool ON agent_run_tool_calls(tool_name);

-- ============================================================================
-- GROUP 10: USAGE & METRICS
-- ============================================================================

CREATE TABLE usage_records (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_id           UUID REFERENCES agents(id) ON DELETE SET NULL,
  agent_run_id       UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  provider_model_id  UUID REFERENCES provider_models(id) ON DELETE SET NULL,
  model              TEXT NOT NULL,
  provider           TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(10, 6) NOT NULL DEFAULT 0,
  request_type       TEXT DEFAULT 'chat',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_tenant ON usage_records(tenant_id);
CREATE INDEX idx_usage_tenant_date ON usage_records(tenant_id, created_at DESC);
CREATE INDEX idx_usage_agent ON usage_records(agent_id);
CREATE INDEX idx_usage_user ON usage_records(user_id);

COMMENT ON COLUMN usage_records.cache_read_tokens IS 'Tokens read from prompt cache (e.g. Anthropic). Typically cheaper.';
COMMENT ON COLUMN usage_records.request_type IS 'LLM request type: "chat", "embedding", "completion", "rerank"';

-- ============================================================================
-- GROUP 11: SCHEMA MIGRATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- AUTO-UPDATE TRIGGER: updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'updated_at'
      AND table_schema = 'public'
      AND table_name != 'schema_migrations'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Default tenant
INSERT INTO tenants (id, name, slug, plan) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Echol Technology', 'echol', 'enterprise');

-- Default profiles
INSERT INTO profiles (id, tenant_id, name, description, access_rights, is_system) VALUES
  ('00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000001',
   'Super Admin',
   'Full platform access',
   '{"DASHBOARD": 20, "AGENTS": 20, "TOOLS": 20, "KNOWLEDGE": 20, "WORKFLOWS": 20, "CONNECTORS": 20, "RUNS": 20, "PROVIDERS": 20, "USERS": 20, "PROFILES": 20, "AUDIT": 20, "SETTINGS": 20}',
   true),
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   'Admin',
   'Administrative access',
   '{"DASHBOARD": 20, "AGENTS": 20, "TOOLS": 20, "KNOWLEDGE": 20, "WORKFLOWS": 20, "CONNECTORS": 20, "RUNS": 20, "PROVIDERS": 20, "USERS": 20, "PROFILES": 10, "AUDIT": 10, "SETTINGS": 10}',
   true),
  ('00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000001',
   'Member',
   'Create and run agents, view results',
   '{"DASHBOARD": 10, "AGENTS": 20, "TOOLS": 10, "KNOWLEDGE": 20, "WORKFLOWS": 20, "CONNECTORS": 10, "RUNS": 20, "PROVIDERS": 10, "USERS": 0, "PROFILES": 0, "AUDIT": 0, "SETTINGS": 0}',
   false),
  ('00000000-0000-0000-0000-000000000013',
   '00000000-0000-0000-0000-000000000001',
   'Viewer',
   'Read-only access',
   '{"DASHBOARD": 10, "AGENTS": 10, "TOOLS": 10, "KNOWLEDGE": 10, "WORKFLOWS": 10, "CONNECTORS": 10, "RUNS": 10, "PROVIDERS": 10, "USERS": 0, "PROFILES": 0, "AUDIT": 0, "SETTINGS": 0}',
   false);

-- Default system config
INSERT INTO system_config (tenant_id, key, value) VALUES
  ('00000000-0000-0000-0000-000000000001', 'auth',
   '{"enable_2fa": false, "max_failed_attempts": 10, "otp_validity_seconds": 300, "otp_max_resend": 5, "otp_block_duration_minutes": 30}'),
  ('00000000-0000-0000-0000-000000000001', 'general',
   '{"app_name": "Echol AI Studio", "timezone": "Asia/Singapore"}'),
  ('00000000-0000-0000-0000-000000000001', 'limits',
   '{"default_max_tokens_per_turn": 4096, "default_max_turns": 25, "monthly_token_budget": null}');

-- Default tool permissions
INSERT INTO tool_permissions (tenant_id, role, tool_pattern, permission) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', '*', 'allow'),
  ('00000000-0000-0000-0000-000000000001', 'admin', '*', 'allow'),
  ('00000000-0000-0000-0000-000000000001', 'member', '*', 'allow'),
  ('00000000-0000-0000-0000-000000000001', 'member', 'exec_*', 'confirm'),
  ('00000000-0000-0000-0000-000000000001', 'member', 'delete_*', 'confirm'),
  ('00000000-0000-0000-0000-000000000001', 'viewer', '*', 'deny');

-- Record this migration
INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_schema');
