# 16 - RAG Overhaul Design

Comprehensive redesign of the Retrieval-Augmented Generation pipeline in Echol AI Studio. Covers Contextual Retrieval, HyDE, RAGAS evaluation, Agentic RAG, Query Decomposition, GraphRAG, Late Chunking, and Multimodal RAG across three implementation phases (P0/P1/P2).

---

## 1. Current Architecture

### 1.1 What We Have Now

The RAG system is split across two packages:

| Layer | Package | Key Files |
|-------|---------|-----------|
| Engine (pure logic, no DB deps) | `ai-studio-core/packages/rag-engine/src/` | `interfaces.ts`, `types.ts`, `chunker.ts`, `rrf.ts`, `search.ts`, `pipeline.ts` |
| App integration (Drizzle, Next.js) | `ai-studio-app/web/src/lib/rag/` | `embedder.ts`, `reranker.ts`, `processor.ts`, `evaluate.ts`, `text-extractor.ts` |
| Runtime stores | `ai-studio-app/packages/agent-runtime/src/stores/` | `drizzle-search-store.ts`, `drizzle-document-store.ts` |
| Agent tool binding | `ai-studio-app/packages/agent-runtime/src/tools/` | `context-executors.ts` (knowledge_search) |
| API surface | `ai-studio-app/web/src/app/api/knowledge-bases/` | CRUD routes + document upload/process + evaluate |
| Schema | `ai-studio-app/packages/database/src/schema/` | `knowledge-bases.ts` (4 tables) |
| Validation | `ai-studio-app/packages/validation/src/` | `knowledge-bases.ts` |

**Current capabilities:**
- **Chunking:** Recursive text splitting, fixed-size splitting, parent-child chunking (parent=2048, child=512). Contextual prefix prepends `[Document: {fileName}]` to each chunk.
- **Embedding:** Built-in `Xenova/bge-small-en-v1.5` (384-dim, q8 quantized) or any OpenAI-compatible provider via `/v1/embeddings`.
- **Search:** Hybrid retrieval with cosine vector search (pgvector `<=>`) + BM25 full-text search (PostgreSQL `tsvector`/`tsquery`), fused via Reciprocal Rank Fusion (k=60).
- **Re-ranking:** Optional cross-encoder reranking via built-in `Xenova/ms-marco-MiniLM-L-6-v2` or Cohere-compatible `/v1/rerank` endpoint. Reranks top `topK * 3` candidates.
- **Parent chunk expansion:** Child chunks are searched; if a child has a `parentChunkId`, the parent's full content is returned instead, giving the LLM more context.
- **Evaluation:** Basic keyword-overlap evaluation via `evaluate.ts`. Counts matched keywords between expected answers and retrieved chunks. No LLM-as-judge.

### 1.2 Current Data Flow

```
INGEST (write path)                            SEARCH (read path)
===================                            ==================

Upload file (POST /api/knowledge-bases/[id]/    User query (agent tool: knowledge_search)
  documents, multipart form-data)                   |
    |                                               v
    v                                           knowledge-search.ts
Store file to disk:                                 |
  .data/uploads/{tenantId}/{kbId}/{uuid}{ext}       +-- getAgentKBs(agentId, tenantId)
    |                                               |     -> first KB's embedding + rerank config
    v                                               |
POST .../process (fire-and-forget)                  +-- createEmbedder(config)
    |                                               +-- createReranker(config) [optional]
    v                                               |
processor.ts -> pipeline.ts                         v
    |                                           search.ts -- searchKnowledge()
    +-- TextExtractor.extract()                     |
    |   txt/md/csv -> utf8 string                   +-- embedSingle(query, "query")
    |   pdf -> pdf-parse                            |
    |   docx -> mammoth                             +-- Promise.all([
    |                                               |     vectorSearch(embedding, kbIds, topK*4, thresh)
    +-- deleteChunks() (idempotent re-process)      |     bm25Search(query, kbIds, topK*4)
    |                                               |   ])
    +-- chunkText() or parentChildChunkText()       |
    |   recursive: split by ["\n\n","\n",". "," ",""]  +-- rrfFuse(vectorHits, bm25Hits, k=60)
    |   fixed: character boundaries                 |
    |   parent_child: parent(2048) -> child(512)    +-- reranker.rerank(query, top topK*3 docs)
    |     only children get embeddings              |
    |                                               +-- Take final topK results
    +-- embedder.embed(chunkTexts, "document")      |
    |   builtin: Xenova/bge q8 -> 384d vectors      +-- Parent chunk expansion:
    |   provider: OpenAI /v1/embeddings batch=100   |   if child has parentChunkId -> fetch parent
    |                                               |
    +-- insertChunks() in batches of 50             v
    |   (document_chunks + pgvector embedding)  Return SearchResult[]:
    |                                             { content, score, documentName,
    +-- updateDocumentStatus("ready")               knowledgeBaseName, chunkIndex,
    +-- updateKBChunkCount()                        source: "vector"|"bm25"|"hybrid" }
```

### 1.3 Current Schema

**Table: `knowledge_bases`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| tenant_id | uuid FK -> tenants | Multi-tenant isolation |
| name | text | Unique per tenant |
| description | text | |
| embedding_source | text | "builtin" or "provider" |
| embedding_provider_id | uuid FK -> providers | NULL if builtin |
| embedding_model | text | Default: "Xenova/bge-small-en-v1.5" |
| embedding_dimension | integer | Default: 384 |
| rerank_source | text | NULL, "builtin", or "provider" |
| rerank_provider_id | uuid FK -> providers | |
| rerank_model | text | |
| chunk_config | jsonb | `{method, chunk_size, chunk_overlap, parent_chunk_size, child_chunk_size}` |
| document_count | integer | |
| chunk_count | integer | |
| is_active | boolean | Soft-delete pattern |
| deactivated_at | timestamptz | |
| created_by | uuid FK -> users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Table: `documents`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK | |
| knowledge_base_id | uuid FK | |
| file_name | text | Original filename |
| file_type | text | Extension: txt, md, pdf, csv, docx |
| file_size_bytes | bigint | |
| storage_path | text | Relative path under .data/uploads/ |
| status | enum | uploaded -> processing -> ready / error |
| chunk_count | integer | |
| error_message | text | |
| metadata | jsonb | |
| uploaded_by | uuid FK | |
| processed_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Table: `document_chunks`**

| Column | Type | Notes |
|--------|------|-------|
| id | bigserial PK | |
| tenant_id | uuid FK | |
| document_id | uuid FK -> documents | CASCADE delete |
| chunk_index | integer | Position in document |
| content | text | Chunk text (may include `[Document: ...]` prefix) |
| embedding | vector | pgvector, untyped (any dimension). NULL for parent chunks |
| chunk_type | text | "standard", "child", or "parent" |
| parent_chunk_id | bigint FK -> document_chunks | Self-referencing for child->parent |
| token_count | integer | Estimated at ~4 chars/token |
| metadata | jsonb | {fileName, fileType, chunkSize} |
| search_vector | tsvector | Auto-populated by trigger from `content` |
| created_at | timestamptz | |

**Table: `agent_knowledge_bases`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK | |
| agent_id | uuid FK -> agents | |
| knowledge_base_id | uuid FK -> knowledge_bases | |
| search_config | jsonb | Per-agent search overrides (currently unused) |
| created_at | timestamptz | |

### 1.4 Current Limitations

1. **No contextual enrichment at indexing time.** The `[Document: filename]` prefix is a static string prepend, not an LLM-generated contextual description. Chunks lose context about where they sit within the overall document.

2. **No query expansion.** The raw user query is embedded directly. Vague or short queries ("routing", "auth") produce poor vector matches because the query embedding is too sparse.

3. **Keyword-only evaluation.** `evaluate.ts` counts keyword overlaps. No LLM-as-judge, no RAGAS-style metrics (faithfulness, answer relevancy, context precision, context recall). Cannot distinguish between truly relevant and superficially matching chunks.

4. **Single-shot retrieval.** The `knowledge_search` tool makes one search call and returns results. No ability to refine the query, search again with different terms, or iteratively narrow down.

5. **No query decomposition.** Multi-part questions like "Compare X and Y" or "How does A interact with B?" hit the retriever as a single query, often missing one aspect.

6. **Small embedding model.** `bge-small-en-v1.5` (384-dim) is fast but lower quality than models like `jina-embeddings-v3` (1024-dim, 8192 context, late chunking support).

7. **No graph-based retrieval.** Entity relationships between chunks are invisible. Questions like "What agents use the billing tool?" require cross-document reasoning the current system cannot do.

8. **No multimodal support.** PDF diagrams, screenshots, and images are discarded during text extraction. Only text content is indexed.

9. **No evaluation persistence.** Evaluation results are returned as a one-shot API response but never stored. Cannot track retrieval quality over time.

10. **pgvector scaling ceiling.** HNSW indexes on pgvector work well up to ~1M vectors. Beyond that, a dedicated vector DB (Qdrant) would be needed for production scale.

---

## 2. Target Architecture

### 2.1 Full Pipeline Diagram

