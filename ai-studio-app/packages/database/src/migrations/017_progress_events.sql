-- 017: Progress spans for real-time agent observability
-- Stores execution spans (agent, llm, tool, workflow, node, approval) for audit and replay

CREATE TABLE IF NOT EXISTS progress_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trace_id UUID NOT NULL,
  parent_id UUID,
  seq INTEGER NOT NULL,
  span_kind VARCHAR(20) NOT NULL,
  phase VARCHAR(10) NOT NULL,
  name VARCHAR(255) NOT NULL,
  message TEXT,
  timestamp_ms BIGINT NOT NULL,
  duration_ms INTEGER,
  tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(12,6),
  args_preview TEXT,
  args_len INTEGER,
  result_preview TEXT,
  result_len INTEGER,
  agent_id UUID,
  agent_name VARCHAR(255),
  session_id UUID,
  node_id VARCHAR(100),
  model_id VARCHAR(100),
  tool_name VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_progress_spans_trace ON progress_spans(tenant_id, trace_id, seq);
CREATE INDEX idx_progress_spans_created ON progress_spans(created_at);
CREATE INDEX idx_progress_spans_parent ON progress_spans(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_progress_spans_session ON progress_spans(session_id) WHERE session_id IS NOT NULL;
