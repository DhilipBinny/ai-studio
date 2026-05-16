-- Migration 024: Projects (shared workspace) + Agent Tasks (sub-agent tracking)
-- Enables multi-agent collaboration on shared codebases

-- Projects table: shared workspace for multiple agents
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_tenant ON projects(tenant_id);
ALTER TABLE projects ADD CONSTRAINT uq_projects_tenant_name UNIQUE (tenant_id, name);

-- Agent tasks table: tracks sub-agent invocations
CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  parent_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  child_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  description TEXT,
  prompt TEXT,
  result TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_tenant ON agent_tasks(tenant_id);
CREATE INDEX idx_agent_tasks_parent ON agent_tasks(parent_session_id);
CREATE INDEX idx_agent_tasks_status ON agent_tasks(tenant_id, status);

-- Add project_id to agent_sessions for project workspace binding
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Add exec_timeout_ms to agents for per-agent timeout config
ALTER TABLE agents ADD COLUMN IF NOT EXISTS exec_timeout_ms INTEGER DEFAULT 30000;

-- Enable RLS on new tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_isolation ON projects
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY agent_tasks_tenant_isolation ON agent_tasks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
