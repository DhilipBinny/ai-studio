# 07 - Knowledge Bases & RAG

Comprehensive documentation for the Knowledge Base system in Kairo Studio, covering document ingestion, chunking, embedding, hybrid search, re-ranking, RAGAS evaluation, 8 RAG enhancement strategies (contextual enrichment, HyDE, query decomposition, GraphRAG, late chunking, multimodal), and dual-store architecture (PostgreSQL + Qdrant).

---

## 0. Architecture Overview

### Pipeline Diagram

```
INGEST (write path)                          SEARCH (read path)
─────────────────                            ──────────────────

Upload file (multipart)                      User query (via agent tool or workflow node)
    │                                            │
    ▼                                            ▼
Store on disk                                knowledge-search.ts
{tenantId}/{kbId}/{fileId}{ext}                  │
    │                                            ├─ getAgentKBs() → first KB's embedding + rerank config
    ▼                                            ├─ createEmbedder() (builtin Xenova/bge or provider)
POST .../process                                 ├─ createReranker() (optional: builtin or provider)
    │                                            │
    ▼                                            ▼
pipeline.ts — processDocument()              search.ts — searchKnowledge()
    │                                            │
    ├─ TextExtractor.extract()                   ├─ embedSingle(query)
    │  (txt/md/csv → Buffer,                     │
    │   pdf → pdf-parse,                         ├─ Promise.all([
    │   docx → mammoth)                          │     vectorSearch(embedding, kbIds, topK*4, threshold)
    │                                            │     bm25Search(query, kbIds, topK*4)
    ├─ deleteChunks() (re-process safe)          │  ])
    │                                            │
    ├─ Chunk text:                               ├─ rrfFuse(vectorHits, bm25Hits)  // default k=60
    │  ├─ recursive: split by [\n\n,\n,". "," ",""] │
    │  ├─ fixed: exact char boundaries           ├─ reranker.rerank(query, top topK*3 docs)
    │  └─ parent_child:                          │  (re-scores by cross-encoder relevance)
    │     parent(2048) → child(512)              │
    │     only children get embeddings           ├─ Take final topK results
    │                                            │
    ├─ Embedder.embed(chunkTexts)                ├─ Parent chunk expansion:
    │  (builtin: Xenova/bge-small q8 → 384d     │  if child has parentChunkId → fetch parent content
    │   provider: OpenAI /v1/embeddings)         │
    │                                            ▼
    ├─ insertChunks() in batches of 50           Return SearchResult[]:
    │  (document_chunks table + pgvector)          { content, score, documentName, knowledgeBaseName,
    │                                                chunkIndex, source: "vector"|"bm25"|"hybrid" }
    ├─ updateDocumentStatus("ready")
    └─ updateKBChunkCount()
```

### Dual Search Model: Why Hybrid

Vector search (cosine similarity via pgvector) captures semantic meaning but misses exact keywords. BM25 full-text search (PostgreSQL `tsvector`/`tsquery`) catches keyword matches but misses paraphrased concepts. Running both in parallel and fusing with Reciprocal Rank Fusion (RRF) combines their strengths:

- **RRF formula:** `score = 1/(k + vector_rank) + 1/(k + bm25_rank)` where `k=60`
- The constant `k=60` dampens rank dominance — a result at rank 1 scores 1/61, at rank 2 scores 1/62. This prevents a single retriever from overwhelming the other.
- Results appearing in both lists get scores from both terms (hybrid), giving them a natural boost.
- After RRF fusion, an optional re-ranker (cross-encoder model) re-scores the top `topK * 3` candidates for final ordering.

### Embedding Architecture

| Mode | Model | Dimension | When Used |
|------|-------|-----------|-----------|
| Built-in | `Xenova/bge-small-en-v1.5` (HuggingFace Transformers, q8) | 384 | Default for new KBs; no API key needed; singleton pipeline |
| Provider-based | Any OpenAI-compatible `/v1/embeddings` endpoint | Configurable (1-4096) | When KB's `embeddingSource = "provider"`; API key decrypted at runtime |

Anthropic does not support embeddings — an explicit error is thrown if selected. Ollama and OpenAI-compatible providers work through the OpenAI embeddings API. Provider-based embedding batches in groups of 100 texts.

### Dual-Store Architecture (PostgreSQL + Qdrant)

The platform supports two vector storage backends, selectable via `VECTOR_DB` environment variable:

| Store | When | Vectors | BM25 / Full-Text | Graph Traversal |
|-------|------|---------|-------------------|-----------------|
| **PostgreSQL (pgvector)** | `VECTOR_DB` not set (default) | `embedding` column on `document_chunks` | `search_vector` tsvector | SQL joins on `graph_entities`/`graph_relationships` |
| **Qdrant** | `VECTOR_DB=qdrant` | Qdrant `knowledge_chunks` collection | PostgreSQL (unchanged) | Entity embeddings in Qdrant `graph_entities` collection; relationship traversal in PostgreSQL |

Both modes use PostgreSQL as the source of truth for text content, BM25 search, document metadata, and relational data. Qdrant stores only embeddings and minimal payload for filtering -- the write path is dual-write (PG first, then Qdrant), and the read path dispatches vector search to Qdrant while BM25 and parent chunk expansion stay on PostgreSQL.

### Storage Model

