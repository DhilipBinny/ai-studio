import { z } from "zod";

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
    method: z.enum(["recursive", "fixed", "parent_child"]).optional(),
    chunk_size: z.number().int().min(100).max(8000).optional(),
    chunk_overlap: z.number().int().min(0).max(2000).optional(),
    parent_chunk_size: z.number().int().min(500).max(16000).optional(),
    child_chunk_size: z.number().int().min(100).max(4000).optional(),
  }).optional(),
});

export const updateKnowledgeBaseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  rerankSource: z.enum(["builtin", "provider"]).nullable().optional(),
  rerankProviderId: z.string().uuid().nullable().optional(),
  rerankModel: z.string().max(100).nullable().optional(),
  chunkConfig: z.object({
    method: z.enum(["recursive", "fixed", "parent_child"]).optional(),
    chunk_size: z.number().int().min(100).max(8000).optional(),
    chunk_overlap: z.number().int().min(0).max(2000).optional(),
    parent_chunk_size: z.number().int().min(500).max(16000).optional(),
    child_chunk_size: z.number().int().min(100).max(4000).optional(),
  }).optional(),
});