```
INGEST (write path) — Enhanced Pipeline
========================================

Upload file
    |
    v
Store file to disk
    |
    v
POST .../process
    |
    v
processor.ts -> pipeline.ts (enhanced)
    |
    +-- TextExtractor.extract()
    |
    +-- deleteChunks() (idempotent)
    |
    +-- Select chunking method:
    |   |
    |   +-- "recursive" -> chunkText() .............. [existing]
    |   +-- "fixed" -> chunkText() .................. [existing]
    |   +-- "parent_child" -> parentChildChunkText()  [existing]
    |   +-- "late_chunking" -> lateChunkText() ...... [P2 new]
    |         embed full doc first, then segment
    |
    +-- [P0] Contextual Enrichment (if enabled):
    |   |
    |   +-- "none" -> skip (existing behavior)
    |   +-- "static" -> prepend [Document: filename | Section: heading]
    |   +-- "llm" -> for each chunk:
    |         LLM call: "Given this document, describe what this chunk is about"
    |         Store result in contextual_description column
    |         Prepend description to chunk content before embedding
    |
    +-- embedder.embed(enrichedChunkTexts, "document")
    |
    +-- insertChunks() (with contextual_description)
    |
    +-- [P1/P2] Graph Extraction (if enabled):
    |   |
    |   +-- For each chunk: LLM extracts entities + relationships
    |   +-- Store in graph_entities + graph_relationships tables
    |   +-- Embed entity descriptions for entity-level search
    |
    +-- updateDocumentStatus("ready")
    +-- updateKBChunkCount()


SEARCH (read path) — Enhanced Pipeline
========================================

User query (via knowledge_search tool or workflow node)
    |
    v
knowledge-search.ts (enhanced)
    |
    +-- getAgentKBs(agentId, tenantId) -> KB configs
    |
    +-- [P1] Query Decomposition (if enabled):
    |   |
    |   +-- LLM call: "Split this into sub-queries"
    |   +-- If decomposed: search each sub-query independently
    |   +-- Merge results via RRF across sub-queries
    |
    +-- [P0] Query Expansion (if enabled):
    |   |
    |   +-- "none" -> embed raw query
    |   +-- "hyde" -> LLM generates hypothetical answer
    |         Embed the hypothetical answer instead of raw query
    |         Fallback to raw query if LLM call fails
    |
    +-- embedSingle(expandedQuery, "query")
    |
    +-- Promise.all([
    |     vectorSearch(embedding, kbIds, topK*4, threshold)
    |     bm25Search(query, kbIds, topK*4)        // always uses raw query
    |   ])
    |
    +-- rrfFuse(vectorHits, bm25Hits, k=60)
    |
    +-- [P2] Graph Expansion (if enabled):
    |   |
    |   +-- Extract entities from query
    |   +-- Find related entities in graph
    |   +-- Expand to connected entities (1-hop)
    |   +-- Fetch chunks containing those entities
    |   +-- Add to candidate pool, re-fuse with RRF
    |
    +-- reranker.rerank(query, topK*3 candidates)
    |
    +-- Take final topK results
    |
    +-- Parent chunk expansion (existing)
    |
    +-- [P1] Agentic RAG loop (if agent-driven):
    |   |
    |   +-- Agent reviews results -> decides to refine
    |   +-- knowledge_refine_search tool: new query -> re-search
    |   +-- Max 3 iterations
    |
    v
Return SearchResult[] (enhanced with source metadata)


EVALUATION — New Pipeline
==========================

POST /api/knowledge-bases/[id]/evaluate (enhanced)
    |
    v
evaluator.ts (rewritten)
    |
    +-- For each test question:
    |   |
    |   +-- Run search pipeline -> get retrieved chunks
    |   +-- Generate answer using LLM + retrieved chunks
    |   |
    |   +-- LLM-as-Judge scoring:
    |       +-- Faithfulness: is answer grounded in retrieved context?
    |       +-- Answer Relevancy: does answer address the question?
    |       +-- Context Precision: are retrieved chunks relevant?
    |       +-- Context Recall: did we retrieve all necessary info?
    |
    +-- Store results in rag_evaluations table
    +-- Return evaluation report with per-query + summary scores
```

### 2.2 Configurable Strategy Per Knowledge Base

Every new RAG capability is gated behind a KB-level configuration toggle. Admins configure these per knowledge base in the KB settings UI. This means:

- One KB can use basic chunking + no enrichment (fast, cheap)
- Another KB can use parent-child + LLM contextual enrichment + HyDE (high quality, higher cost)
- A third KB can enable graph extraction for entity-dense content

No global switches. Each KB is independently configurable.

### 2.3 The KB Config Model

This is what admins control per knowledge base. Existing fields are preserved; new fields are added with safe defaults that maintain current behavior.

```typescript
// Stored in knowledge_bases table columns + chunk_config JSONB

interface KnowledgeBaseConfig {
  // ── Existing ──
  chunkConfig: {
    method: "recursive" | "fixed" | "parent_child" | "late_chunking";  // extended in P2
    chunk_size: number;           // default: 2048
    chunk_overlap: number;        // default: 200
    parent_chunk_size: number;    // default: 2048 (parent_child only)
    child_chunk_size: number;     // default: 512 (parent_child only)
  };
  embeddingSource: "builtin" | "provider";
  embeddingModel: string;
  embeddingDimension: number;
  rerankSource: "builtin" | "provider" | null;
  rerankModel: string | null;

  // ── P0: New columns on knowledge_bases table ──
  contextualEnrichment: "none" | "static" | "llm";     // default: "static"
  contextualModel: string | null;                        // which LLM for enrichment (null = use tenant default)
  queryExpansion: "none" | "hyde";                       // default: "none"
  queryExpansionModel: string | null;                    // which LLM for HyDE (null = use tenant default)

  // ── P1: New columns on knowledge_bases table ──
  queryDecomposition: boolean;                           // default: false

  // ── P2: New columns on knowledge_bases table ──
  graphExtraction: boolean;                              // default: false
  graphExtractionModel: string | null;                   // which LLM for entity extraction
}
```

---

## 3. P0: Contextual Retrieval + HyDE + RAGAS

### 3.1 Contextual Retrieval (Anthropic Approach)

**Problem:** When a document is chunked, each chunk loses context about where it fits in the overall document. A chunk saying "This feature supports rate limiting" has no indication of which feature, from which page, or in what context.

**Solution:** At indexing time, use an LLM to generate a short contextual description for each chunk. This description is prepended to the chunk content before embedding, so the vector captures both the chunk's content AND its context within the document.

**How it works:**

1. After chunking (recursive/fixed/parent_child), for each chunk:
2. Send the full document (or a surrounding window of ~8K tokens) + the chunk to an LLM
3. LLM generates a 1-2 sentence context description
4. Store the description in `contextual_description` column
5. Prepend description to chunk content before embedding
6. The enriched text is embedded, but the original `content` column stays unchanged
7. At search time, the vector search naturally benefits from the richer embeddings

**Three modes controlled by `contextualEnrichment`:**

| Mode | Behavior | Cost | Quality |
|------|----------|------|---------|
| `"none"` | No prefix. Raw chunk text is embedded. | Free | Baseline |
| `"static"` | Prepend `[Document: {fileName} | Section: {heading}]`. Current behavior. | Free | Small improvement |
| `"llm"` | LLM generates contextual description per chunk. Stored in `contextual_description`. | ~50 tokens/chunk | Significant improvement (~49% fewer retrieval failures per Anthropic research) |

**Prompt template for context generation:**

```
<document>
{WHOLE_DOCUMENT_TEXT (or first 8000 tokens if document is very long)}
</document>

Here is a chunk from that document:
<chunk>
{CHUNK_TEXT}
</chunk>

Give a short, succinct context (1-2 sentences) to situate this chunk within the overall document.
Focus on: what topic/section this belongs to, what entity or concept it describes, and how it relates to surrounding content.
Do NOT summarize the chunk itself — describe its CONTEXT.

Context:
```

**Where it plugs into the pipeline:**

In `pipeline.ts` -> `processDocument()`, after chunking and before embedding:

```
chunkText()
    |
    v
[NEW] contextualEnrich() -- if config.contextualEnrichment === "llm"
    |  For each chunk:
    |    LLM call -> contextual_description
    |    enrichedContent = contextual_description + "\n\n" + chunk.content
    |
    v
embedder.embed(enrichedTexts, "document")
    |
    v
insertChunks() -- now includes contextual_description column
```

**Schema change:**

```sql
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS contextual_description TEXT DEFAULT NULL;
```

**Cost estimation:**
- Input: ~200 tokens (document context window) + ~50 tokens (chunk) = ~250 tokens
- Output: ~50 tokens (context description)
- Per chunk: ~300 tokens total
- Using Claude Haiku (cheapest): $0.25/1M input + $1.25/1M output
  - 100 chunks: ~$0.01 input + ~$0.006 output = ~$0.02
  - 1000 chunks: ~$0.15
  - 10,000 chunks: ~$1.50
- Using local Ollama (e.g., Qwen2.5-7B): $0.00 (self-hosted)

**Implementation detail — batching for cost control:**

The enrichment step processes chunks sequentially but with configurable concurrency. Default: 5 concurrent LLM calls. This balances throughput vs. API rate limits.

```typescript
// In pipeline.ts, new function
async function contextualEnrich(
  chunks: Chunk[],
  fullDocText: string,
  model: string,
  providerConfig: LLMConfig,
  concurrency: number = 5,
): Promise<Map<number, string>> {
  // Returns Map<chunkIndex, contextualDescription>
  // Uses p-limit or manual semaphore for concurrency control
}
```

### 3.2 HyDE (Hypothetical Document Embeddings)

**Problem:** Short or vague queries ("routing", "auth setup") produce embeddings that are far from any document chunk in vector space. The query "routing" could mean URL routing, message routing, or network routing. The embedding is ambiguous.

**Solution:** Before embedding the search query, use an LLM to generate a hypothetical answer to the query. Embed the hypothetical answer instead (or alongside) the original query. The hypothetical answer is likely to be lexically and semantically closer to actual document chunks.

**How it works:**

1. User submits query "How does middleware work?"
2. LLM generates: "Middleware in Next.js intercepts requests before they reach the route handler. It runs on the Edge runtime and can modify request/response headers, redirect, rewrite URLs, or return responses directly. Middleware is defined in a middleware.ts file at the root of the project..."
3. This hypothetical answer is embedded instead of the raw query
4. Vector search finds chunks similar to this detailed answer
5. BM25 still uses the original raw query (keywords are still valuable)

