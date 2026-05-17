-- Migration 010: Agent-Connector junction table for MCP tool assignment
-- Date: 2026-05-13

CREATE TABLE IF NOT EXISTS agent_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, agent_id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_connectors_agent ON agent_connectors(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_connectors_connector ON agent_connectors(connector_id);

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (10, '010_agent_connectors', NOW())
ON CONFLICT (version) DO NOTHING;
