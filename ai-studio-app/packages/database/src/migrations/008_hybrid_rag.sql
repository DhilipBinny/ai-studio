-- Migration 008: Hybrid RAG — Provider-based embeddings + BM25 full-text search
-- Date: 2026-05-13

-- 1. Add embedding source columns to knowledge_bases
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS embedding_source TEXT NOT NULL DEFAULT 'builtin',
  ADD COLUMN IF NOT EXISTS embedding_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL;

ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_embedding_source CHECK (embedding_source IN ('builtin', 'provider'));

-- 2. Update defaults for new KBs (built-in model)
ALTER TABLE knowledge_bases ALTER COLUMN embedding_model SET DEFAULT 'Xenova/bge-small-en-v1.5';
ALTER TABLE knowledge_bases ALTER COLUMN embedding_dimension SET DEFAULT 384;

-- 3. Drop fixed-dimension IVFFlat index (enforces vector(1536), blocks other dimensions)
DROP INDEX IF EXISTS idx_chunks_embedding;

-- 4. Change vector column to untyped (supports any dimension)
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector USING embedding::vector;

-- 4. Add BM25 full-text search column
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 5. Index for BM25
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING gin(search_vector);

-- 6. Backfill search_vector for existing rows
UPDATE document_chunks SET search_vector = to_tsvector('english', content)
  WHERE search_vector IS NULL AND content IS NOT NULL;

-- 7. Trigger to auto-populate search_vector on insert/update
CREATE OR REPLACE FUNCTION update_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chunks_search_vector ON document_chunks;
CREATE TRIGGER trg_chunks_search_vector
  BEFORE INSERT OR UPDATE OF content ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- 8. Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (8, '008_hybrid_rag', NOW())
ON CONFLICT (version) DO NOTHING;
