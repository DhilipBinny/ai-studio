-- Add heartbeat column for session liveness detection
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
