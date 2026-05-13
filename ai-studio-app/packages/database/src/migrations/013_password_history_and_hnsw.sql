-- Migration 013: Password history table + HNSW vector index

-- 1. Password history — stores last N hashes per user to prevent reuse
CREATE TABLE IF NOT EXISTS password_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pw_history_user ON password_history (user_id);
CREATE INDEX IF NOT EXISTS idx_pw_history_tenant ON password_history (tenant_id);

-- Seed existing password hashes into history so first change enforces reuse check
INSERT INTO password_history (tenant_id, user_id, password_hash, created_at)
SELECT tenant_id, id, password_hash, COALESCE(password_changed_at, created_at)
FROM users
WHERE password_hash IS NOT NULL AND is_active = true
ON CONFLICT DO NOTHING;

-- 2. HNSW vector index — replaces sequential scan for cosine similarity
-- Partial index per embedding dimension since column is untyped (supports 384, 768, 1536, etc.)
-- Casting to vector(N) enables HNSW on untyped columns via pgvector 0.8+
-- m=16: connections per layer (higher = better recall, more memory)
-- ef_construction=64: build-time quality (higher = better index, slower build)

-- 384-dim: bge-small-en-v1.5 (built-in, most common)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw_384
  ON document_chunks
  USING hnsw ((embedding::vector(384)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE vector_dims(embedding) = 384;

-- 1536-dim: OpenAI text-embedding-3-small / text-embedding-ada-002
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw_1536
  ON document_chunks
  USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE vector_dims(embedding) = 1536;
