-- Migration 015: Enhance cron_jobs for agent/workflow triggering

ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL;
ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs (tenant_id, enabled) WHERE enabled = true;
