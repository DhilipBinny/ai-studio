/**
 * HyDE (Hypothetical Document Embeddings) — Query Expansion
 *
 * Before embedding a search query, an LLM generates a hypothetical answer.
 * The hypothetical answer is embedded instead of the raw query, producing
 * a vector that is semantically closer to actual document chunks.
 *
 * BM25 keyword search still uses the original raw query.
 */

export interface HyDEConfig {
  enabled: boolean;
  model?: string;
}

export interface LLMCaller {
  call(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string>;
}

const HYDE_PROMPT_TEMPLATE = `Answer the following question in a detailed paragraph, as if you were writing
a technical documentation page. Write factually even if you are not certain.
Do NOT say "I don't know" — write your best answer.

Question: {USER_QUERY}

Answer:`;

function buildHyDEPrompt(query: string): string {
  return HYDE_PROMPT_TEMPLATE.replace("{USER_QUERY}", query);
}

/**
 * Generate a hypothetical answer to the query using an LLM.
 * The hypothetical answer is intended to be embedded for vector search,
 * producing a richer embedding than the raw query alone.
 *
 * On failure (LLM error, timeout), returns the original query as fallback.
 */
export async function hydeExpand(
  query: string,
  llmCaller: LLMCaller,
): Promise<string> {
  try {
    const prompt = buildHyDEPrompt(query);
    const hypotheticalAnswer = await llmCaller.call(prompt, {
      maxTokens: 300,
      temperature: 0.0,
    });

    if (!hypotheticalAnswer || hypotheticalAnswer.trim().length === 0) {
      console.warn("HyDE expansion returned empty response, falling back to raw query");
      return query;
    }

    return hypotheticalAnswer.trim();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`HyDE expansion failed, falling back to raw query: ${message}`);
    return query;
  }
}
