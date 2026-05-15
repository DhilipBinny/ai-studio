/**
 * RAGAS-style evaluation using LLM-as-judge.
 *
 * Implements four metrics:
 *   - Context Precision: are retrieved chunks relevant to the question?
 *   - Context Recall: did we retrieve all ground-truth facts? (requires ground truth)
 *   - Faithfulness: is the generated answer grounded in the context?
 *   - Answer Relevancy: does the answer address the question?
 *
 * All metrics return 0-1 scores. Parse failures default to 0.
 */

import type { LLMCaller } from "./hyde";
import type { SearchResult, Embedder } from "./interfaces";

// ── Public types ──

export interface EvaluationQuestion {
  question: string;
  groundTruth?: string;
}

export interface EvaluationResult {
  question: string;
  retrievedChunks: string[];
  generatedAnswer: string;
  scores: {
    contextPrecision: number;
    contextRecall: number | null;
    faithfulness: number;
    answerRelevancy: number;
  };
}

export interface EvaluationSummary {
  avgContextPrecision: number;
  avgContextRecall: number | null;
  avgFaithfulness: number;
  avgAnswerRelevancy: number;
  totalQuestions: number;
}

// ── Prompt templates ──

function contextPrecisionPrompt(question: string, chunks: string[]): string {
  const chunksText = chunks.map((c, i) => `Chunk ${i}:\n${c}`).join("\n---\n");
  return `Given a question and a set of retrieved context chunks, judge whether each chunk
is relevant to answering the question.

Question: ${question}

Chunks:
${chunksText}

For each chunk, respond with a JSON array of objects:
[{"chunk_index": 0, "relevant": true, "reason": "..."}, ...]

Only mark a chunk as relevant if it contains information that would help answer
the question. Tangentially related content is NOT relevant.

Respond ONLY with the JSON array, no other text.`;
}

function contextRecallPrompt(groundTruth: string, combinedContext: string): string {
  return `Given a ground truth answer and retrieved context chunks, determine what
fraction of the ground truth information is covered by the context.

Ground truth answer: ${groundTruth}

Retrieved context:
${combinedContext}

Break the ground truth into individual facts/claims, then check if each
is supported by the retrieved context. Respond as JSON:
{
  "claims": [
    {"claim": "...", "supported": true},
    {"claim": "...", "supported": false}
  ],
  "score": 0.75
}

Respond ONLY with the JSON object, no other text.`;
}

function faithfulnessPrompt(generatedAnswer: string, combinedContext: string): string {
  return `Given an answer and the context it was generated from, check if every claim
in the answer is supported by the context.

Answer: ${generatedAnswer}

Context:
${combinedContext}

Extract each factual claim from the answer, then check if it appears in or
can be inferred from the context. Respond as JSON:
{
  "claims": [
    {"claim": "...", "supported": true},
    {"claim": "...", "supported": false}
  ],
  "score": 0.80
}

Respond ONLY with the JSON object, no other text.`;
}

function answerRelevancyPrompt(answer: string): string {
  return `Given the following answer, generate exactly 3 questions that this answer could be responding to.
The questions should be diverse but closely related to the content of the answer.

Answer: ${answer}

Respond as a JSON array of exactly 3 strings:
["question 1", "question 2", "question 3"]

Respond ONLY with the JSON array, no other text.`;
}

function generateAnswerPrompt(question: string, context: string): string {
  return `Answer the following question using ONLY the provided context. If the context
does not contain enough information, say so but still provide your best answer
based on the available context.

Context:
${context}

Question: ${question}

Answer:`;
}

// ── Helpers ──

