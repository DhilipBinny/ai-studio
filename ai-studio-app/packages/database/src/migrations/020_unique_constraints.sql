-- 020: Add unique constraints to prevent race conditions on slug/name uniqueness
-- Uses CREATE UNIQUE INDEX IF NOT EXISTS for idempotency

CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_slug_unique
  ON agents (tenant_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS workflows_tenant_name_unique
  ON workflows (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS connectors_tenant_name_unique
  ON connectors (tenant_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS tools_tenant_name_unique
  ON tools (tenant_id, name);
