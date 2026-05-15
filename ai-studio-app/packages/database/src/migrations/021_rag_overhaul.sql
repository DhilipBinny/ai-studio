-- 021: RAG Overhaul — P0 schema changes

-- New column on document_chunks for LLM-generated context descriptions
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS contextual_description TEXT DEFAULT NULL;

-- New columns on knowledge_bases for P0 config
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS contextual_enrichment TEXT NOT NULL DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS contextual_model TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS query_expansion TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS query_expansion_model TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS query_decomposition BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graph_extraction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graph_extraction_model TEXT DEFAULT NULL;

-- P2: Multimodal support
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS modality_type TEXT NOT NULL DEFAULT 'text';

-- RAG evaluation results table
CREATE TABLE IF NOT EXISTS rag_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id),
  run_at timestamptz NOT NULL DEFAULT now(),
  config jsonb NOT NULL DEFAULT '{}',
  questions jsonb NOT NULL DEFAULT '[]',
  results jsonb NOT NULL DEFAULT '[]',
  summary jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_evaluations_kb ON rag_evaluations (knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_rag_evaluations_tenant ON rag_evaluations (tenant_id);

-- P2: Graph tables for GraphRAG
CREATE TABLE IF NOT EXISTS graph_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_chunk_id bigint NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  name text NOT NULL,
  entity_type text NOT NULL,
  description text NOT NULL,
  embedding vector,
  mention_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graph_entities_kb ON graph_entities(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_graph_entities_tenant ON graph_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_entities_name ON graph_entities(knowledge_base_id, name);

CREATE TABLE IF NOT EXISTS graph_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_entity_id uuid NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  description text NOT NULL,
  weight real NOT NULL DEFAULT 1.0,
  source_chunk_id bigint NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graph_relationships_kb ON graph_relationships(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_graph_relationships_source ON graph_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_relationships_target ON graph_relationships(target_entity_id);
