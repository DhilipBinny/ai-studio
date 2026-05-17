-- Migration 016: Workflow Engine V2
-- Adds new node types, error handling, heartbeat, parallel execution support

-- 1. New node types
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'switch';
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'iteration';
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'sub_workflow';
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'knowledge_search';
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'http_request';
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'code';
ALTER TYPE workflow_node_type ADD VALUE IF NOT EXISTS 'aggregate';

-- 2. New step status
ALTER TYPE run_step_status ADD VALUE IF NOT EXISTS 'retrying';

-- 3. workflowRunSteps — heartbeat + retry tracking
ALTER TABLE workflow_run_steps
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_of BIGINT REFERENCES workflow_run_steps(id);

CREATE INDEX IF NOT EXISTS idx_wf_run_steps_heartbeat
  ON workflow_run_steps (status, last_heartbeat_at)
  WHERE status = 'running';

-- 4. workflowRuns — timeout, nesting, cost
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES workflow_runs(id),
  ADD COLUMN IF NOT EXISTS total_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_wf_runs_parent
  ON workflow_runs (parent_run_id)
  WHERE parent_run_id IS NOT NULL;

-- 5. workflowEdges — edge type for error/loop routing
ALTER TABLE workflow_edges
  ADD COLUMN IF NOT EXISTS edge_type TEXT NOT NULL DEFAULT 'normal';

-- 6. workflowNodes — per-node error policy
ALTER TABLE workflow_nodes
  ADD COLUMN IF NOT EXISTS error_policy JSONB NOT NULL DEFAULT '{"onError":"stop","maxRetries":0,"retryDelayMs":1000,"retryBackoff":"fixed","timeoutMs":0}';
