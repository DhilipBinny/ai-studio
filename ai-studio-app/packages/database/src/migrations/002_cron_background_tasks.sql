-- ============================================================================
-- Echol AI Studio — Migration 002: Cron Jobs + Background Tasks
-- Ported from KairoClaw (migrations 004, 012)
-- ============================================================================

CREATE TABLE cron_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL DEFAULT '',
  schedule_type   TEXT NOT NULL DEFAULT 'cron' CHECK (schedule_type IN ('cron', 'every', 'at')),
  schedule_value  TEXT NOT NULL,
  timezone        TEXT,
  prompt          TEXT NOT NULL,
  delivery        JSONB NOT NULL DEFAULT '{}',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_run        TIMESTAMPTZ,
  last_result     TEXT,
  run_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cron_jobs_tenant ON cron_jobs(tenant_id);
CREATE INDEX idx_cron_jobs_user ON cron_jobs(user_id);

COMMENT ON COLUMN cron_jobs.schedule_type IS 'cron = cron expression, every = interval ms, at = one-shot timestamp';
COMMENT ON COLUMN cron_jobs.delivery IS 'Delivery config: {"channel": "telegram", "chat_id": "123"} or {"agent_id": "uuid"}';

CREATE TABLE background_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  session_id      TEXT,
  scope_key       TEXT,
  task            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running', 'completed', 'error', 'killed', 'orphaned')),
  started_at      BIGINT NOT NULL,
  completed_at    BIGINT,
  result_text     TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bgt_tenant ON background_tasks(tenant_id);
CREATE INDEX idx_bgt_scope ON background_tasks(scope_key);
CREATE INDEX idx_bgt_status ON background_tasks(status);
CREATE INDEX idx_bgt_started ON background_tasks(started_at DESC);

COMMENT ON COLUMN background_tasks.started_at IS 'Milliseconds since epoch. Rows marked running on startup get marked orphaned.';

CREATE TRIGGER trg_cron_jobs_updated_at BEFORE UPDATE ON cron_jobs FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO schema_migrations (version, name) VALUES (2, 'cron_background_tasks');
