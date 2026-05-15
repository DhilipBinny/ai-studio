import type { Chunk } from "./types";
import type { LLMCaller } from "./hyde";

export type { LLMCaller };

export interface EnrichmentConfig {
  mode: "none" | "static" | "llm";
  model?: string;
  concurrency?: number;
}

const CONTEXTUAL_PROMPT_TEMPLATE = (docText: string, chunkText: string) =>
  `<document>
${docText}
</document>

Here is a chunk from that document:
<chunk>
${chunkText}
</chunk>

Give a short, succinct context (1-2 sentences) to situate this chunk within the overall document.
Focus on: what topic/section this belongs to, what entity or concept it describes, and how it relates to surrounding content.
Do NOT summarize the chunk itself — describe its CONTEXT.

Context:`;

const MAX_DOC_CHARS = 8000;
const DEFAULT_CONCURRENCY = 5;

/**
 * Enrich chunks with contextual descriptions.
 *
 * Three modes:
 *  - "none": returns original chunk texts, null descriptions
 *  - "static": prepends [Document: fileName | Section: heading], null descriptions
 *  - "llm": calls LLM for each chunk, returns enriched texts with descriptions
 */
export async function enrichChunks(
  chunks: Chunk[],
  fullDocText: string,
  fileName: string,
  sectionHeading: string | undefined,
  config: EnrichmentConfig,
  llmCaller?: LLMCaller,
): Promise<{ enrichedTexts: string[]; descriptions: (string | null)[] }> {
  if (config.mode === "none") {
    return {
      enrichedTexts: chunks.map((c) => c.content),
      descriptions: chunks.map(() => null),
    };
  }

  if (config.mode === "static") {
    const prefix = sectionHeading
      ? `[Document: ${fileName} | Section: ${sectionHeading}]`
      : `[Document: ${fileName}]`;

    return {
      enrichedTexts: chunks.map((c) => `${prefix} ${c.content}`),
      descriptions: chunks.map(() => null),
    };
  }

  // mode === "llm"
  if (!llmCaller) {
    throw new Error("LLM caller is required for contextual enrichment in 'llm' mode");
  }

  const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
  const truncatedDoc = fullDocText.slice(0, MAX_DOC_CHARS);

  const enrichedTexts: string[] = new Array(chunks.length);
  const descriptions: (string | null)[] = new Array(chunks.length);

  // Simple concurrency limiter: process N chunks at a time
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (chunk, batchIdx) => {
        const idx = i + batchIdx;
        try {
          const prompt = CONTEXTUAL_PROMPT_TEMPLATE(truncatedDoc, chunk.content);
          const description = await llmCaller.call(prompt, {
            maxTokens: 150,
            temperature: 0.0,
          });
          const trimmedDescription = description.trim();
          return {
            idx,
            enrichedText: `${trimmedDescription}\n\n${chunk.content}`,
            description: trimmedDescription,
          };
        } catch (e) {
          // On failure, fall back to original text with no description
          console.warn(
            `Contextual enrichment failed for chunk ${idx}: ${(e as Error).message}`,
          );
          return {
            idx,
            enrichedText: chunk.content,
            description: null,
          };
        }
      }),
    );

    for (const result of batchResults) {
      enrichedTexts[result.idx] = result.enrichedText;
      descriptions[result.idx] = result.description;
    }
  }

  return { enrichedTexts, descriptions };
}
