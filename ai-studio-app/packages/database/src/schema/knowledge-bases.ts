import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, bigint, bigserial, unique, index, customType } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { agents } from "./agents";
import { documentStatusEnum } from "./enums";

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string) {
    return JSON.parse(value);
  },
});

export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").default(""),
    embeddingModel: text("embedding_model").notNull().default("text-embedding-3-small"),
    embeddingDimension: integer("embedding_dimension").notNull().default(1536),
    chunkConfig: jsonb("chunk_config").notNull().default({}),
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
    tokenCount: integer("token_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_chunks_document").on(table.documentId),
    index("idx_chunks_tenant").on(table.tenantId),
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