**Where it plugs in:**

In `search.ts` -> `searchKnowledge()`, before the embedding call:

```
User query: "How does middleware work?"
    |
    v
[NEW] hydeExpand() -- if KB config queryExpansion === "hyde"
    |  LLM generates hypothetical answer
    |  Returns hypothetical answer text
    |
    v
embedSingle(hypotheticalAnswer, "query")  // instead of raw query
    |
    v
Promise.all([
    vectorSearch(hydeEmbedding, ...)       // uses HyDE embedding
    bm25Search(originalQuery, ...)         // still uses raw query
])
```

**Prompt template for HyDE:**

```
Answer the following question in a detailed paragraph, as if you were writing
a technical documentation page. Write factually even if you are not certain.
Do NOT say "I don't know" — write your best answer.

Question: {USER_QUERY}

Answer:
```

**KB config toggle:**

```
queryExpansion: "none" | "hyde"
queryExpansionModel: string | null   // null = use tenant's default LLM
```

**Fallback behavior:**

If the HyDE LLM call fails (timeout, rate limit, error), fall back to embedding the raw query directly. Log the failure but do not fail the search.

```typescript
async function hydeExpand(
  query: string,
  model: string,
  providerConfig: LLMConfig,
): Promise<string> {
  try {
    const hypothetical = await llmCall(model, providerConfig, HYDE_PROMPT(query));
    return hypothetical;
  } catch (e) {
    console.warn(`HyDE expansion failed, falling back to raw query: ${e.message}`);
    return query; // fallback
  }
}
```

**Cost estimation:**
- Input: ~30 tokens (prompt) + ~20 tokens (query) = ~50 tokens
- Output: ~150 tokens (hypothetical answer)
- Per search: ~200 tokens
- Using Claude Haiku: ~$0.0002 per search
- Adds ~200-500ms latency per search (LLM call)

**When HyDE helps vs. hurts:**

| Query Type | HyDE Impact | Reason |
|------------|-------------|--------|
| Vague ("routing") | Strong improvement | HyDE adds specificity |
| Short factual ("default port") | Moderate improvement | HyDE adds surrounding context |
| Long detailed query | Neutral to slight negative | Original query is already specific |
| Keyword-heavy ("error CORS headers 403") | Slight negative | BM25 handles this better; HyDE may dilute keywords |

Recommendation: Enable HyDE for knowledge bases where users tend to ask conceptual questions. Leave disabled for KBs with primarily keyword-search patterns.

### 3.3 RAGAS Evaluation

**Problem:** The current `evaluate.ts` uses keyword overlap to score retrieval quality. This is unreliable: a chunk containing the word "routing" is counted as relevant to any routing question, even if it describes network routing instead of URL routing.

**Solution:** Implement RAGAS-style evaluation using LLM-as-judge, entirely in TypeScript. No Python dependency.

**Metrics:**

| Metric | What It Measures | How It's Scored |
|--------|-----------------|-----------------|
| **Context Precision** | Are the retrieved chunks relevant to the question? | LLM judges each chunk: relevant (1) or not (0). Score = relevant_chunks / total_chunks. |
| **Context Recall** | Did we retrieve all the info needed to answer? | LLM checks if each sentence in the ground truth can be attributed to retrieved context. Score = attributable_sentences / total_sentences. |
| **Faithfulness** | Is the generated answer grounded in the retrieved context? | LLM extracts claims from the answer, then checks each claim against the context. Score = supported_claims / total_claims. |
| **Answer Relevancy** | Does the answer actually address the question? | LLM generates N hypothetical questions from the answer, then measures cosine similarity between original question embedding and generated question embeddings. |

**Implementation approach — LLM-as-judge (pure TypeScript):**

Each metric is a single LLM call with a structured prompt that returns a JSON score. No external library needed.

**Context Precision prompt:**

```
Given a question and a set of retrieved context chunks, judge whether each chunk
is relevant to answering the question.

Question: {QUESTION}

Chunks:
{CHUNK_1}
---
{CHUNK_2}
---
...

For each chunk, respond with a JSON array of objects:
[{"chunk_index": 0, "relevant": true, "reason": "..."}, ...]

Only mark a chunk as relevant if it contains information that would help answer
the question. Tangentially related content is NOT relevant.
```

**Context Recall prompt:**

```
Given a ground truth answer and retrieved context chunks, determine what
fraction of the ground truth information is covered by the context.

Ground truth answer: {GROUND_TRUTH}

Retrieved context:
{COMBINED_CONTEXT}

Break the ground truth into individual facts/claims, then check if each
is supported by the retrieved context. Respond as JSON:
{
  "claims": [
    {"claim": "...", "supported": true},
    {"claim": "...", "supported": false}
  ],
  "score": 0.75
}
```

**Faithfulness prompt:**

```
Given an answer and the context it was generated from, check if every claim
in the answer is supported by the context.

Answer: {GENERATED_ANSWER}

Context:
{COMBINED_CONTEXT}

Extract each factual claim from the answer, then check if it appears in or
can be inferred from the context. Respond as JSON:
{
  "claims": [
    {"claim": "...", "supported": true},
    {"claim": "...", "supported": false}
  ],
  "score": 0.80
}
```

**Answer Relevancy scoring:**

```typescript
async function scoreAnswerRelevancy(
  question: string,
  answer: string,
  embedder: Embedder,
  llm: LLMCaller,
): Promise<number> {
  // 1. LLM generates 3 hypothetical questions from the answer
  const generatedQuestions = await llm.call(ANSWER_RELEVANCY_PROMPT(answer));

  // 2. Embed original question + generated questions
  const [origEmb, ...genEmbs] = await embedder.embed(
    [question, ...generatedQuestions],
    "query"
  );

  // 3. Average cosine similarity
  const similarities = genEmbs.map(e => cosineSimilarity(origEmb, e));
  return similarities.reduce((a, b) => a + b, 0) / similarities.length;
}
```

**New API endpoint behavior:**

Enhance the existing `POST /api/knowledge-bases/[id]/evaluate` endpoint:

```typescript
// Request body (enhanced)
{
  "agentId": "uuid",
  "questions": [
    {
      "query": "What is the default port for Next.js?",
      "expectedAnswer": "The default port is 3000",
      "relevantDocNames": ["getting-started.md"]  // optional
    }
  ],
  "evaluationModel": "claude-haiku"  // optional, defaults to tenant default
}

// Response body (enhanced)
{
  "evaluationId": "uuid",       // NEW: persisted evaluation
  "results": [
    {
      "query": "What is the default port?",
      "retrievedChunks": 5,
      "generatedAnswer": "The default port for Next.js is 3000...",
      "scores": {
        "contextPrecision": 0.80,
        "contextRecall": 0.90,
        "faithfulness": 0.95,
        "answerRelevancy": 0.85
      },
      "chunkJudgments": [
        { "chunkIndex": 0, "relevant": true, "reason": "Directly states port 3000" },
        { "chunkIndex": 1, "relevant": false, "reason": "Discusses deployment, not ports" }
      ],
      "sources": [...]
    }
  ],
  "summary": {
    "avgContextPrecision": 0.80,
    "avgContextRecall": 0.90,
    "avgFaithfulness": 0.95,
    "avgAnswerRelevancy": 0.85,
    "overallScore": 0.875        // weighted average
  }
}
```

**New table: `rag_evaluations`**

```sql
CREATE TABLE rag_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  evaluation_model TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  summary JSONB NOT NULL,
  -- { avgContextPrecision, avgContextRecall, avgFaithfulness, avgAnswerRelevancy, overallScore }
  results JSONB NOT NULL,
  -- Full per-question results array
  kb_config_snapshot JSONB NOT NULL,
  -- Snapshot of KB config at evaluation time (for comparison)
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rag_evaluations_kb ON rag_evaluations(knowledge_base_id);
CREATE INDEX idx_rag_evaluations_tenant ON rag_evaluations(tenant_id);
```

This allows tracking evaluation scores over time: "After enabling contextual enrichment, context precision went from 0.65 to 0.82."

---

## 4. P1: Agentic RAG + Query Decomposition + Embedding Upgrade

### 4.1 Agentic RAG

**Problem:** The current `knowledge_search` tool is one-shot. The agent calls it once, gets results, and must work with whatever it received. If the results are poor or incomplete, the agent has no way to refine.

**Solution:** Add a `knowledge_refine_search` tool that allows the agent to iteratively search. The agent can:
1. Review initial results
2. Decide results are insufficient
3. Issue a refined query with the `knowledge_refine_search` tool
4. Get new results that complement (not duplicate) the first set

**How it works:**

The agent runtime tracks search history within a session turn. When `knowledge_refine_search` is called, it:
1. Takes a new query + optional exclusion of already-seen chunk IDs
2. Runs the full search pipeline with the new query
3. Filters out chunks already returned in previous iterations
4. Returns fresh results

**Max iterations:** 3 (configurable via `agent_knowledge_bases.search_config`). After 3 refinements, the tool returns a message suggesting the agent work with what it has.

**Changes to context-executors.ts:**

```typescript
// New tool added alongside existing knowledge_search
export const KNOWLEDGE_REFINE_SEARCH_DEFINITION: ToolDefinition = {
  name: "knowledge_refine_search",
  description: "Refine a previous knowledge search with a new query. Use this when the initial search results were insufficient or you need additional context. Previously returned chunks will be excluded.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Refined search query" },
      reason: { type: "string", description: "Why the previous results were insufficient" },
      top_k: { type: "number", description: "Number of results (default: 5)" },
    },
    required: ["query", "reason"],
  },
};
```

**Session-scoped state:**

The agent runtime's session context (`ctx` in context-executors) needs a mutable search state:

```typescript
interface SearchSessionState {
  seenChunkIds: Set<number>;
  iterationCount: number;
  previousQueries: string[];
}
```

