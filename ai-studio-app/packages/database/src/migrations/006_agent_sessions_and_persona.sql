-- Migration 006: Rename agent_runs → agent_sessions + add persona to agents
-- Aligns with session-based architecture (see _local_reference/14_agentic_core_design.md)

-- 1. Rename tables
ALTER TABLE agent_runs RENAME TO agent_sessions;
ALTER TABLE agent_run_messages RENAME TO agent_session_messages;
ALTER TABLE agent_run_tool_calls RENAME TO agent_session_tool_calls;

-- 2. Rename FK columns in child tables
ALTER TABLE agent_session_messages RENAME COLUMN agent_run_id TO agent_session_id;
ALTER TABLE agent_session_tool_calls RENAME COLUMN agent_run_id TO agent_session_id;

-- 3. Rename FK column in usage_records
ALTER TABLE usage_records RENAME COLUMN agent_run_id TO agent_session_id;

-- 4. Add session-specific columns
ALTER TABLE agent_sessions ADD COLUMN channel TEXT NOT NULL DEFAULT 'studio';
ALTER TABLE agent_sessions ADD COLUMN expires_at TIMESTAMPTZ;

-- 5. Add persona to agents
ALTER TABLE agents ADD COLUMN persona JSONB NOT NULL DEFAULT '{}';

-- 6. Rename indexes on agent_sessions
ALTER INDEX idx_agent_runs_tenant RENAME TO idx_agent_sessions_tenant;
ALTER INDEX idx_agent_runs_agent RENAME TO idx_agent_sessions_agent;
ALTER INDEX idx_agent_runs_status RENAME TO idx_agent_sessions_status;
ALTER INDEX idx_agent_runs_created RENAME TO idx_agent_sessions_created;

-- 7. Rename indexes on agent_session_messages
ALTER INDEX idx_arm_run RENAME TO idx_asm_session;
ALTER INDEX idx_arm_tenant RENAME TO idx_asm_tenant;

-- 8. Rename indexes on agent_session_tool_calls
ALTER INDEX idx_artc_run RENAME TO idx_astc_session;
ALTER INDEX idx_artc_tenant RENAME TO idx_astc_tenant;
ALTER INDEX idx_artc_tool RENAME TO idx_astc_tool;

-- 9. Add 'waiting' to run_status enum (for session waiting on user follow-up)
ALTER TYPE run_status ADD VALUE 'waiting' AFTER 'running';

-- 10. Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (6, '006_agent_sessions_and_persona', NOW());
