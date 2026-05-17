-- Agent persistent memory (cross-session knowledge)
CREATE TABLE IF NOT EXISTS agent_memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  embedding   vector,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, agent_id, key)
);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON agent_memories(agent_id, category);
