-- Migration 009: RAG Phase 2 — Re-ranking config + Parent-child chunking
-- Date: 2026-05-13

-- 1. Add re-ranking configuration to knowledge_bases
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS rerank_source TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rerank_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rerank_model TEXT DEFAULT NULL;

ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_rerank_source CHECK (rerank_source IS NULL OR rerank_source IN ('builtin', 'provider'));

-- 2. Add parent-child chunking support to document_chunks
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS parent_chunk_id BIGINT REFERENCES document_chunks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_type TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE document_chunks
  ADD CONSTRAINT chk_chunk_type CHECK (chunk_type IN ('standard', 'child', 'parent'));

-- 3. Index for parent-child lookups
CREATE INDEX IF NOT EXISTS idx_chunks_parent ON document_chunks (parent_chunk_id) WHERE parent_chunk_id IS NOT NULL;

-- 4. Update existing chunks method from "recursive" to include "parent_child" option
-- (No data migration needed — existing chunks keep their method)

-- 5. Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (9, '009_rag_phase2', NOW())
ON CONFLICT (version) DO NOTHING;
