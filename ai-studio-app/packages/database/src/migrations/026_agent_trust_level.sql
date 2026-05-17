-- Add trust_level to agents for tool approval policy
ALTER TABLE agents ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'supervised';
