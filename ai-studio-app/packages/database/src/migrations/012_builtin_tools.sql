-- Migration 012: Built-in tools with risk levels
-- Adds risk_level column and seeds built-in tool definitions

-- Add risk_level column to tools table
ALTER TABLE tools ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'safe'
  CHECK (risk_level IN ('safe', 'moderate', 'dangerous'));

-- Create index for risk_level lookups
CREATE INDEX IF NOT EXISTS idx_tools_risk_level ON tools (tenant_id, risk_level);

-- Seed built-in tools for each tenant
-- Uses a CTE to insert tools for all existing tenants
INSERT INTO tools (tenant_id, name, display_name, description, tool_type, category, risk_level, parameters_schema, config)
SELECT
  t.id AS tenant_id,
  v.name,
  v.display_name,
  v.description,
  'builtin'::tool_type,
  v.category,
  v.risk_level,
  v.parameters_schema::jsonb,
  '{}'::jsonb
FROM tenants t
CROSS JOIN (VALUES
  -- Safe tools (auto-available to all agents)
  ('read_file', 'Read File', 'Read the contents of a file from the agent workspace.', 'file_operations', 'safe',
   '{"type":"object","properties":{"path":{"type":"string","description":"Path to the file to read"},"offset":{"type":"number","description":"Line number to start from (1-indexed)"},"limit":{"type":"number","description":"Max lines to read"}},"required":["path"]}'),

  ('list_directory', 'List Directory', 'List files and directories at a given path in the agent workspace.', 'file_operations', 'safe',
   '{"type":"object","properties":{"path":{"type":"string","description":"Directory path to list"}},"required":[]}'),

  ('glob', 'Glob Search', 'List files matching a glob pattern, sorted by modification time.', 'file_operations', 'safe',
   '{"type":"object","properties":{"pattern":{"type":"string","description":"Glob pattern"},"path":{"type":"string","description":"Directory to search from"},"head_limit":{"type":"number","description":"Max results (default 200)"}},"required":["pattern"]}'),

  ('grep', 'Grep Search', 'Search file contents with ripgrep. Fast, regex-capable, respects .gitignore.', 'search', 'safe',
   '{"type":"object","properties":{"pattern":{"type":"string","description":"Regex pattern"},"path":{"type":"string","description":"Search path"},"glob":{"type":"string","description":"Filename glob filter"},"output_mode":{"type":"string","enum":["content","files_with_matches","count"]},"case_insensitive":{"type":"boolean"},"context_lines":{"type":"number"},"head_limit":{"type":"number"}},"required":["pattern"]}'),

  ('web_fetch', 'Web Fetch', 'Fetch a URL and extract readable content as text.', 'web', 'safe',
   '{"type":"object","properties":{"url":{"type":"string","description":"URL to fetch"},"maxChars":{"type":"number","description":"Max characters to return"}},"required":["url"]}'),

  ('web_search', 'Web Search', 'Search the web using Brave Search API. Requires Brave API key.', 'web', 'safe',
   '{"type":"object","properties":{"query":{"type":"string","description":"Search query"},"count":{"type":"number","description":"Number of results (1-10)"}},"required":["query"]}'),

  ('read_pdf', 'Read PDF', 'Extract text content from a PDF file.', 'file_operations', 'safe',
   '{"type":"object","properties":{"path":{"type":"string","description":"Path to PDF file"},"pages":{"type":"string","description":"Page range (e.g. 1-5)"}},"required":["path"]}'),

  ('get_current_time', 'Get Current Time', 'Get the current date and time.', 'utility', 'safe',
   '{"type":"object","properties":{"timezone":{"type":"string","description":"Timezone (default: UTC)"}},"required":[]}'),

  ('calculate', 'Calculate', 'Evaluate a mathematical expression.', 'utility', 'safe',
   '{"type":"object","properties":{"expression":{"type":"string","description":"Math expression (e.g. 2+3*4)"}},"required":["expression"]}'),

  -- Moderate tools (admin assigns to agent)
  ('write_file', 'Write File', 'Write content to a file in the agent workspace.', 'file_operations', 'moderate',
   '{"type":"object","properties":{"path":{"type":"string","description":"Path to write"},"content":{"type":"string","description":"Content to write"}},"required":["path","content"]}'),

  ('edit_file', 'Edit File', 'Edit a file by replacing exact text.', 'file_operations', 'moderate',
   '{"type":"object","properties":{"path":{"type":"string","description":"Path to edit"},"old_string":{"type":"string","description":"Exact text to find"},"new_string":{"type":"string","description":"Replacement text"},"replace_all":{"type":"boolean","description":"Replace all occurrences"}},"required":["path","old_string","new_string"]}'),

  ('apply_patch', 'Apply Patch', 'Apply a unified diff (git patch) atomically.', 'file_operations', 'moderate',
   '{"type":"object","properties":{"patch":{"type":"string","description":"Unified diff text"},"dry_run":{"type":"boolean","description":"Validate only"}},"required":["patch"]}'),

  -- Dangerous tools (admin assigns + explicit approval)
  ('exec_command', 'Execute Command', 'Execute a shell command in the agent temp workspace.', 'execution', 'dangerous',
   '{"type":"object","properties":{"command":{"type":"string","description":"Shell command"},"timeout":{"type":"number","description":"Timeout in seconds (max 120)"}},"required":["command"]}'),

  ('batch_exec', 'Batch Execute', 'Run multiple shell commands in parallel.', 'execution', 'dangerous',
   '{"type":"object","properties":{"commands":{"type":"array","items":{"type":"string"},"description":"Commands to run (max 10)"},"timeout":{"type":"number","description":"Timeout per command"}},"required":["commands"]}')
) AS v(name, display_name, description, category, risk_level, parameters_schema)
ON CONFLICT (tenant_id, name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  risk_level = EXCLUDED.risk_level,
  parameters_schema = EXCLUDED.parameters_schema,
  tool_type = 'builtin'::tool_type,
  updated_at = NOW();