This state is initialized when `knowledge_search` is first called in a turn and persists for `knowledge_refine_search` calls within the same turn.

**Implementation in context-executors.ts:**

```typescript
CONTEXT_EXECUTORS["knowledge_refine_search"] = async (args, ctx) => {
  const maxIterations = 3;
  const state = ctx.searchState || { seenChunkIds: new Set(), iterationCount: 0, previousQueries: [] };

  if (state.iterationCount >= maxIterations) {
    return `Maximum search refinements (${maxIterations}) reached. Work with the results you have.`;
  }

  const query = args.query as string;
  const reason = args.reason as string;
  state.iterationCount++;
  state.previousQueries.push(query);

  const results = await searchKnowledge(query, ctx.agentId, ctx.tenantId, { topK: (args.top_k as number) || 5 });

  // Filter out already-seen chunks
  const freshResults = results.filter(r => !state.seenChunkIds.has(r.chunkId));
  freshResults.forEach(r => state.seenChunkIds.add(r.chunkId));

  ctx.searchState = state;

  if (freshResults.length === 0) {
    return `No new results found for refined query "${query}". Previous queries: ${state.previousQueries.join(", ")}`;
  }

  return freshResults.map((r, i) =>
    `[${i + 1}] (score: ${r.score.toFixed(3)}) [${r.knowledgeBaseName} / ${r.documentName}]\n${r.content}`
  ).join("\n\n---\n\n");
};
```

**Note:** For this to work, `SearchResult` needs to include the chunk ID. Add `chunkId: number` to the `SearchResult` interface in `rag-engine/interfaces.ts`.

### 4.2 Query Decomposition

**Problem:** Complex queries like "How does middleware interact with the App Router's caching strategy?" contain multiple sub-topics. A single search might find middleware docs OR caching docs but miss the intersection.

**Solution:** Before searching, use an LLM to decompose complex queries into simpler sub-queries. Search each sub-query independently, then merge results with RRF.

**How it works:**

1. User query: "How does middleware interact with the App Router's caching strategy?"
2. LLM decomposes into:
   - "What is middleware in Next.js App Router?"
   - "How does caching work in Next.js App Router?"
   - "How does middleware affect cached routes?"
3. Each sub-query runs through the full search pipeline
4. Results are merged with RRF across all sub-queries
5. Standard reranking is applied to the merged set

**Prompt template for decomposition:**

```
Analyze this search query and determine if it should be broken into simpler sub-queries
for better retrieval from a document knowledge base.

Query: {USER_QUERY}

Rules:
- Only decompose if the query contains multiple distinct information needs
- Simple queries should NOT be decomposed (return the original)
- Maximum 3 sub-queries
- Each sub-query should be self-contained and searchable

Respond as JSON:
{
  "shouldDecompose": true,
  "subQueries": ["sub-query 1", "sub-query 2", "sub-query 3"],
  "reasoning": "This query asks about two topics: middleware and caching, plus their interaction"
}

If the query is simple enough to search directly:
{
  "shouldDecompose": false,
  "subQueries": ["{original query}"],
  "reasoning": "Single-topic query, no decomposition needed"
}
```

**Where it plugs in:**

In `search.ts`, before the main search logic:

```
User query
    |
    v
[NEW] decomposeQuery() -- if KB config queryDecomposition === true
    |
    +-- shouldDecompose === false -> proceed with single query
    |
    +-- shouldDecompose === true ->
        |
        +-- For each sub-query:
        |     |
        |     +-- [optional] HyDE expand
        |     +-- embedSingle()
        |     +-- vectorSearch() + bm25Search()
        |     +-- rrfFuse() per sub-query
        |
        +-- Merge all sub-query results with cross-query RRF
        |
        +-- Rerank merged set
        |
        v
    Return final results
```

**Merge strategy:**

```typescript
function mergeDecomposedResults(
  subQueryResults: RRFResult[][],
): RRFResult[] {
  // Union all results, keeping highest score per chunk ID
  const merged = new Map<string | number, RRFResult>();

  for (const results of subQueryResults) {
    for (const result of results) {
      const existing = merged.get(result.id);
      if (!existing || result.rrfScore > existing.rrfScore) {
        merged.set(result.id, result);
      }
    }
  }

  // Also boost chunks that appear in multiple sub-query results
  for (const [id, result] of merged) {
    const appearanceCount = subQueryResults.filter(
      results => results.some(r => r.id === id)
    ).length;
    if (appearanceCount > 1) {
      result.rrfScore *= (1 + 0.1 * (appearanceCount - 1)); // 10% boost per extra appearance
    }
  }

  return [...merged.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}
```

**KB config toggle:**

```
queryDecomposition: boolean   // default: false
```

**Cost estimation:**
- Decomposition LLM call: ~100 tokens input + ~80 tokens output = ~180 tokens
- Per search: ~$0.0001 with Haiku
- Main cost is additional search round-trips (2-3x embedding + DB queries)
- Adds ~500-1000ms latency

### 4.3 Embedding Model Upgrade

**Current state:** Default built-in model is `Xenova/bge-small-en-v1.5` (384-dim, 512 token context). When `embeddingSource = "provider"`, any OpenAI-compatible model works.

**No code change needed.** The embedding system is already fully configurable per KB via `embeddingSource`, `embeddingModel`, and `embeddingDimension`. Admins can already switch to any provider-hosted model.

**Recommended models table:**

| Model | Provider | Dimensions | Context | Quality (MTEB) | Cost | Best For |
|-------|----------|-----------|---------|----------------|------|----------|
| `Xenova/bge-small-en-v1.5` | Built-in (local) | 384 | 512 tokens | 51.7 | Free | Quick start, small KBs |
| `text-embedding-3-small` | OpenAI | 1536 | 8191 tokens | 62.3 | $0.02/1M tokens | General purpose |
| `text-embedding-3-large` | OpenAI | 3072 | 8191 tokens | 64.6 | $0.13/1M tokens | High quality |
| `jina-embeddings-v3` | Jina AI | 1024 | 8192 tokens | 65.5 | $0.02/1M tokens | Long docs, late chunking |
| `nomic-embed-text-v1.5` | Ollama (local) | 768 | 8192 tokens | 62.0 | Free (self-hosted) | Privacy-sensitive, air-gapped |
| `mxbai-embed-large-v1` | Ollama (local) | 1024 | 512 tokens | 64.7 | Free (self-hosted) | Best local quality |

**Key consideration for late chunking (P2):** `jina-embeddings-v3` is the recommended model for late chunking support. Its 8192-token context window allows embedding entire documents before segmenting.

**Migration note:** Changing a KB's embedding model requires re-processing all documents (re-embedding all chunks). The system should warn admins and provide a "re-process all" action.

---

## 5. P2: GraphRAG + Late Chunking + Multimodal

### 5.1 GraphRAG (Enhancement Layer)

**Design principle:** Graph extraction runs ALONGSIDE regular chunking, not instead of it. The existing vector + BM25 hybrid search remains the primary retrieval method. GraphRAG adds an additional signal by expanding results through entity relationships.

**New tables:**

```sql
CREATE TABLE graph_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_chunk_id BIGINT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,       -- "person", "concept", "tool", "api", "config", etc.
  description TEXT NOT NULL,
  embedding VECTOR,                -- embedding of name + description for entity search
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graph_entities_kb ON graph_entities(knowledge_base_id);
CREATE INDEX idx_graph_entities_tenant ON graph_entities(tenant_id);
CREATE INDEX idx_graph_entities_name ON graph_entities(knowledge_base_id, name);
-- HNSW index for entity-level vector search
CREATE INDEX idx_graph_entities_embedding ON graph_entities
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE graph_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,   -- "uses", "extends", "depends_on", "configures", etc.
  description TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,  -- strength of relationship
  source_chunk_id BIGINT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_graph_relationships_kb ON graph_relationships(knowledge_base_id);
CREATE INDEX idx_graph_relationships_source ON graph_relationships(source_entity_id);
CREATE INDEX idx_graph_relationships_target ON graph_relationships(target_entity_id);
```

**Extraction pipeline:**

At indexing time (after chunking + embedding), for each chunk:

```
Chunk text
    |
    v
LLM extraction call
    |
    +-- Extract entities: [{name, type, description}]
    +-- Extract relationships: [{source, target, type, description}]
    |
    v
Deduplicate entities (by name + type within KB)
    |
    +-- If entity exists: increment mention_count, update description if richer
    +-- If new: insert entity, generate embedding for name + description
    |
    v
Insert relationships (with source/target entity IDs)
```

**Entity extraction prompt:**

```
Extract entities and relationships from this text chunk.

Chunk:
{CHUNK_TEXT}

Document context: {DOCUMENT_NAME}

Extract:
1. Named entities (concepts, features, APIs, configurations, people, tools)
2. Relationships between entities

Respond as JSON:
{
  "entities": [
    {"name": "middleware", "type": "concept", "description": "Request interceptor in Next.js"},
    {"name": "App Router", "type": "feature", "description": "File-system based routing in Next.js"}
  ],
  "relationships": [
    {"source": "middleware", "target": "App Router", "type": "integrates_with",
     "description": "Middleware intercepts requests before App Router handles them"}
  ]
}
```

**Query-time graph expansion:**

