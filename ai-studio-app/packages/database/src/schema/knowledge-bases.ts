import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, bigint, bigserial, real, unique, index, customType } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { agents } from "./agents";
import { providers } from "./providers";
import { documentStatusEnum } from "./enums";

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown) {
    return JSON.parse(value as string);
  },
});

// tsvector column is managed by a PostgreSQL trigger (trg_chunks_search_vector).
// We don't include it in the Drizzle schema to avoid insert conflicts —
// the trigger auto-populates it from the content column on INSERT/UPDATE.

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    embeddingSource: text("embedding_source").notNull().default("builtin"),
    embeddingProviderId: uuid("embedding_provider_id").references(() => providers.id, { onDelete: "set null" }),
    embeddingModel: text("embedding_model").notNull().default("Xenova/bge-small-en-v1.5"),
    embeddingDimension: integer("embedding_dimension").notNull().default(384),
    rerankSource: text("rerank_source"),
    rerankProviderId: uuid("rerank_provider_id").references(() => providers.id, { onDelete: "set null" }),
    rerankModel: text("rerank_model"),
    chunkConfig: jsonb("chunk_config").notNull().default({}),
    contextualEnrichment: text("contextual_enrichment").notNull().default("static"),
    contextualModel: text("contextual_model"),
    queryExpansion: text("query_expansion").notNull().default("none"),
    queryExpansionModel: text("query_expansion_model"),
    queryDecomposition: boolean("query_decomposition").notNull().default(false),
    graphExtraction: boolean("graph_extraction").notNull().default(false),
    graphExtractionModel: text("graph_extraction_model"),
    modalityType: text("modality_type").notNull().default("text"),
    documentCount: integer("document_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.name),
    index("idx_kb_tenant").on(table.tenantId),
  ]
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull().default(0),
    storagePath: text("storage_path").notNull(),
    status: documentStatusEnum("status").notNull().default("uploaded"),
    chunkCount: integer("chunk_count").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").notNull().default({}),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_documents_tenant").on(table.tenantId),
    index("idx_documents_kb").on(table.knowledgeBaseId),
    index("idx_documents_status").on(table.knowledgeBaseId, table.status),
  ]
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    chunkType: text("chunk_type").notNull().default("standard"),
    parentChunkId: bigint("parent_chunk_id", { mode: "number" }),
    tokenCount: integer("token_count").notNull().default(0),
    contextualDescription: text("contextual_description"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chunks_document").on(table.documentId),
    index("idx_chunks_tenant").on(table.tenantId),
  ]
);

export const ragEvaluations = pgTable(
  "rag_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    evaluationModel: text("evaluation_model").notNull(),
    questionCount: integer("question_count").notNull().default(0),
    summary: jsonb("summary").notNull().default({}),
    results: jsonb("results").notNull().default([]),
    kbConfigSnapshot: jsonb("kb_config_snapshot").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_rag_evaluations_kb").on(table.knowledgeBaseId),
    index("idx_rag_evaluations_tenant").on(table.tenantId),
    index("idx_rag_evaluations_created").on(table.knowledgeBaseId, table.createdAt),
  ]
);

export const graphEntities = pgTable(
  "graph_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    sourceChunkId: bigint("source_chunk_id", { mode: "number" }).notNull().references(() => documentChunks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entityType: text("entity_type").notNull(),
    description: text("description").notNull(),
    embedding: vector("embedding"),
    mentionCount: integer("mention_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_graph_entities_kb").on(table.knowledgeBaseId),
    index("idx_graph_entities_tenant").on(table.tenantId),
    index("idx_graph_entities_name").on(table.knowledgeBaseId, table.name),
  ]
);

export const graphRelationships = pgTable(
  "graph_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    sourceEntityId: uuid("source_entity_id").notNull().references(() => graphEntities.id, { onDelete: "cascade" }),
    targetEntityId: uuid("target_entity_id").notNull().references(() => graphEntities.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    description: text("description").notNull(),
    weight: real("weight").notNull().default(1.0),
    sourceChunkId: bigint("source_chunk_id", { mode: "number" }).notNull().references(() => documentChunks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_graph_relationships_kb").on(table.knowledgeBaseId),
    index("idx_graph_relationships_source").on(table.sourceEntityId),
    index("idx_graph_relationships_target").on(table.targetEntityId),
  ]
);

export const agentKnowledgeBases = pgTable(
  "agent_knowledge_bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    knowledgeBaseId: uuid("knowledge_base_id").notNull().references(() => knowledgeBases.id, { onDelete: "cascade" }),
    searchConfig: jsonb("search_config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.tenantId, table.agentId, table.knowledgeBaseId),
    index("idx_agent_kb_agent").on(table.agentId),
    index("idx_agent_kb_kb").on(table.knowledgeBaseId),
  ]
);