```
documents                          document_chunks
─────────                          ───────────────
id (uuid PK)                       id (bigserial PK)
knowledge_base_id (FK)             document_id (FK → documents)
file_name, file_type               chunk_index (position in doc)
storage_path                       content (text)
status (uploaded→processing→ready) embedding (pgvector, nullable for parent chunks)
chunk_count                        chunk_type: "standard" | "child" | "parent"
                                   parent_chunk_id (nullable, FK → self for child→parent)
                                   search_vector (tsvector, auto-populated by PG trigger)
                                   token_count (estimated: ceil(chars/4))
                                   contextual_description (text, nullable — LLM-generated)
                                   metadata { fileName, fileType, chunkSize }
```

**Parent-child chunking:** Large parent chunks (default 2048 chars) are split into smaller child chunks (default 512 chars). Only children receive embeddings and are searchable. When a child matches at search time, the parent's full content is fetched and returned — providing broader context around the matched passage.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Batch insert at 50 chunks | Balances between single-row inserts (too many round trips for large documents) and giant single inserts (memory pressure, transaction size). 50 is a pragmatic sweet spot for pgvector rows with 384-dimensional embeddings. |
| RRF `k = 60` | Standard value from the RRF literature. Lower k values make the fuser more sensitive to rank position; 60 provides balanced weighting where neither retriever dominates. |
| Parent chunk expansion after reranking | Re-ranking scores individual chunks by relevance. Expanding to parent content *after* scoring prevents the reranker from evaluating overly long texts — it scores the precise child match, then the caller gets the full context. |
| First KB's config used for multi-KB search | When an agent has multiple KBs, using consistent embedding and reranking settings for a single query avoids mixing incompatible vector spaces. The first KB's config is an arbitrary but deterministic choice. |
| Separate `search_vector` populated by PG trigger | The tsvector column is auto-maintained by a PostgreSQL trigger (`trg_chunks_search_vector`) on INSERT/UPDATE. Excluding it from the Drizzle schema avoids insert conflicts while ensuring BM25 search is always available. |
| `retrieveCount = topK * 4` | Over-fetching candidates (4x the desired final count) from each retriever gives RRF and reranking enough material to find the best results. The final topK is cut after fusion and reranking. |

---

### Package Map

The RAG pipeline spans three packages:

| Layer | Package | Responsibility |
|-------|---------|---------------|
| Core engine | `ai-studio-core/packages/rag-engine/` | Chunking, RRF fusion, search orchestration, pipeline, contextual enrichment, HyDE, query decomposition, merge, graph extraction/search, late chunking, multimodal, RAGAS evaluation |
| Application glue | `ai-studio-app/web/src/lib/rag/` | Text extraction, embedder/reranker/LLM-caller adapters, processor entrypoint |
| Runtime search | `ai-studio-app/packages/agent-runtime/` | `searchKnowledge()`, dual-store (Drizzle + Qdrant) for vectors, BM25, graph |
| API routes | `ai-studio-app/web/src/app/api/knowledge-bases/` | REST endpoints for CRUD, upload, process, evaluate |

---

## 1. Knowledge Base CRUD