```typescript
async function graphExpand(
  query: string,
  kbIds: string[],
  tenantId: string,
  embedder: Embedder,
): Promise<number[]> {
  // 1. Extract entity mentions from query
  const queryEntities = await extractQueryEntities(query); // LLM or NER

  // 2. Find matching entities in graph (by name similarity or embedding)
  const queryEmbedding = await embedder.embedSingle(query, "query");
  const matchedEntities = await db.execute(sql`
    SELECT id, name, source_chunk_id
    FROM graph_entities
    WHERE knowledge_base_id = ANY(${kbIds})
      AND tenant_id = ${tenantId}
      AND 1 - (embedding <=> ${queryEmbedding}::vector) > 0.5
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT 10
  `);

  // 3. Expand to 1-hop connected entities
  const entityIds = matchedEntities.map(e => e.id);
  const connected = await db.execute(sql`
    SELECT DISTINCT target_entity_id, source_chunk_id
    FROM graph_relationships
    WHERE source_entity_id = ANY(${entityIds})
    UNION
    SELECT DISTINCT source_entity_id, source_chunk_id
    FROM graph_relationships
    WHERE target_entity_id = ANY(${entityIds})
  `);

  // 4. Collect chunk IDs from matched + connected entities
  const chunkIds = new Set<number>();
  matchedEntities.forEach(e => chunkIds.add(e.source_chunk_id));
  connected.forEach(c => chunkIds.add(c.source_chunk_id));

  return [...chunkIds];
}
```

**Integration with main search pipeline:**

Graph-expanded chunk IDs are fetched from the database and added to the RRF candidate pool with a moderate score boost:

```typescript
// In search.ts, after rrfFuse()
if (kbConfig.graphExtraction) {
  const graphChunkIds = await graphExpand(query, kbIds, tenantId, embedder);
  const graphChunks = await store.getChunksByIds(graphChunkIds);

  // Add graph results to candidate pool with a fixed score
  const graphItems: RRFResult[] = graphChunks.map(chunk => ({
    id: chunk.id,
    content: chunk.content,
    rrfScore: 0.01,  // low base score; RRF will boost if also found by vector/BM25
    vectorRank: null,
    bm25Rank: null,
    metadata: { /* ... */ },
  }));

  candidates = rrfFuse(candidates, graphItems); // re-fuse with graph signal
}
```

**Cost estimation:**
- Entity extraction: ~200 tokens input + ~150 tokens output per chunk = ~350 tokens
- Per chunk with Claude Haiku: ~$0.0003
- 1000 chunks: ~$0.30
- This is more expensive than contextual retrieval (~$0.02/1000 chunks)
- Entity embedding: additional vector storage (~768 bytes per entity at 384 dims)

**KB config toggle:**

```
graphExtraction: boolean           // default: false
graphExtractionModel: string | null
```

### 5.2 Late Chunking

**Problem:** Standard chunking splits text into segments first, then embeds each segment independently. Each chunk's embedding only captures the local context of that chunk, not its relationship to the rest of the document.

**Solution:** With a long-context embedding model (e.g., `jina-embeddings-v3` at 8192 tokens), embed the entire document as one sequence first (preserving full attention across all tokens). Then, segment the embedding output into chunks. Each chunk's embedding is conditioned on the full document context.

**Requirements:**
- Embedding model with long context window (>= 4096 tokens)
- Model must support returning per-token or per-segment embeddings
- Currently only feasible with `jina-embeddings-v3` via their API

**How it works:**

```
Standard chunking:            Late chunking:
                              
  Doc -> Split -> Embed         Doc -> Embed(full) -> Split
  each                          each
  
  Chunk 1 --embed--> V1        Doc -------embed-------> [T1,T2,...,Tn]
  Chunk 2 --embed--> V2                                    |
  Chunk 3 --embed--> V3        Split token ranges:      [T1..T100] -> V1
                                                         [T80..T200] -> V2
  V1 knows nothing about        V1 is conditioned on    [T180..T300] -> V3
  Chunk 2 or 3                   the FULL document
```

**Integration point:**

New chunking method in `rag-engine/chunker.ts`:

```typescript
export interface LateChunkResult {
  index: number;
  content: string;
  tokenCount: number;
  embedding: number[];  // pre-computed during the "embed then split" process
}

export async function lateChunkText(
  text: string,
  config: ChunkConfig,
  embedder: LateChunkEmbedder,
  context?: ChunkContext,
): Promise<LateChunkResult[]> {
  // 1. Embed full document with per-token output
  const { tokenEmbeddings, tokenBoundaries } = await embedder.embedWithTokens(text);

  // 2. Split text into chunks (using same recursive/fixed logic)
  const chunks = chunkText(text, { ...config, method: "recursive" });

  // 3. For each chunk, find the corresponding token range
  //    and mean-pool those token embeddings
  return chunks.map((chunk, i) => {
    const startToken = findTokenIndex(tokenBoundaries, chunk.startOffset);
    const endToken = findTokenIndex(tokenBoundaries, chunk.endOffset);
    const chunkTokenEmbeddings = tokenEmbeddings.slice(startToken, endToken);
    const pooledEmbedding = meanPool(chunkTokenEmbeddings);

    return {
      index: chunk.index,
      content: context ? `[Document: ${context.fileName}] ${chunk.content}` : chunk.content,
      tokenCount: chunk.tokenCount,
      embedding: pooledEmbedding,
    };
  });
}
```

**New `LateChunkEmbedder` interface:**

```typescript
export interface LateChunkEmbedder extends Embedder {
  embedWithTokens(text: string): Promise<{
    tokenEmbeddings: number[][];  // per-token embeddings
    tokenBoundaries: number[];    // character offset of each token boundary
  }>;
}
```

**Pipeline changes:**

In `pipeline.ts`, when `chunkConfig.method === "late_chunking"`:

```typescript
if (chunkConfig.method === "late_chunking") {
  const lateChunks = await lateChunkText(text, chunkConfig, lateEmbedder, context);
  const records = lateChunks.map(c => ({
    documentId: doc.id,
    chunkIndex: c.index,
    content: c.content,
    embedding: c.embedding,  // already computed
    chunkType: "standard" as const,
    tokenCount: c.tokenCount,
    metadata: { fileName: doc.fileName, fileType: doc.fileType },
  }));
  await store.insertChunks("", records);
  // Skip separate embedding step — embeddings come from lateChunkText
}
```

**KB config toggle:**

```
chunkConfig.method: "recursive" | "fixed" | "parent_child" | "late_chunking"
```

When `"late_chunking"` is selected, the KB must use a provider-based embedding model with long context support. The UI should validate this and warn if the selected model does not support per-token embeddings.

**Limitations:**
- Currently only works with Jina API (requires `late_chunking=true` parameter)
- Cannot combine with parent-child chunking (mutually exclusive methods)
- Full document must fit within model context window (8192 tokens for Jina v3)
- Documents exceeding context window are split into sections first, then each section is late-chunked

### 5.3 Multimodal RAG (ColPali Approach)

**Problem:** PDFs with diagrams, charts, tables, and screenshots lose all visual information during text extraction. A network architecture diagram, a configuration screenshot, or a data flow chart becomes invisible to the RAG system.

**Solution:** Index documents as page images. Use a vision-language model (VLM) to generate embeddings from page images directly, bypassing text extraction entirely for visual content.

**How it works (ColPali approach):**

ColPali uses a vision-language model to generate multi-vector embeddings from document page images. Each page produces a set of patch embeddings (one per visual region). At query time, the query is also embedded as a set of token embeddings, and matching uses MaxSim (maximum similarity across all patch-token pairs).

**Simplified approach for initial implementation:**

Rather than full ColPali (which requires a specialized model and MaxSim scoring), we implement a pragmatic multimodal pipeline:

1. **Page rendering:** Convert PDF pages to images (PNG) using a headless renderer
2. **VLM description:** Send each page image to a vision model (Claude, GPT-4V) which generates a detailed text description
3. **Index description:** Chunk and embed the VLM-generated description alongside extracted text
4. **Store page image reference:** Link chunk to page image for display in search results

```
PDF document
    |
    +-- Text extraction (existing) -> text chunks + embeddings
    |
    +-- [NEW] Page image rendering -> PNG per page
    |     |
    |     v
    |   VLM description per page image
    |     |
    |     v
    |   Chunk descriptions -> embed -> store (chunk_type: "visual")
    |
    +-- Link visual chunks to page image paths
```

**New metadata on visual chunks:**

```typescript
interface VisualChunkMetadata {
  pageNumber: number;
  pageImagePath: string;          // relative path to rendered page image
  sourceType: "visual_description";
  visualElements: string[];       // ["diagram", "table", "chart", etc.]
}
```

**KB config toggle:**

```
modalityType: "text" | "multimodal"     // default: "text"
```

When `multimodal` is enabled:
- Text extraction still runs (for BM25 and standard embedding)
- Additionally, PDF pages are rendered as images
- Each page image is described by a VLM
- VLM descriptions are indexed as additional chunks with `chunk_type: "visual"`
- Search results from visual chunks include the page image reference

**Storage:**

Page images are stored alongside document files:
```
.data/uploads/{tenantId}/{kbId}/{docId}/pages/page_001.png
```

**Cost estimation:**
- VLM description per page: ~1000 tokens output (Claude Sonnet with vision)
- Cost per page: ~$0.01-0.03 depending on model
- A 50-page PDF: ~$0.50-1.50 for visual indexing
- Storage: ~200KB per page image x 50 pages = ~10MB per document

**Limitations:**
- Only works for PDF documents (not txt/md/csv/docx)
- Requires a provider with vision capabilities (Claude Sonnet/Opus, GPT-4V)
- Significantly increases processing time (VLM calls are slower)
- Page image storage increases disk usage

---

## 6. Schema Changes

### 6.1 Complete List of Changes

**Modified table: `document_chunks`**

| Change | Column | Type | Default | Phase |
|--------|--------|------|---------|-------|
| ADD | contextual_description | TEXT | NULL | P0 |

**Modified table: `knowledge_bases`**

