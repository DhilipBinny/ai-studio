-- Migration 014: Human approval flow for dangerous tool calls

-- Add waiting_approval to run_status enum
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'waiting_approval' AFTER 'waiting';

-- Add approval fields to agent_session_tool_calls
ALTER TABLE agent_session_tool_calls
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT NULL CHECK (approval_status IN ('approved', 'denied', NULL)),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ DEFAULT NULL;