### Behavior
- Each knowledge base belongs to a tenant and has a unique name within that tenant.
- A KB stores configuration for embedding (source, provider, model, dimension), re-ranking (source, provider, model), and chunking (method, sizes, overlap).
- Deletion is soft-delete (`is_active = false`, `deactivated_at` set).
- GET detail enriches the response with a live document count.

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/knowledge-bases` | KNOWLEDGE:10 (read) | List KBs with pagination |
| POST | `/api/knowledge-bases` | KNOWLEDGE:20 (write) | Create a new KB |
| GET | `/api/knowledge-bases/[id]` | KNOWLEDGE:10 | Get KB detail + live doc count |
| PATCH | `/api/knowledge-bases/[id]` | KNOWLEDGE:20 | Update name, description, rerank config, chunk config |
| DELETE | `/api/knowledge-bases/[id]` | KNOWLEDGE:20 | Soft-delete KB |

### Request / Response Shapes

**POST /api/knowledge-bases** (create)
```json
{
  "name": "Product Docs",
  "description": "Product documentation for support agents",
  "embeddingSource": "builtin" | "provider",
  "embeddingProviderId": "uuid (when source=provider)",
  "embeddingModel": "Xenova/bge-small-en-v1.5",
  "embeddingDimension": 384,
  "rerankSource": "builtin" | "provider" | null,
  "rerankProviderId": "uuid | null",
  "rerankModel": "Xenova/ms-marco-MiniLM-L-6-v2 | null",
  "chunkConfig": {
    "method": "recursive" | "fixed" | "parent_child",
    "chunk_size": 2048,
    "chunk_overlap": 200,
    "parent_chunk_size": 2048,
    "child_chunk_size": 512
  }
}
```

**PATCH /api/knowledge-bases/[id]** (update -- partial)
```json
{
  "name": "Updated Name",
  "description": "Updated desc",
  "rerankSource": "builtin",
  "chunkConfig": { "method": "parent_child", "parent_chunk_size": 4000 }
}
```

### Validation (Zod)

| Schema | File |
|--------|------|
| `createKnowledgeBaseSchema` | `packages/validation/src/knowledge-bases.ts` |
| `updateKnowledgeBaseSchema` | `packages/validation/src/knowledge-bases.ts` |

Key constraints:
- `name`: 1-255 chars, unique per tenant
- `embeddingSource`: `"builtin"` or `"provider"`
- `embeddingDimension`: 1-4096
- `chunkConfig.method`: `"recursive"`, `"fixed"`, `"parent_child"`
- `chunk_size`: 100-8000
- `chunk_overlap`: 0-2000
- `parent_chunk_size`: 500-16000
- `child_chunk_size`: 100-4000

### DB Table: `knowledge_bases`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | References `tenants.id`, cascade delete |
| name | text | NOT NULL, unique per tenant |
| description | text | Default `""` |
| embedding_source | text | `"builtin"` or `"provider"`, default `"builtin"` |
| embedding_provider_id | uuid FK | Nullable, references `providers.id` |
| embedding_model | text | Default `"Xenova/bge-small-en-v1.5"` |
| embedding_dimension | int | Default `384` |
| rerank_source | text | Nullable (`"builtin"`, `"provider"`) |
| rerank_provider_id | uuid FK | Nullable, references `providers.id` |
| rerank_model | text | Nullable |
| chunk_config | jsonb | Default `{}` |
| contextual_enrichment | text | `"none"`, `"static"` (default), `"llm"` |
| contextual_model | text | Nullable — LLM model for enrichment when mode is `"llm"` |
| query_expansion | text | `"none"` (default) or `"hyde"` |
| query_expansion_model | text | Nullable — LLM model for HyDE expansion |
| query_decomposition | boolean | Default `false` — enable query decomposition |
| graph_extraction | boolean | Default `false` — enable GraphRAG entity extraction |
| graph_extraction_model | text | Nullable — LLM model for entity extraction |
| modality_type | text | `"text"` (default) — multimodal type flag |
| document_count | int | Maintained on upload/delete |
| chunk_count | int | Updated after processing |
| is_active | boolean | Soft-delete flag |
| deactivated_at | timestamptz | Set on soft-delete |
| created_by | uuid FK | References `users.id` |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Indexes:** `idx_kb_tenant(tenant_id)`, unique constraint on `(tenant_id, name)`.

### Security
- All queries scoped by `tenant_id` from JWT.
- RBAC: read requires KNOWLEDGE:10, write requires KNOWLEDGE:20.
- Every mutating operation creates an `audit_log` entry.

### UI Page
- Route: `/(platform)/knowledge`
- List page with pagination, shows KB name, document count, chunk count, embedding model, created date.

---

## 2. Document Upload & Management

### Behavior
- Files are uploaded via multipart form data to a specific KB.
- Files are stored on disk at `{cwd}/../.data/uploads/{tenantId}/{kbId}/{fileId}{ext}`.
- Status lifecycle: `uploaded` -> `processing` -> `ready` | `error`.
- Deletion hard-deletes the document row, all its chunks, and the file on disk.
- After upload/delete, the KB `document_count` is recalculated.

### Supported File Types

| Extension | MIME Type |
|-----------|----------|
| `.txt` | `text/plain` |
| `.md` | `text/markdown` |
| `.pdf` | `application/pdf` |
| `.csv` | `text/csv` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

**Max file size:** 50 MB

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/knowledge-bases/[id]/documents` | KNOWLEDGE:10 | List documents (paginated, max 50/page) |
| POST | `/api/knowledge-bases/[id]/documents` | KNOWLEDGE:20 | Upload a file (multipart/form-data) |
| GET | `/api/knowledge-bases/[id]/documents/[docId]` | KNOWLEDGE:10 | Get single document detail |
| DELETE | `/api/knowledge-bases/[id]/documents/[docId]` | KNOWLEDGE:20 | Delete document, chunks, and file |

### DB Table: `documents`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | Cascade |
| knowledge_base_id | uuid FK | Cascade |
| file_name | text | Original filename |
| file_type | text | Extension without dot (e.g. `"pdf"`) |
| file_size_bytes | bigint | File size in bytes |
| storage_path | text | Relative path under uploads dir |
| status | enum | `uploaded`, `processing`, `ready`, `error` |
| chunk_count | int | Updated after processing |
| error_message | text | Nullable, set on processing error |
| metadata | jsonb | Default `{}` |
| uploaded_by | uuid FK | References `users.id` |
| processed_at | timestamptz | Set when status becomes `ready` |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

**Indexes:** `idx_documents_tenant(tenant_id)`, `idx_documents_kb(knowledge_base_id)`, `idx_documents_status(knowledge_base_id, status)`.

### Security
- Upload path is per-tenant, per-KB: `{tenantId}/{kbId}/{fileId}{ext}`.
- Extension validated against allowlist before write.
- File size checked before write (50 MB limit).
- All operations scoped by tenant_id.

---

## 3. Text Extraction

### Behavior
Text extraction converts uploaded files to plain text for chunking.

| File Type | Method | Library |
|-----------|--------|---------|
| `.txt`, `.md`, `.csv` | UTF-8 decode | Built-in `Buffer.toString` |
| `.pdf` | PDF parse | `pdf-parse` (PDFParse class) |
| `.docx` | Raw text extraction | `mammoth` |

### Implementation
- File: `ai-studio-app/web/src/lib/rag/text-extractor.ts`
- Reads from disk at `{UPLOAD_BASE}/{storagePath}`.
- Implements the `TextExtractor` interface from `@ais/rag-engine`.

---

## 4. Chunking Strategies

### Behavior
Three chunking methods are supported. All are implemented in `ai-studio-core/packages/rag-engine/src/chunker.ts`.

### 4.1 Recursive Splitting (default)

- **Method:** `"recursive"`
- Splits text using a 5-level separator hierarchy: `["\n\n", "\n", ". ", " ", ""]` (the empty string `""` acts as a char-level fallback)
- Tries the broadest separator first; if a segment exceeds `chunk_size`, recurses with the next finer separator.
- Merges small segments with overlap to maintain context.
- **Defaults:** chunk_size=2048, chunk_overlap=200.

### 4.2 Fixed Splitting

- **Method:** `"fixed"`
- Splits text at exact character boundaries (`chunk_size` intervals).
- Merges with overlap.
- Simpler but less semantically aware.

### 4.3 Parent-Child Chunking