| Change | Column | Type | Default | Phase |
|--------|--------|------|---------|-------|
| ADD | contextual_enrichment | TEXT | 'static' | P0 |
| ADD | contextual_model | TEXT | NULL | P0 |
| ADD | query_expansion | TEXT | 'none' | P0 |
| ADD | query_expansion_model | TEXT | NULL | P0 |
| ADD | query_decomposition | BOOLEAN | false | P1 |
| ADD | graph_extraction | BOOLEAN | false | P2 |
| ADD | graph_extraction_model | TEXT | NULL | P2 |
| ADD | modality_type | TEXT | 'text' | P2 |

**New table: `rag_evaluations`** (P0)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK -> tenants | CASCADE |
| knowledge_base_id | uuid FK -> knowledge_bases | CASCADE |
| agent_id | uuid FK -> agents | CASCADE |
| evaluation_model | text | LLM used for judging |
| question_count | integer | |
| summary | jsonb | Aggregated scores |
| results | jsonb | Per-question detailed results |
| kb_config_snapshot | jsonb | KB config at eval time |
| created_by | uuid FK -> users | |
| created_at | timestamptz | |

**New table: `graph_entities`** (P2)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK -> tenants | CASCADE |
| knowledge_base_id | uuid FK -> knowledge_bases | CASCADE |
| source_chunk_id | bigint FK -> document_chunks | CASCADE |
| name | text | Entity name |
| entity_type | text | "concept", "api", "tool", etc. |
| description | text | |
| embedding | vector | For entity-level search |
| mention_count | integer | Default: 1 |
| created_at | timestamptz | |

**New table: `graph_relationships`** (P2)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK -> tenants | CASCADE |
| knowledge_base_id | uuid FK -> knowledge_bases | CASCADE |
| source_entity_id | uuid FK -> graph_entities | CASCADE |
| target_entity_id | uuid FK -> graph_entities | CASCADE |
| relationship_type | text | "uses", "extends", "depends_on", etc. |
| description | text | |
| weight | real | Default: 1.0 |
| source_chunk_id | bigint FK -> document_chunks | CASCADE |
| created_at | timestamptz | |

### 6.2 Migration File: `021_rag_overhaul.sql`

```sql
-- Migration 021: RAG Overhaul — Contextual Retrieval, HyDE, RAGAS, GraphRAG
-- Date: 2026-05-XX

-- ============================================================
-- P0: Contextual Retrieval + HyDE + RAGAS
-- ============================================================

-- 1. Add contextual description column to document_chunks
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS contextual_description TEXT DEFAULT NULL;

-- 2. Add RAG config columns to knowledge_bases
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS contextual_enrichment TEXT NOT NULL DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS contextual_model TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS query_expansion TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS query_expansion_model TEXT DEFAULT NULL;

ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_contextual_enrichment
    CHECK (contextual_enrichment IN ('none', 'static', 'llm'));

ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_query_expansion
    CHECK (query_expansion IN ('none', 'hyde'));

-- 3. Create rag_evaluations table
CREATE TABLE IF NOT EXISTS rag_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  evaluation_model TEXT NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}',
  results JSONB NOT NULL DEFAULT '[]',
  kb_config_snapshot JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_evaluations_kb
  ON rag_evaluations(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_rag_evaluations_tenant
  ON rag_evaluations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rag_evaluations_created
  ON rag_evaluations(knowledge_base_id, created_at DESC);

-- ============================================================
-- P1: Query Decomposition
-- ============================================================

ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS query_decomposition BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- P2: GraphRAG + Multimodal
-- ============================================================

-- 4. Add graph extraction + modality columns to knowledge_bases
ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS graph_extraction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS graph_extraction_model TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS modality_type TEXT NOT NULL DEFAULT 'text';

ALTER TABLE knowledge_bases
  ADD CONSTRAINT chk_modality_type
    CHECK (modality_type IN ('text', 'multimodal'));

-- 5. Graph entities table
CREATE TABLE IF NOT EXISTS graph_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_chunk_id BIGINT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  embedding VECTOR,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_entities_kb
  ON graph_entities(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_graph_entities_tenant
  ON graph_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_graph_entities_name
  ON graph_entities(knowledge_base_id, lower(name));

-- 6. Graph relationships table
CREATE TABLE IF NOT EXISTS graph_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight REAL NOT NULL DEFAULT 1.0,
  source_chunk_id BIGINT NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_relationships_kb
  ON graph_relationships(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_graph_relationships_source
  ON graph_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_relationships_target
  ON graph_relationships(target_entity_id);

-- 7. Record migration
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (21, '021_rag_overhaul', NOW())
ON CONFLICT (version) DO NOTHING;
```

**Note on HNSW index for graph_entities embedding:** This should be added once the first KB enables graph extraction, not during migration (to avoid indexing empty tables). Add via a conditional migration or application-level check:

```sql
-- Run when first KB enables graphExtraction
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_entities_embedding
  ON graph_entities USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 7. Updated KB Config Model

### 7.1 TypeScript Interface

```typescript
// In ai-studio-core/packages/rag-engine/src/interfaces.ts

export interface KBConfig {
  // ── Existing ──
  chunkConfig: ChunkConfig;
  embeddingSource: string;
  embeddingModel: string;
  embeddingDimension: number;
  rerankSource: string | null;
  rerankModel: string | null;

  // ── P0: Contextual Retrieval + HyDE ──
  contextualEnrichment: "none" | "static" | "llm";
  contextualModel: string | null;
  queryExpansion: "none" | "hyde";
  queryExpansionModel: string | null;

  // ── P1: Query Decomposition ──
  queryDecomposition: boolean;

  // ── P2: GraphRAG + Multimodal ──
  graphExtraction: boolean;
  graphExtractionModel: string | null;
  modalityType: "text" | "multimodal";
}
```

### 7.2 Updated ChunkConfig

```typescript
// In ai-studio-core/packages/rag-engine/src/types.ts

export interface ChunkConfig {
  method?: "recursive" | "fixed" | "parent_child" | "late_chunking";  // extended
  chunk_size?: number;
  chunk_overlap?: number;
  parent_chunk_size?: number;    // parent_child only
  child_chunk_size?: number;     // parent_child only
}
```

### 7.3 Updated Validation Schema

```typescript
// In ai-studio-app/packages/validation/src/knowledge-bases.ts

export const createKnowledgeBaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  embeddingSource: z.enum(["builtin", "provider"]).optional(),
  embeddingProviderId: z.string().uuid().nullable().optional(),
  embeddingModel: z.string().max(100).optional(),
  embeddingDimension: z.number().int().positive().max(4096).optional(),
  rerankSource: z.enum(["builtin", "provider"]).nullable().optional(),
  rerankProviderId: z.string().uuid().nullable().optional(),
  rerankModel: z.string().max(100).nullable().optional(),
  chunkConfig: z.object({
    method: z.enum(["recursive", "fixed", "parent_child", "late_chunking"]).optional(),
    chunk_size: z.number().int().min(100).max(8000).optional(),
    chunk_overlap: z.number().int().min(0).max(2000).optional(),
    parent_chunk_size: z.number().int().min(500).max(16000).optional(),
    child_chunk_size: z.number().int().min(100).max(4000).optional(),
  }).optional(),

  // P0
  contextualEnrichment: z.enum(["none", "static", "llm"]).optional(),
  contextualModel: z.string().max(100).nullable().optional(),
  queryExpansion: z.enum(["none", "hyde"]).optional(),
  queryExpansionModel: z.string().max(100).nullable().optional(),

  // P1
  queryDecomposition: z.boolean().optional(),

  // P2
  graphExtraction: z.boolean().optional(),
  graphExtractionModel: z.string().max(100).nullable().optional(),
  modalityType: z.enum(["text", "multimodal"]).optional(),
});

export const updateKnowledgeBaseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  rerankSource: z.enum(["builtin", "provider"]).nullable().optional(),
  rerankProviderId: z.string().uuid().nullable().optional(),
  rerankModel: z.string().max(100).nullable().optional(),
  chunkConfig: z.object({
    method: z.enum(["recursive", "fixed", "parent_child", "late_chunking"]).optional(),
    chunk_size: z.number().int().min(100).max(8000).optional(),
    chunk_overlap: z.number().int().min(0).max(2000).optional(),
    parent_chunk_size: z.number().int().min(500).max(16000).optional(),
    child_chunk_size: z.number().int().min(100).max(4000).optional(),
  }).optional(),

  // P0
  contextualEnrichment: z.enum(["none", "static", "llm"]).optional(),
  contextualModel: z.string().max(100).nullable().optional(),
  queryExpansion: z.enum(["none", "hyde"]).optional(),
  queryExpansionModel: z.string().max(100).nullable().optional(),

  // P1
  queryDecomposition: z.boolean().optional(),

  // P2
  graphExtraction: z.boolean().optional(),
  graphExtractionModel: z.string().max(100).nullable().optional(),
  modalityType: z.enum(["text", "multimodal"]).optional(),
});
```

### 7.4 Updated Drizzle Schema

New columns to add to the `knowledgeBases` table definition in `knowledge-bases.ts`:

```typescript
// Add to knowledgeBases table columns
contextualEnrichment: text("contextual_enrichment").notNull().default("static"),
contextualModel: text("contextual_model"),
queryExpansion: text("query_expansion").notNull().default("none"),
queryExpansionModel: text("query_expansion_model"),
queryDecomposition: boolean("query_decomposition").notNull().default(false),
graphExtraction: boolean("graph_extraction").notNull().default(false),
graphExtractionModel: text("graph_extraction_model"),
modalityType: text("modality_type").notNull().default("text"),
```

New column to add to `documentChunks`:

```typescript
contextualDescription: text("contextual_description"),
```

New table schemas for `graphEntities` and `graphRelationships` will be added as separate exports in `knowledge-bases.ts` or a new `graph.ts` schema file.

---

## 8. Test Plan

### 8.1 Test Dataset

**Source:** Next.js documentation (https://nextjs.org/docs) — approximately 200 pages of markdown.

**Why Next.js docs:**
- Known answers: we can verify retrieval accuracy against official documentation
- Technical content with code examples: tests code-aware chunking
- Cross-referencing between pages: tests multi-hop retrieval (middleware -> caching -> revalidation)
- Mix of short pages (config reference) and long pages (migration guides)
- Mix of text and conceptual diagrams (described in text)

**Download and preparation:**
```bash
# Clone Next.js docs as markdown
git clone --depth 1 https://github.com/vercel/next.js.git /tmp/nextjs-docs
cp -r /tmp/nextjs-docs/docs/ .data/test-datasets/nextjs-docs/

