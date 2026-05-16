-- Migration 022: Denormalize node_name/node_type into workflow_run_steps
-- This prevents step data loss when workflows are re-saved (delete-and-replace nodes)

ALTER TABLE workflow_run_steps
  ADD COLUMN node_name text,
  ADD COLUMN node_type text;

-- Drop the FK on workflow_node_id so node deletion doesn't cascade to steps
ALTER TABLE workflow_run_steps
  DROP CONSTRAINT IF EXISTS workflow_run_steps_workflow_node_id_fkey;
ALTER TABLE workflow_run_steps
  DROP CONSTRAINT IF EXISTS workflow_run_steps_workflow_node_id_workflow_nodes_id_fk;

-- Backfill existing steps from current node data (where nodes still exist)
UPDATE workflow_run_steps wrs
SET
  node_name = wn.name,
  node_type = wn.node_type
FROM workflow_nodes wn
WHERE wrs.workflow_node_id = wn.id
  AND wrs.node_name IS NULL;