- **Method:** `"parent_child"`
- Creates large **parent** chunks (default 2048 chars) and then subdivides each into smaller **child** chunks (default 512 chars).
- Child chunks get embeddings; parent chunks do not.
- At search time, when a child chunk matches, the full parent chunk content is returned -- providing broader context.
- **Defaults:** parent_chunk_size=2048, child_chunk_size=512, overlap=100.

### Contextual Chunking
All standard (non-parent-child) chunks are prefixed with document context:
```
[Document: filename.pdf | Section: heading] chunk content...
```
or just `[Document: filename.pdf]` if no section heading is detected.

### Token Estimation
- Token count is estimated as `ceil(text.length / 4)`.
- Minimum chunk length: 10 characters (shorter chunks are filtered out).

### Configuration (ChunkConfig)

| Field | Type | Default | Range |
|-------|------|---------|-------|
| method | string | `"recursive"` | `recursive`, `fixed`, `parent_child` |
| chunk_size | int | 2048 | 100-8000 |
| chunk_overlap | int | 200 | 0-2000 |
| parent_chunk_size | int | 2048 | 500-16000 |
| child_chunk_size | int | 512 | 100-4000 |

---

## 5. Embedding Generation

### Behavior
Two embedding sources are supported:

### 5.1 Built-in Embedding
- **Model:** `Xenova/bge-small-en-v1.5` (via `@huggingface/transformers`)
- **Dimension:** 384
- **Quantization:** q8
- **Pooling:** mean, normalized
- Singleton pipeline (lazily initialized, reused across requests).
- No API key required.

### 5.2 Provider-based Embedding
- Uses the OpenAI embeddings API (`/v1/embeddings`).
- Supported providers: OpenAI, Ollama, any OpenAI-compatible.
- Anthropic does NOT support embeddings (explicit error thrown).
- Batched in groups of 100 texts.
- API key is decrypted from the KB's linked provider using `decryptSecret()`.

### Implementation Chain
1. `buildEmbeddingConfig()` in `web/src/lib/rag/embedder.ts` reads KB + provider settings.
2. `createEmbedder()` returns an `Embedder` interface object.
3. Provider-level embedding is delegated to `embedText()` in `ai-studio-core/packages/provider-bridge/src/embedding.ts`.

### EmbeddingConfig Shape
```typescript
{
  source: "builtin" | "provider",
  model: string,
  dimension: number,
  providerType?: string,   // only for provider
  apiKey?: string,          // decrypted
  baseUrl?: string,         // only for provider
}
```

---

## 6. Document Processing Pipeline

### Trigger
- **API:** `POST /api/knowledge-bases/[id]/documents/[docId]/process` (KNOWLEDGE:20)
- Processing runs asynchronously (fire-and-forget with error logging).
- Guards against double-processing: returns 409 if status is `"processing"`.
- Audit entry created for the trigger event.

### Pipeline Steps (rag-engine `processDocument`)

1. Set document status to `processing`.
2. Extract text using `TextExtractor.extract()`.
3. Validate extracted text is non-empty.
4. Delete any existing chunks for the document (allows re-processing).
5. Chunk the text:
   - **parent_child method:** Creates parent + child chunks. Only child chunks get embeddings.
   - **recursive/fixed method:** Creates contextual chunks with document prefix.
6. Generate embeddings for applicable chunks via `Embedder.embed()`.
7. Insert chunks into `document_chunks` table in batches of 50.
8. Update document status to `ready` with chunk count and `processed_at` timestamp.
9. Update the KB's total `chunk_count`.
10. On error: set document status to `error` with error message.

### DB Table: `document_chunks`

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial PK | Auto-increment |
| tenant_id | uuid FK | Cascade |
| document_id | uuid FK | Cascade to `documents.id` |
| chunk_index | int | Position within document |
| content | text | Chunk text |
| embedding | vector | pgvector column, nullable (null for parent chunks) |
| chunk_type | text | `"standard"`, `"child"`, `"parent"` |
| parent_chunk_id | bigint | Nullable, references parent chunk id |
| token_count | int | Estimated token count |
| contextual_description | text | Nullable — LLM-generated context description (enrichment mode `"llm"`) |
| metadata | jsonb | `{ fileName, fileType, chunkSize }` |
| created_at | timestamptz | Auto |

**Indexes:** `idx_chunks_document(document_id)`, `idx_chunks_tenant(tenant_id)`.

**Note:** A PostgreSQL trigger (`trg_chunks_search_vector`) auto-populates a `search_vector` tsvector column from `content` on INSERT/UPDATE. This column is intentionally excluded from the Drizzle schema to avoid insert conflicts.

---

## 7. Vector Storage (pgvector)

### Implementation
- pgvector extension enabled in PostgreSQL 17.
- Custom Drizzle type defined in `packages/database/src/schema/knowledge-bases.ts` for the `vector` column.
- Vectors stored as text format `[0.1,0.2,...]` and parsed back to `number[]`.
- Cosine distance operator `<=>` used for similarity search.
- Similarity = `1 - cosine_distance`.

### Vector Search Query (DrizzleSearchStore)
```sql
SELECT dc.id, dc.content, dc.chunk_index, dc.chunk_type, dc.parent_chunk_id,
       d.file_name, d.knowledge_base_id,
       1 - (dc.embedding <=> $embedding::vector) AS similarity
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.tenant_id = $tenantId
  AND d.knowledge_base_id IN ($kbIds)
  AND d.status = 'ready'
  AND dc.embedding IS NOT NULL
  AND dc.chunk_type != 'parent'      -- skip parent chunks (no embedding)
  AND 1 - (dc.embedding <=> $embedding::vector) > $threshold
ORDER BY dc.embedding <=> $embedding::vector
LIMIT $limit
```