# Or use the mdx files directly from the Next.js repo
find /tmp/nextjs-docs/docs -name "*.mdx" -exec cp {} .data/test-datasets/nextjs-docs/ \;
```

**Create a test KB:**
1. Create KB "nextjs-docs-test" with default settings
2. Upload all ~200 markdown files
3. Process all documents
4. Create a test agent assigned to this KB

### 8.2 Test Approach

**Baseline measurement (before any changes):**
1. Create KB with current defaults: recursive chunking, static prefix, bge-small, no reranking
2. Run RAGAS evaluation with 20 test questions
3. Record: context_precision, context_recall, faithfulness, answer_relevancy

**Incremental measurements:**

| Test | Config Change | Expected Impact |
|------|--------------|-----------------|
| T1 | Baseline (current) | Reference scores |
| T2 | Enable reranking (builtin cross-encoder) | +5-10% context precision |
| T3 | Enable contextual enrichment (LLM) | +15-25% context precision |
| T4 | Enable HyDE query expansion | +10-15% on vague queries |
| T5 | Enable T3 + T4 combined | Best P0 scores |
| T6 | Enable query decomposition | +10-20% on multi-part questions |
| T7 | Switch to text-embedding-3-small (1536d) | +5-10% overall |
| T8 | Enable graph extraction | +10-15% on entity relationship questions |

### 8.3 Evaluation Queries (20 Questions)

**Simple factual (5 questions):**

1. "What is the default port for the Next.js development server?"
   - Expected: 3000
   - Tests: Basic retrieval

2. "What file defines middleware in a Next.js application?"
   - Expected: middleware.ts (or middleware.js) at project root
   - Tests: Specific config knowledge

3. "What is the maximum size of the Edge Runtime?"
   - Expected: 4MB (or current documented limit)
   - Tests: Numeric fact retrieval

4. "What command creates a new Next.js application?"
   - Expected: npx create-next-app@latest
   - Tests: Command retrieval

5. "What is the default caching behavior of fetch in App Router?"
   - Expected: force-cache (auto-cached) in production
   - Tests: Framework behavior fact

**Conceptual (5 questions):**

6. "Explain how Server Components differ from Client Components in Next.js."
   - Tests: Multi-paragraph conceptual explanation

7. "What is Partial Prerendering and how does it work?"
   - Tests: Understanding of a complex feature

8. "How does the Next.js Image component optimize images?"
   - Tests: Feature deep-dive retrieval

9. "What are the benefits of the App Router over the Pages Router?"
   - Tests: Comparison retrieval

10. "How does Next.js handle code splitting?"
    - Tests: Architecture concept retrieval

**Multi-hop (5 questions):**

11. "How does middleware interact with the App Router's caching strategy?"
    - Tests: Cross-topic retrieval (needs chunks from middleware AND caching docs)

12. "If I configure a rewrite in middleware, does it affect static generation?"
    - Tests: Connecting middleware + static generation concepts

13. "How do Server Actions handle authentication with middleware?"
    - Tests: Three-way cross-reference

14. "What happens when you use `redirect()` inside a Server Component that is being streamed?"
    - Tests: Intersection of streaming + redirect behavior

15. "Can you use Edge Runtime middleware with ISR routes?"
    - Tests: Runtime compatibility across features

**Comparison (3 questions):**

16. "Compare `generateStaticParams` with `getStaticPaths`."
    - Tests: Migration-era comparison (old vs. new API)

17. "What is the difference between `revalidatePath` and `revalidateTag`?"
    - Tests: Two related APIs

18. "When should I use a Route Handler vs. a Server Action?"
    - Tests: Architectural decision guidance

**Vague / Short (2 questions) — specifically tests HyDE improvement:**

19. "routing"
    - Without HyDE: likely poor results (too vague for vector search)
    - With HyDE: should generate a hypothetical about URL routing in Next.js

20. "auth"
    - Without HyDE: ambiguous (authentication? authorization? auth.js?)
    - With HyDE: should contextualize within Next.js authentication patterns

### 8.4 Automated Test Runner

Create a test script that automates the evaluation pipeline:

```typescript
// ai-studio-app/web/src/lib/rag/__tests__/rag-benchmark.ts

interface BenchmarkConfig {
  kbId: string;
  agentId: string;
  tenantId: string;
  label: string;  // e.g., "baseline", "contextual_llm", "hyde", "combined"
}

