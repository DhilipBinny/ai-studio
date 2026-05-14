-- 019: Row-Level Security for tenant isolation (defense-in-depth)
-- Phase 1: Create policies. RLS enabled but NOT forced on table owner.
-- Phase 2 (after service layer uses withTenantScope): ALTER TABLE ... FORCE ROW LEVEL SECURITY
-- Application-layer WHERE tenant_id = ? remains as belt-and-suspenders

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'agents', 'agent_tools', 'agent_connectors', 'agent_knowledge_bases',
      'agent_sessions', 'agent_session_messages', 'agent_session_tool_calls',
      'api_keys', 'audit_log', 'background_tasks',
      'connectors', 'cron_jobs',
      'document_chunks', 'documents',
      'knowledge_bases',
      'otp', 'password_history', 'password_reset_requests',
      'profiles', 'progress_spans', 'provider_models', 'providers',
      'sessions', 'system_config',
      'tool_permissions', 'tools',
      'usage_records', 'users',
      'workflow_edges', 'workflow_nodes', 'workflow_run_steps', 'workflow_runs', 'workflows'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON %I USING (tenant_id = current_tenant_id())',
      tbl, tbl
    );
  END LOOP;
END $$;

-- NOTE: RLS policies are created but NOT forced on the table owner yet.
-- The table owner (aistudio) bypasses RLS by default.
-- Once the service layer wraps all queries with withTenantScope (SET LOCAL),
-- run: ALTER TABLE <each_table> FORCE ROW LEVEL SECURITY;
-- This is intentional — enables incremental migration without breaking existing code.