---

## 8. Hybrid Search (Vector + Full-Text)

### Behavior
Search executes two parallel retrieval strategies and fuses results:

1. **Vector search** (cosine similarity via pgvector) -- semantic matching.
2. **BM25 search** (PostgreSQL tsvector/tsquery) -- keyword matching.

Both run concurrently via `Promise.all()`.

**Multi-KB search note:** When an agent has multiple knowledge bases assigned, the search uses the FIRST KB's embedding and reranking configuration for all queries. This means all KBs searched in a single request share the same embedder and reranker settings, regardless of their individual configurations.

**Embedding config resolution at search time:** When initiating a search, the system fetches the first KB's full embedding config including `rerankProviderId`, `providerType`, `apiKeyRef`, and `baseUrl` from the linked provider. This resolved config is used to create both the embedder and reranker instances for the search operation.

### BM25 Search Query (DrizzleSearchStore)
- Query terms are joined with `|` (OR) for `to_tsquery('english', ...)`.
- Terms shorter than 2 characters are filtered out.
- Non-word characters are stripped.
- Searches the `search_vector` tsvector column.

```sql
SELECT dc.id, dc.content, dc.chunk_index, ...,
       ts_rank(dc.search_vector, to_tsquery('english', $tsQuery)) AS bm25_score
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.tenant_id = $tenantId
  AND d.knowledge_base_id IN ($kbIds)
  AND d.status = 'ready'
  AND dc.search_vector IS NOT NULL
  AND dc.chunk_type != 'parent'
  AND dc.search_vector @@ to_tsquery('english', $tsQuery)
ORDER BY ts_rank(...) DESC
LIMIT $limit
```

### Search Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| topK | 5 | Final number of results returned |
| similarityThreshold | 0.3 | Minimum cosine similarity for vector results |
| retrieveCount | topK * 4 | Number of candidates fetched from each source |

---

## 9. Reciprocal Rank Fusion (RRF)

### Behavior
After both vector and BM25 results are retrieved, they are fused using Reciprocal Rank Fusion.

### Algorithm (`rrfFuse` in `rag-engine/src/rrf.ts`)

For each unique result across both lists:
```
RRF_score = 1/(k + vector_rank) + 1/(k + bm25_rank)
```

- **k = 60** (default constant to prevent rank dominance).
- If a result only appears in one list, the missing rank contributes 0.
- Results are sorted by descending `rrfScore`.

### Output Shape
```typescript
{
  id: number,
  content: string,
  rrfScore: number,
  vectorRank: number | null,    // position in vector results (1-based)
  bm25Rank: number | null,      // position in BM25 results (1-based)
  metadata: { fileName, kbId, chunkIndex, chunkType, parentChunkId }
}
```

### Source Classification
Each final result is classified:
- `"vector"` -- appeared only in vector search
- `"bm25"` -- appeared only in full-text search
- `"hybrid"` -- appeared in both

---

## 10. Re-ranking

### Behavior
After RRF fusion, an optional re-ranking step re-orders the top candidates using a cross-encoder model.

### 10.1 Built-in Re-ranking
- **Model:** `Xenova/ms-marco-MiniLM-L-6-v2` (via `@huggingface/transformers`)
- Loads `AutoTokenizer` + `AutoModelForSequenceClassification`.
- Scores each `(query, document)` pair individually.
- Singleton model (lazily initialized).

### 10.2 Provider-based Re-ranking
- Calls a `/v1/rerank` endpoint (e.g., Cohere, Voyage).
- Sends `{ model, query, documents, top_n }` as JSON POST.
- Authorization via Bearer token.
- Default model: `rerank-v3.5`.

### Re-ranking Flow
1. Take top `topK * 3` candidates from RRF fusion.
2. Send document texts to re-ranker.
3. Re-ranker returns `{ index, score }` sorted by relevance.
4. Replace RRF scores with re-ranker scores.
5. Take final `topK` results.

### Parent Chunk Expansion
After re-ranking, if any final result has a `parentChunkId`, the parent chunk content is fetched and returned instead of the child chunk content -- providing broader context.

---

## 11. RAG Evaluation (RAGAS-style LLM-as-Judge)

### Behavior
Evaluates retrieval and generation quality using LLM-as-judge scoring across four RAGAS metrics. The evaluator retrieves chunks, generates an answer from context, then scores precision, recall, faithfulness, and relevancy. Requires the KB to be assigned to an agent with an LLM provider configured.

**File:** `ai-studio-core/packages/rag-engine/src/evaluator.ts`

### API Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/knowledge-bases/[id]/evaluate` | KNOWLEDGE:20 | Run RAGAS evaluation |

The evaluate endpoint uses Zod validation on the request body, creates an audit log entry, and scopes all lookups (KB, agent-KB assignment, provider) by `tenantId` from JWT.

### Request Shape
```json
{
  "agentId": "uuid",
  "questions": [
    {
      "question": "What is the return policy?",
      "groundTruth": "Items can be returned within 30 days..." // optional
    }
  ]
}
```

### Evaluation Pipeline

For each question (processed with bounded concurrency of 3):