async function runBenchmark(config: BenchmarkConfig): Promise<EvalReport> {
  const questions = NEXTJS_TEST_QUESTIONS; // 20 questions from above
  const results = await evaluateRAG(config.agentId, config.tenantId, questions);
  
  console.table({
    label: config.label,
    contextPrecision: results.summary.avgContextPrecision.toFixed(3),
    contextRecall: results.summary.avgContextRecall.toFixed(3),
    faithfulness: results.summary.avgFaithfulness.toFixed(3),
    answerRelevancy: results.summary.avgAnswerRelevancy.toFixed(3),
  });
  
  return results;
}
```

---

## 9. Implementation Phases

### Phase 1 — P0: Contextual Retrieval + HyDE + RAGAS (~3-5 days)

**Day 1-2: Contextual Retrieval**
- Add `contextual_description` column to `document_chunks` (migration)
- Add `contextualEnrichment`, `contextualModel` columns to `knowledge_bases`
- Implement `contextualEnrich()` function in `pipeline.ts`
- Modify `processDocument()` to call enrichment when enabled
- Update `DrizzleDocumentStore.insertChunks()` to store `contextual_description`
- Update Drizzle schema and validation schemas

**Day 2-3: HyDE**
- Add `queryExpansion`, `queryExpansionModel` columns to `knowledge_bases`
- Implement `hydeExpand()` function in `search.ts`
- Modify `searchKnowledge()` to call HyDE when enabled
- Add fallback behavior on LLM failure
- Need: a generic LLM caller that works with the KB's configured provider

**Day 3-4: RAGAS Evaluation**
- Create `rag_evaluations` table (migration)
- Rewrite `evaluate.ts` with LLM-as-judge scoring
- Implement 4 RAGAS metrics as TypeScript functions
- Update `POST /api/knowledge-bases/[id]/evaluate` to persist results
- Add `GET /api/knowledge-bases/[id]/evaluations` endpoint for history
- Add Drizzle schema for `ragEvaluations` table

**Day 4-5: Integration + Testing**
- Update KB create/update API routes to handle new fields
- Update validation schemas
- Set up Next.js docs test dataset
- Run baseline evaluation
- Run evaluations with each feature enabled
- Document results

### Phase 2 — P1: Agentic RAG + Query Decomposition (~3-5 days)

**Day 1-2: Agentic RAG**
- Add `knowledge_refine_search` tool definition to `context-executors.ts`
- Implement search session state tracking in agent runtime context
- Add `chunkId` to `SearchResult` interface
- Modify `searchKnowledge()` to return chunk IDs
- Test with agent sessions: verify iterative refinement works

**Day 2-3: Query Decomposition**
- Add `queryDecomposition` column to `knowledge_bases`
- Implement `decomposeQuery()` function
- Implement `mergeDecomposedResults()` function
- Integrate into `search.ts` pipeline
- Update validation schemas

**Day 3-5: Testing**
- Test agentic RAG with multi-hop questions
- Test query decomposition with comparison and multi-part queries
- Run RAGAS evaluation to measure improvement
- Performance testing: measure latency impact of decomposition

### Phase 3 — P2: GraphRAG + Late Chunking + Multimodal (~5-8 days)

**Day 1-3: GraphRAG**
- Create `graph_entities` and `graph_relationships` tables (migration)
- Add `graphExtraction`, `graphExtractionModel` columns to `knowledge_bases`
- Implement entity extraction pipeline
- Implement entity deduplication logic
- Implement query-time graph expansion
- Integrate graph signal into RRF fusion
- Add Drizzle schema for graph tables

**Day 3-5: Late Chunking**
- Implement `LateChunkEmbedder` interface
- Implement Jina API integration for per-token embeddings
- Implement `lateChunkText()` function
- Integrate into pipeline for `method === "late_chunking"`
- Update `ChunkConfig` type and validation

**Day 5-7: Multimodal RAG**
- Add `modalityType` column to `knowledge_bases`
- Implement PDF page rendering (pdf-lib or puppeteer)
- Implement VLM description generation
- Create visual chunk pipeline alongside text pipeline
- Store page images in workspace
- Return page image references in search results

**Day 7-8: Integration + Testing**
- Test GraphRAG with entity-dense documents
- Test late chunking vs standard chunking quality
- Test multimodal with diagram-heavy PDFs
- Run full RAGAS evaluation suite

### Phase 4 (Future) — Qdrant Migration (~2-3 days)

Not part of this overhaul, but planned for production scale:
- Replace pgvector with Qdrant for vector search
- Keep PostgreSQL for BM25 and metadata
- Implement `QdrantSearchStore` implementing the existing `SearchStore` interface
- No changes to pipeline or search logic (store abstraction already exists)

### Timeline Summary

| Phase | Scope | Estimated Days | Dependencies |
|-------|-------|---------------|--------------|
| P0 | Contextual Retrieval + HyDE + RAGAS | 3-5 days | None |
| P1 | Agentic RAG + Query Decomposition | 3-5 days | P0 (for RAGAS measurement) |
| P2 | GraphRAG + Late Chunking + Multimodal | 5-8 days | P0 |
| Testing | Continuous throughout | 2-3 days | Test dataset ready |
| **Total** | | **13-21 days** | |

---

## 10. Files to Create/Modify

### Phase 1 (P0)

**Files to modify:**

| File | Change |
|------|--------|
| `ai-studio-core/packages/rag-engine/src/interfaces.ts` | Add `contextualEnrichment`, `contextualModel`, `queryExpansion`, `queryExpansionModel` to `KBConfig`. Add `chunkId` to `SearchResult`. |
| `ai-studio-core/packages/rag-engine/src/pipeline.ts` | Add contextual enrichment step after chunking, before embedding. Accept LLM caller as optional dependency. |
| `ai-studio-core/packages/rag-engine/src/search.ts` | Add HyDE expansion step before embedding. Accept LLM caller as optional dependency. Load KB-level config for `queryExpansion`. |
| `ai-studio-app/packages/database/src/schema/knowledge-bases.ts` | Add new columns to `knowledgeBases` table. Add `contextualDescription` to `documentChunks`. Add `ragEvaluations` table export. |
| `ai-studio-app/packages/database/src/schema/index.ts` | Export new `ragEvaluations` table. |
| `ai-studio-app/packages/validation/src/knowledge-bases.ts` | Add P0 fields to create/update schemas. |
| `ai-studio-app/web/src/lib/rag/evaluate.ts` | Complete rewrite: LLM-as-judge RAGAS metrics. |
| `ai-studio-app/web/src/lib/rag/processor.ts` | Pass contextual enrichment config to `processDocument()`. |
| `ai-studio-app/web/src/app/api/knowledge-bases/[id]/evaluate/route.ts` | Persist evaluation results to DB. Return evaluation ID. |
| `ai-studio-app/web/src/app/api/knowledge-bases/route.ts` | Handle new fields in POST. |
| `ai-studio-app/web/src/app/api/knowledge-bases/[id]/route.ts` | Handle new fields in PATCH. |
| `ai-studio-app/packages/agent-runtime/src/knowledge-search.ts` | Pass KB config (queryExpansion, contextual settings) to search engine. |
| `ai-studio-app/packages/agent-runtime/src/stores/drizzle-search-store.ts` | Return chunk IDs in search results. Load contextual enrichment config from KB. |
| `ai-studio-app/packages/agent-runtime/src/stores/drizzle-document-store.ts` | Handle `contextualDescription` in `insertChunks()`. |

**Files to create:**

| File | Purpose |
|------|---------|
| `ai-studio-core/packages/rag-engine/src/contextual-enrichment.ts` | `contextualEnrich()` function with LLM prompt template. Accepts an LLM caller interface. |
| `ai-studio-core/packages/rag-engine/src/hyde.ts` | `hydeExpand()` function with prompt template and fallback logic. |
| `ai-studio-core/packages/rag-engine/src/evaluator.ts` | RAGAS metric implementations: `contextPrecision()`, `contextRecall()`, `faithfulness()`, `answerRelevancy()`. |
| `ai-studio-app/packages/database/src/migrations/021_rag_overhaul.sql` | Migration with all P0+P1+P2 schema changes. |
| `ai-studio-app/web/src/app/api/knowledge-bases/[id]/evaluations/route.ts` | GET endpoint: list evaluation history for a KB. |

### Phase 2 (P1)

**Files to modify:**

| File | Change |
|------|--------|
| `ai-studio-core/packages/rag-engine/src/interfaces.ts` | Add `queryDecomposition` to `KBConfig`. |
| `ai-studio-core/packages/rag-engine/src/search.ts` | Add query decomposition step. Implement `mergeDecomposedResults()`. |
| `ai-studio-app/packages/agent-runtime/src/tools/context-executors.ts` | Add `knowledge_refine_search` executor + definition. |
| `ai-studio-app/packages/agent-runtime/src/tools/types.ts` | Add `searchState` to context interface. |
| `ai-studio-app/packages/agent-runtime/src/tools/tool-loader.ts` | Register `knowledge_refine_search` tool when agent has KB assignments. |
| `ai-studio-app/packages/validation/src/knowledge-bases.ts` | Add `queryDecomposition` field. |

**Files to create:**

| File | Purpose |
|------|---------|
| `ai-studio-core/packages/rag-engine/src/query-decomposition.ts` | `decomposeQuery()` function with LLM prompt template. `mergeDecomposedResults()` function. |

### Phase 3 (P2)

**Files to modify:**

| File | Change |
|------|--------|
| `ai-studio-core/packages/rag-engine/src/interfaces.ts` | Add `graphExtraction`, `graphExtractionModel`, `modalityType` to `KBConfig`. Add `LateChunkEmbedder` interface. |
| `ai-studio-core/packages/rag-engine/src/types.ts` | Add `"late_chunking"` to `ChunkConfig.method`. Add `LateChunkResult` type. |
| `ai-studio-core/packages/rag-engine/src/chunker.ts` | Add `lateChunkText()` function. |
| `ai-studio-core/packages/rag-engine/src/pipeline.ts` | Add late chunking branch. Add graph extraction step after chunk insertion. |
| `ai-studio-core/packages/rag-engine/src/search.ts` | Add graph expansion step after RRF fusion. |
| `ai-studio-core/packages/rag-engine/src/index.ts` | Export new modules. |
| `ai-studio-app/packages/database/src/schema/knowledge-bases.ts` | Add `graphEntities` and `graphRelationships` table exports. Add P2 columns to `knowledgeBases`. |
| `ai-studio-app/packages/validation/src/knowledge-bases.ts` | Add P2 fields. |
| `ai-studio-app/web/src/lib/rag/processor.ts` | Add multimodal processing branch. |
| `ai-studio-app/web/src/lib/rag/text-extractor.ts` | Add PDF page rendering function. |
| `ai-studio-app/packages/agent-runtime/src/stores/drizzle-search-store.ts` | Add `getChunksByIds()` method for graph expansion. |

**Files to create:**

| File | Purpose |
|------|---------|
| `ai-studio-core/packages/rag-engine/src/graph-extraction.ts` | Entity + relationship extraction from chunks. Entity deduplication. |
| `ai-studio-core/packages/rag-engine/src/graph-search.ts` | Query-time graph expansion. Entity matching + 1-hop traversal. |
| `ai-studio-app/web/src/lib/rag/late-chunk-embedder.ts` | Jina API integration for per-token embeddings. Implements `LateChunkEmbedder`. |
| `ai-studio-app/web/src/lib/rag/visual-processor.ts` | PDF page rendering + VLM description pipeline. |
| `ai-studio-app/packages/database/src/schema/graph.ts` | Drizzle table definitions for `graph_entities` and `graph_relationships`. |
| `ai-studio-app/packages/agent-runtime/src/stores/drizzle-graph-store.ts` | Graph entity/relationship CRUD. Entity search. Relationship traversal. |

### Summary File Count

| Phase | Modified | Created | Total |
|-------|----------|---------|-------|
| P0 | 14 | 5 | 19 |
| P1 | 6 | 1 | 7 |
| P2 | 10 | 6 | 16 |
| **Total** | **30** | **12** | **42** |

---

## Appendix A: LLM Caller Interface

Several P0-P2 features need to make LLM calls (contextual enrichment, HyDE, query decomposition, graph extraction, RAGAS evaluation). Rather than importing provider-specific code into the core engine package, define a minimal interface:

```typescript
// In ai-studio-core/packages/rag-engine/src/interfaces.ts

export interface LLMCaller {
  call(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
}
```

The application layer (`ai-studio-app`) creates concrete implementations using the provider-bridge:

```typescript
// In ai-studio-app/web/src/lib/rag/llm-caller.ts

import { callProvider } from "@ais/provider-bridge";

export function createLLMCaller(model: string, providerConfig: ProviderConfig): LLMCaller {
  return {
    async call(prompt, options) {
      const response = await callProvider(providerConfig, {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: options?.maxTokens || 300,
        temperature: options?.temperature || 0.0,
      });
      return response.content;
    },
  };
}
```

This keeps `rag-engine` provider-agnostic while allowing LLM features to work with any configured provider.

## Appendix B: Cost Summary

| Feature | Cost per 1000 chunks | Cost per search | Phase |
|---------|---------------------|----------------|-------|
| Contextual Enrichment (Haiku) | ~$0.02 | N/A (indexing only) | P0 |
| Contextual Enrichment (Ollama) | $0.00 | N/A | P0 |
| HyDE (Haiku) | N/A | ~$0.0002 | P0 |
| RAGAS Evaluation (Haiku) | N/A | ~$0.002 per question | P0 |
| Query Decomposition (Haiku) | N/A | ~$0.0001 | P1 |
| Graph Extraction (Haiku) | ~$0.30 | N/A (indexing only) | P2 |
| Graph Query Expansion | N/A | ~$0.0001 + DB queries | P2 |
| Multimodal VLM (Sonnet) | ~$10-30 per document | N/A | P2 |

## Appendix C: Backward Compatibility

All new features default to disabled or current behavior:

| Config Field | Default Value | Current Behavior Preserved? |
|-------------|---------------|---------------------------|
| `contextualEnrichment` | `"static"` | Yes (existing prefix behavior) |
| `queryExpansion` | `"none"` | Yes (raw query embedding) |
| `queryDecomposition` | `false` | Yes (single query search) |
| `graphExtraction` | `false` | Yes (no graph) |
| `modalityType` | `"text"` | Yes (text-only) |
| `chunkConfig.method` | `"recursive"` | Yes (existing method) |

Existing knowledge bases will not be affected by the migration. All new columns have safe defaults. No data migration is needed for existing chunks. Re-processing documents is only required to benefit from contextual enrichment or graph extraction.
