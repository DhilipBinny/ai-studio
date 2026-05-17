-- Migration 023: Cron job run history + workflow input mapping

CREATE TABLE cron_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cron_job_id UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  trigger TEXT NOT NULL DEFAULT 'scheduled',
  result_text TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cron_job_runs_job ON cron_job_runs(cron_job_id);
CREATE INDEX idx_cron_job_runs_tenant ON cron_job_runs(tenant_id);
CREATE INDEX idx_cron_job_runs_created ON cron_job_runs(cron_job_id, created_at DESC);

ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS workflow_input JSONB NOT NULL DEFAULT '{}';