1. **Retrieve** — Run `searchKnowledge()` with `topK=5` using the agent's KB configuration.
2. **Generate** — Use the LLM to generate an answer from the combined retrieved context (`generateAnswerPrompt`).
3. **Score** — Evaluate all four metrics in parallel:
   - **Context Precision** — LLM judges each retrieved chunk as relevant or not; score = `relevant_chunks / total_chunks`.
   - **Context Recall** — LLM breaks the ground truth into claims, checks each against retrieved context; score = `supported_claims / total_claims`. Only computed when `groundTruth` is provided; otherwise `null`.
   - **Faithfulness** — LLM extracts claims from the generated answer, checks each is supported by the context; score = `supported_claims / total_claims`.
   - **Answer Relevancy** — LLM generates 3 reverse questions from the answer, then embeds them alongside the original question. Score = average cosine similarity between original and generated question embeddings.

### Response Shape
```json
{
  "results": [
    {
      "question": "What is the return policy?",
      "retrievedChunks": ["chunk text 1", "chunk text 2"],
      "generatedAnswer": "Items can be returned within 30 days...",
      "scores": {
        "contextPrecision": 0.80,
        "contextRecall": 0.75,
        "faithfulness": 0.90,
        "answerRelevancy": 0.85
      }
    }
  ],
  "summary": {
    "avgContextPrecision": 0.80,
    "avgContextRecall": 0.75,
    "avgFaithfulness": 0.90,
    "avgAnswerRelevancy": 0.85,
    "totalQuestions": 5
  }
}
```

### Metrics

| Metric | Description | Range |
|--------|-------------|-------|
| contextPrecision | Fraction of retrieved chunks relevant to the question (LLM-judged) | 0-1 |
| contextRecall | Fraction of ground-truth claims covered by retrieved context (requires `groundTruth`) | 0-1 or null |
| faithfulness | Fraction of generated answer claims supported by the context | 0-1 |
| answerRelevancy | Cosine similarity between original question and LLM-generated reverse questions | 0-1 |

### Evaluation Storage

Results are persisted in the `rag_evaluations` table (migration 021):

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | References `tenants.id` |
| knowledge_base_id | uuid FK | References `knowledge_bases.id` |
| run_at | timestamptz | Default `now()` |
| config | jsonb | Evaluation config (model, parameters) |
| questions | jsonb | Input questions array |
| results | jsonb | Per-question evaluation results |
| summary | jsonb | Aggregate summary metrics |
| created_by | uuid FK | References `users.id` |
| created_at | timestamptz | Auto |

**Indexes:** `idx_rag_evaluations_kb(knowledge_base_id)`, `idx_rag_evaluations_tenant(tenant_id)`.
**RLS:** Tenant isolation policy enabled and forced.

### Error Handling

All metric functions catch LLM failures and return `0` as the score. JSON parsing uses `safeParseJSON` which strips markdown code fences and retries extraction. Parse failures default to `0`.

---

## 12. RAG Enhancement Strategies

Eight pluggable enhancement strategies, each toggled per-KB via configuration columns on `knowledge_bases`. All LLM-dependent strategies share a common `LLMCaller` interface (`call(prompt, options) → string`) and fail gracefully to the original input on any error.

### 12.1 Contextual Enrichment (Ingest-Time)

**File:** `ai-studio-core/packages/rag-engine/src/contextual-enrichment.ts`
**KB Config:** `contextual_enrichment` (`"none"`, `"static"`, `"llm"`), `contextual_model`

Enriches chunk text before embedding with contextual descriptions that situate the chunk within its document.

| Mode | Behavior |
|------|----------|
| `none` | Original chunk text, no description |
| `static` | Prepends `[Document: fileName \| Section: heading]` prefix (default) |
| `llm` | Calls an LLM per chunk with the full document context (truncated to 8000 chars) to generate a 1-2 sentence description. Description is prepended to chunk text and stored in `contextual_description` column. |

**LLM mode details:**
- System message contains the full document in `<document>` tags (sent once per document, enables prompt caching).
- Each chunk is sent as a user message in `<chunk>` tags.
- `maxTokens: 150`, `temperature: 0.0`.
- Concurrency: configurable, default 5 chunks in parallel.
- On failure: falls back to original chunk text with null description.

### 12.2 HyDE Query Expansion (Search-Time)

**File:** `ai-studio-core/packages/rag-engine/src/hyde.ts`
**KB Config:** `query_expansion = "hyde"`, `query_expansion_model`

HyDE (Hypothetical Document Embeddings) generates a hypothetical answer to the query before embedding, producing a vector that is semantically closer to actual document chunks than the raw query.

**Flow:**
1. LLM generates a detailed paragraph answering the question as if writing documentation.
2. The hypothetical answer is embedded (instead of the raw query) for vector search.
3. BM25 keyword search still uses the original raw query.

**Parameters:** `maxTokens: 300`, `temperature: 0.0`.
**Fallback:** On LLM failure or empty response, returns the original query.

### 12.3 Query Decomposition (Search-Time)

**File:** `ai-studio-core/packages/rag-engine/src/query-decomposition.ts`
**KB Config:** `query_decomposition = true`

Breaks complex multi-topic queries into up to 3 simpler sub-queries for independent retrieval.

**Flow:**
1. LLM analyzes the query to decide if decomposition is needed.
2. If yes, returns up to 3 self-contained sub-queries.
3. Each sub-query is searched independently.
4. Results are merged using the merge strategy (see 12.4).

**Fallback:** On LLM failure, invalid JSON, or empty response, returns the original query as a single-item array.

**LLM output format:**
```json
{
  "shouldDecompose": true,
  "subQueries": ["sub-query 1", "sub-query 2"],
  "reasoning": "This query asks about two topics..."
}
```

### 12.4 Merge Decomposed Results (Search-Time)

**File:** `ai-studio-core/packages/rag-engine/src/merge-results.ts`

After query decomposition, each sub-query produces its own RRF result set. This module merges them:

