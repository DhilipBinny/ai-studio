/**
 * Multimodal RAG — VLM Page Description Module
 *
 * Uses a vision-language model (VLM) to generate text descriptions of
 * document page images. These descriptions are then chunked and embedded
 * alongside extracted text, enabling search over visual content like
 * diagrams, charts, tables, and screenshots.
 *
 * This is the simplified approach (VLM describes page images) rather than
 * full ColPali multi-vector embeddings.
 */

const DEFAULT_CONCURRENCY = 3;

const VLM_PROMPT = `Describe this document page in detail. Include:
1. All text content visible on the page
2. Any diagrams, charts, or tables — describe their structure and data
3. Any code snippets or configuration examples
4. Visual layout and organization

Be thorough and factual. This description will be used for search indexing.`;

/**
 * Interface for calling a vision-language model to describe an image.
 * The application layer provides a concrete implementation using the
 * configured provider (Claude Sonnet, GPT-4V, etc.).
 */
export interface VLMCaller {
  describeImage(imagePath: string): Promise<string>;
}

export interface VisualChunk {
  pageNumber: number;
  description: string;
  pageImagePath: string;
  visualElements: string[];
}

/**
 * Known visual element keywords to detect in VLM descriptions.
 */
const VISUAL_ELEMENT_PATTERNS: Array<{ keyword: string; pattern: RegExp }> = [
  { keyword: "diagram", pattern: /\bdiagram\b/i },
  { keyword: "chart", pattern: /\bchart\b/i },
  { keyword: "table", pattern: /\btable\b/i },
  { keyword: "graph", pattern: /\bgraph\b/i },
  { keyword: "flowchart", pattern: /\bflowchart\b/i },
  { keyword: "screenshot", pattern: /\bscreenshot\b/i },
  { keyword: "image", pattern: /\bimage\b/i },
  { keyword: "figure", pattern: /\bfigure\b/i },
  { keyword: "illustration", pattern: /\billustration\b/i },
  { keyword: "code", pattern: /\bcode\s*(snippet|block|example)\b/i },
  { keyword: "formula", pattern: /\bformula\b/i },
  { keyword: "equation", pattern: /\bequation\b/i },
  { keyword: "architecture", pattern: /\barchitecture\b/i },
  { keyword: "schema", pattern: /\bschema\b/i },
  { keyword: "wireframe", pattern: /\bwireframe\b/i },
  { keyword: "map", pattern: /\bmap\b/i },
  { keyword: "timeline", pattern: /\btimeline\b/i },
  { keyword: "infographic", pattern: /\binfographic\b/i },
];

/**
 * Parse a VLM description to detect visual element types mentioned.
 */
function detectVisualElements(description: string): string[] {
  const found: string[] = [];
  for (const { keyword, pattern } of VISUAL_ELEMENT_PATTERNS) {
    if (pattern.test(description)) {
      found.push(keyword);
    }
  }
  return found;
}

/**
 * Extract visual chunks from document page images using a VLM.
 *
 * For each page image, calls the VLM to generate a text description,
 * then parses the description to detect visual element types.
 *
 * Errors on individual pages are caught and logged — failed pages are
 * skipped rather than crashing the entire pipeline.
 *
 * @param pages - Array of page images with page numbers and file paths
 * @param vlmCaller - Vision-language model caller
 * @param concurrency - Max concurrent VLM calls (default: 3)
 */
export async function extractVisualChunks(
  pages: Array<{ pageNumber: number; imagePath: string }>,
  vlmCaller: VLMCaller,
  concurrency?: number,
): Promise<VisualChunk[]> {
  if (pages.length === 0) {
    return [];
  }

  const maxConcurrent = concurrency ?? DEFAULT_CONCURRENCY;
  const results: VisualChunk[] = [];

  // Process pages in batches to respect concurrency limits
  for (let i = 0; i < pages.length; i += maxConcurrent) {
    const batch = pages.slice(i, i + maxConcurrent);

    const batchResults = await Promise.allSettled(
      batch.map(async (page) => {
        const description = await vlmCaller.describeImage(page.imagePath);

        if (!description || description.trim().length === 0) {
          console.warn(
            `VLM returned empty description for page ${page.pageNumber}, skipping`,
          );
          return null;
        }

        const visualElements = detectVisualElements(description);

        return {
          pageNumber: page.pageNumber,
          description: description.trim(),
          pageImagePath: page.imagePath,
          visualElements,
        } satisfies VisualChunk;
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value !== null) {
        results.push(result.value);
      } else if (result.status === "rejected") {
        console.warn(
          `VLM description failed for a page, skipping: ${
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          }`,
        );
      }
    }
  }

  return results;
}

/**
 * Returns the default VLM prompt used to describe document pages.
 * Exported for use by the application layer when constructing VLM calls.
 */
export function getVLMPrompt(): string {
  return VLM_PROMPT;
}