function safeParseJSON(text: string): unknown {
  try {
    // Try to extract JSON from the response if it contains extra text
    const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Metric implementations ──

async function scoreContextPrecision(
  question: string,
  chunks: string[],
  llm: LLMCaller,
): Promise<number> {
  if (chunks.length === 0) return 0;

  try {
    const prompt = contextPrecisionPrompt(question, chunks);
    const response = await llm.call(prompt, { maxTokens: 1000, temperature: 0.0 });
    const parsed = safeParseJSON(response);

    if (!Array.isArray(parsed)) return 0;

    const judgments = parsed as Array<{ chunk_index: number; relevant: boolean }>;
    const relevantCount = judgments.filter((j) => j.relevant === true).length;
    return relevantCount / chunks.length;
  } catch {
    return 0;
  }
}

async function scoreContextRecall(
  groundTruth: string,
  chunks: string[],
  llm: LLMCaller,
): Promise<number> {
  if (chunks.length === 0) return 0;

  try {
    const combinedContext = chunks.join("\n---\n");
    const prompt = contextRecallPrompt(groundTruth, combinedContext);
    const response = await llm.call(prompt, { maxTokens: 1000, temperature: 0.0 });
    const parsed = safeParseJSON(response) as { claims?: Array<{ supported: boolean }>; score?: number } | null;

    if (!parsed) return 0;

    if (typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 1) {
      return parsed.score;
    }

    if (Array.isArray(parsed.claims) && parsed.claims.length > 0) {
      const supported = parsed.claims.filter((c) => c.supported === true).length;
      return supported / parsed.claims.length;
    }

    return 0;
  } catch {
    return 0;
  }
}

async function scoreFaithfulness(
  generatedAnswer: string,
  chunks: string[],
  llm: LLMCaller,
): Promise<number> {
  if (chunks.length === 0 || !generatedAnswer.trim()) return 0;

  try {
    const combinedContext = chunks.join("\n---\n");
    const prompt = faithfulnessPrompt(generatedAnswer, combinedContext);
    const response = await llm.call(prompt, { maxTokens: 1000, temperature: 0.0 });
    const parsed = safeParseJSON(response) as { claims?: Array<{ supported: boolean }>; score?: number } | null;

    if (!parsed) return 0;

    if (typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 1) {
      return parsed.score;
    }

    if (Array.isArray(parsed.claims) && parsed.claims.length > 0) {
      const supported = parsed.claims.filter((c) => c.supported === true).length;
      return supported / parsed.claims.length;
    }

    return 0;
  } catch {
    return 0;
  }
}

async function scoreAnswerRelevancy(
  question: string,
  answer: string,
  embedder: Embedder,
  llm: LLMCaller,
): Promise<number> {
  if (!answer.trim()) return 0;

  try {
    const prompt = answerRelevancyPrompt(answer);
    const response = await llm.call(prompt, { maxTokens: 500, temperature: 0.3 });
    const parsed = safeParseJSON(response);

    if (!Array.isArray(parsed)) return 0;

    const generatedQuestions = (parsed as string[]).filter(
      (q) => typeof q === "string" && q.trim().length > 0,
    );

    if (generatedQuestions.length === 0) return 0;

    const allTexts = [question, ...generatedQuestions];
    const embeddings = await embedder.embed(allTexts, "query");

    if (embeddings.length < 2) return 0;

    const originalEmb = embeddings[0];
    const similarities = embeddings.slice(1).map((emb) => cosineSimilarity(originalEmb, emb));

    const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
    return Math.max(0, Math.min(1, avgSimilarity));
  } catch {
    return 0;
  }
}

// ── Main evaluation function ──

export async function evaluateRAG(
  questions: EvaluationQuestion[],
  searchFn: (query: string) => Promise<SearchResult[]>,
  llmCaller: LLMCaller,
  embedder: Embedder,
): Promise<{ results: EvaluationResult[]; summary: EvaluationSummary }> {
  const results: EvaluationResult[] = [];

  for (const q of questions) {
    // Step 1: Retrieve chunks
    const searchResults = await searchFn(q.question);
    const chunks = searchResults.map((r) => r.content);

    // Step 2: Generate answer from retrieved context
    let generatedAnswer = "";
    try {
      const combinedContext = chunks.join("\n---\n");
      const answerPrompt = generateAnswerPrompt(q.question, combinedContext);
      generatedAnswer = await llmCaller.call(answerPrompt, {
        maxTokens: 500,
        temperature: 0.0,
      });
    } catch {
      generatedAnswer = "Failed to generate answer.";
    }

    // Step 3: Score all four metrics
    const [contextPrecision, faithfulness, answerRelevancy] = await Promise.all([
      scoreContextPrecision(q.question, chunks, llmCaller),
      scoreFaithfulness(generatedAnswer, chunks, llmCaller),
      scoreAnswerRelevancy(q.question, generatedAnswer, embedder, llmCaller),
    ]);

    // Context recall requires ground truth
    let contextRecall: number | null = null;
    if (q.groundTruth) {
      contextRecall = await scoreContextRecall(q.groundTruth, chunks, llmCaller);
    }

    results.push({
      question: q.question,
      retrievedChunks: chunks,
      generatedAnswer,
      scores: {
        contextPrecision,
        contextRecall,
        faithfulness,
        answerRelevancy,
      },
    });
  }

  // Compute summary
  const totalQuestions = results.length;

  const avgContextPrecision = totalQuestions > 0
    ? results.reduce((sum, r) => sum + r.scores.contextPrecision, 0) / totalQuestions
    : 0;

  const recallResults = results.filter((r) => r.scores.contextRecall !== null);
  const avgContextRecall = recallResults.length > 0
    ? recallResults.reduce((sum, r) => sum + (r.scores.contextRecall ?? 0), 0) / recallResults.length
    : null;

  const avgFaithfulness = totalQuestions > 0
    ? results.reduce((sum, r) => sum + r.scores.faithfulness, 0) / totalQuestions
    : 0;

  const avgAnswerRelevancy = totalQuestions > 0
    ? results.reduce((sum, r) => sum + r.scores.answerRelevancy, 0) / totalQuestions
    : 0;

  return {
    results,
    summary: {
      avgContextPrecision,
      avgContextRecall,
      avgFaithfulness,
      avgAnswerRelevancy,
      totalQuestions,
    },
  };
}