1. **Union** all results; keep the highest `rrfScore` per chunk ID.
2. **Boost** chunks appearing in N sub-query results: `score *= (1 + 0.1 * (N - 1))`. A chunk found by 3 sub-queries gets a 20% boost.
3. **Sort** by descending `rrfScore`.

### 12.5 GraphRAG Entity Extraction (Ingest-Time)

**File:** `ai-studio-core/packages/rag-engine/src/graph-extraction.ts`
**KB Config:** `graph_extraction = true`, `graph_extraction_model`

At indexing time, for each chunk, an LLM extracts named entities (concepts, APIs, tools, people, features) and relationships between them. These are stored in the `graph_entities` and `graph_relationships` tables.

**Entity extraction:**
- Input: chunk text + document name
- Output: `entities[]` (name, type, description) + `relationships[]` (source, target, type, description)
- `maxTokens: 1000`, `temperature: 0.0`
- JSON parsing handles markdown code fences and malformed responses

**Database tables (migration 021):**

**`graph_entities`:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | CASCADE to tenants |
| knowledge_base_id | uuid FK | CASCADE to knowledge_bases |
| source_chunk_id | bigint FK | CASCADE to document_chunks |
| name | text | Entity name |
| entity_type | text | concept, feature, API, tool, etc. |
| description | text | Entity description |
| embedding | vector | Entity name/description embedding |
| mention_count | integer | Default 1 |
| created_at | timestamptz | Auto |

**`graph_relationships`:**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | CASCADE to tenants |
| knowledge_base_id | uuid FK | CASCADE to knowledge_bases |
| source_entity_id | uuid FK | CASCADE to graph_entities |
| target_entity_id | uuid FK | CASCADE to graph_entities |
| relationship_type | text | e.g. `integrates_with`, `part_of` |
| description | text | Relationship description |
| weight | real | Default 1.0 |
| source_chunk_id | bigint FK | CASCADE to document_chunks |
| created_at | timestamptz | Auto |

**Indexes:** `idx_graph_entities_kb`, `idx_graph_entities_tenant`, `idx_graph_entities_name(kb_id, name)`, `idx_graph_relationships_kb`, `idx_graph_relationships_source`, `idx_graph_relationships_target`.
**RLS:** Tenant isolation policies enabled and forced on both tables.

### 12.6 GraphRAG Query Expansion (Search-Time)

**File:** `ai-studio-core/packages/rag-engine/src/graph-search.ts`

At search time, expands the result set by traversing the entity graph:

1. **Embed** the query.
2. **Find entities** whose embedding is similar to the query (cosine threshold 0.5, limit 10).
3. **Traverse** 1-hop relationships to find connected entities.
4. **Collect** unique chunk IDs from matched + connected entities.
5. **Fetch** chunk content from PostgreSQL.
6. **Return** with a base score of 0.01 (low) -- RRF will boost these if they are also found by vector/BM25 search.

The `GraphSearchStore` interface abstracts over PostgreSQL-only (DrizzleGraphStore) and hybrid (QdrantGraphStore) implementations. Both scope all queries by `tenantId`.

### 12.7 Late Chunking (Ingest-Time)

**File:** `ai-studio-core/packages/rag-engine/src/late-chunking.ts`

An embed-then-split strategy: instead of chunking first and embedding each chunk independently, the full document is embedded first (so every token has full-document attention), then chunk boundaries are mapped to the per-token embedding output and mean-pooled into chunk-level vectors.

**Requirements:** Embedding model with long context window (>= 4096 tokens) that supports per-token embedding output (e.g., Jina v3 API).

**Flow:**
1. Embed the full document text via `LateChunkEmbedder.embedWithTokens()` to get per-token embeddings and character boundaries.
2. Determine chunk boundaries using standard recursive splitting.
3. For each chunk, map character offsets to token indices (binary search), extract the token embeddings for that range, and mean-pool into a single chunk embedding.

**Long document handling:** Documents exceeding 30,000 characters are split into sections at paragraph boundaries (with 500-char overlap), each section is late-chunked independently, and duplicate chunks from overlap regions are deduplicated.

### 12.8 Multimodal RAG — VLM Page Descriptions (Ingest-Time)

**File:** `ai-studio-core/packages/rag-engine/src/multimodal.ts`
**KB Config:** `modality_type` (`"text"` default)

Uses a vision-language model (VLM) to generate text descriptions of document page images, enabling search over visual content like diagrams, charts, tables, and screenshots.

**Flow:**
1. Page images are rendered from the document.
2. Each page image is sent to a VLM (Claude Sonnet, GPT-4V, etc.) with a prompt requesting thorough description of all text, diagrams, charts, tables, code, and layout.
3. The VLM description is parsed to detect visual element types (18 patterns: diagram, chart, table, graph, flowchart, screenshot, code snippet, formula, architecture, schema, wireframe, map, timeline, infographic, etc.).
4. Results include page number, description text, image path, and detected visual element types.

**Parameters:** Concurrency default 3 pages in parallel. Errors on individual pages are caught and logged -- failed pages are skipped.

**Interface:** Application layer provides a `VLMCaller` implementation wrapping the configured provider.

### KB Config Toggle Summary

| Config Column | Type | Default | Strategy | Phase |
|---------------|------|---------|----------|-------|
| `contextual_enrichment` | text | `"static"` | Contextual Enrichment | Ingest |
| `contextual_model` | text | null | LLM model for enrichment | Ingest |
| `query_expansion` | text | `"none"` | HyDE Query Expansion | Search |
| `query_expansion_model` | text | null | LLM model for HyDE | Search |
| `query_decomposition` | boolean | false | Query Decomposition | Search |
| `graph_extraction` | boolean | false | GraphRAG Entity Extraction | Ingest |
| `graph_extraction_model` | text | null | LLM model for graph extraction | Ingest |
| `modality_type` | text | `"text"` | Multimodal RAG | Ingest |

---

## 13. Agent-KB Assignment

### Behavior
Knowledge bases are linked to agents through the `agent_knowledge_bases` junction table. An agent can have multiple KBs; a KB can be shared across agents (within the same tenant).

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/agents/[id]/knowledge-bases` | AGENTS:10 | List assigned KBs with enriched info |
| POST | `/api/agents/[id]/knowledge-bases` | AGENTS:20 | Assign a KB to an agent |
| DELETE | `/api/agents/[id]/knowledge-bases/[akbId]` | AGENTS:20 | Remove KB assignment |

### Request Shape (POST)
```json
{
  "knowledgeBaseId": "uuid",
  "searchConfig": {
    "top_k": 5,
    "similarity_threshold": 0.3
  }
}
```

### DB Table: `agent_knowledge_bases`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK | Cascade |
| agent_id | uuid FK | Cascade to `agents.id` |
| knowledge_base_id | uuid FK | Cascade to `knowledge_bases.id` |
| search_config | jsonb | Per-agent search parameters |
| created_at | timestamptz | Auto |

**Constraints:** Unique on `(tenant_id, agent_id, knowledge_base_id)`.
**Indexes:** `idx_agent_kb_agent(agent_id)`, `idx_agent_kb_kb(knowledge_base_id)`.

### Security
- Uses AGENTS permission module (not KNOWLEDGE).
- Validates KB exists, is active, and belongs to the same tenant.
- Prevents duplicate assignments (returns 409).

---

## Key Files Reference

| Purpose | Path |
|---------|------|
| KB schema | `packages/database/src/schema/knowledge-bases.ts` |
| KB validation | `packages/validation/src/knowledge-bases.ts` |
| KB API (list/create) | `web/src/app/api/knowledge-bases/route.ts` |
| KB API (get/update/delete) | `web/src/app/api/knowledge-bases/[id]/route.ts` |
| Document API (list/upload) | `web/src/app/api/knowledge-bases/[id]/documents/route.ts` |
| Document API (get/delete) | `web/src/app/api/knowledge-bases/[id]/documents/[docId]/route.ts` |
| Process trigger | `web/src/app/api/knowledge-bases/[id]/documents/[docId]/process/route.ts` |
| Evaluate API | `web/src/app/api/knowledge-bases/[id]/evaluate/route.ts` |
| Agent-KB API | `web/src/app/api/agents/[id]/knowledge-bases/route.ts` |
| Text extractor | `web/src/lib/rag/text-extractor.ts` |
| Embedder adapter | `web/src/lib/rag/embedder.ts` |
| Reranker adapter | `web/src/lib/rag/reranker.ts` |
| Processor (app) | `web/src/lib/rag/processor.ts` |
| Chunker (core) | `ai-studio-core/packages/rag-engine/src/chunker.ts` |
| RRF (core) | `ai-studio-core/packages/rag-engine/src/rrf.ts` |
| Search (core) | `ai-studio-core/packages/rag-engine/src/search.ts` |
| Interfaces (core) | `ai-studio-core/packages/rag-engine/src/interfaces.ts` |
| Types (core) | `ai-studio-core/packages/rag-engine/src/types.ts` |
| Pipeline (core) | `ai-studio-core/packages/rag-engine/src/pipeline.ts` |
| Contextual Enrichment | `ai-studio-core/packages/rag-engine/src/contextual-enrichment.ts` |
| HyDE Expansion | `ai-studio-core/packages/rag-engine/src/hyde.ts` |
| Query Decomposition | `ai-studio-core/packages/rag-engine/src/query-decomposition.ts` |
| Merge Results | `ai-studio-core/packages/rag-engine/src/merge-results.ts` |
| RAGAS Evaluator | `ai-studio-core/packages/rag-engine/src/evaluator.ts` |
| Graph Extraction | `ai-studio-core/packages/rag-engine/src/graph-extraction.ts` |
| Graph Search | `ai-studio-core/packages/rag-engine/src/graph-search.ts` |
| Late Chunking | `ai-studio-core/packages/rag-engine/src/late-chunking.ts` |
| Multimodal RAG | `ai-studio-core/packages/rag-engine/src/multimodal.ts` |
| Embedding (core) | `ai-studio-core/packages/provider-bridge/src/embedding.ts` |
| Reranker (core) | `ai-studio-core/packages/provider-bridge/src/reranker.ts` |
| Vector store (PG) | `packages/agent-runtime/src/stores/drizzle-search-store.ts` |
| Vector store (Qdrant) | `packages/agent-runtime/src/stores/qdrant-search-store.ts` |
| Document store (PG) | `packages/agent-runtime/src/stores/drizzle-document-store.ts` |
| Document store (Qdrant) | `packages/agent-runtime/src/stores/qdrant-document-store.ts` |
| Graph store (PG) | `packages/agent-runtime/src/stores/drizzle-graph-store.ts` |
| Graph store (Qdrant) | `packages/agent-runtime/src/stores/qdrant-graph-store.ts` |
| Qdrant client | `packages/agent-runtime/src/stores/qdrant-client.ts` |
| Qdrant init | `packages/agent-runtime/src/stores/qdrant-init.ts` |
| Knowledge search | `packages/agent-runtime/src/knowledge-search.ts` |
| RAG migration (021) | `packages/database/src/migrations/021_rag_overhaul.sql` |
| UI page | `web/src/app/(platform)/knowledge/page.tsx` |
