import type { GatewayConfig, ModelCapabilities, CostEstimate } from '@ais/types';

// ══════════════════════════════════════════════
// Model capabilities registry
// ══════════════════════════════════════════════
// Primary source: config.models.capabilities (auto-fetched from APIs + admin edits)
// Fallback: safe defaults (vision: true, tools: true for modern LLMs)

/** Safe defaults for unknown models — assumes modern LLM capabilities. */
const MODEL_DEFAULTS: ModelCapabilities = {
  contextWindow: 128000,
  maxOutputTokens: 8192,
  timeoutMs: 120000,
  costPer1M: null,
  provider: 'unknown',
  supportsVision: true,
  supportsToolCalling: true,
  supportsStreaming: true,
  supportsThinking: false,
};

/**
 * Strip provider prefix from model reference.
 * "kairo-premium/claude-opus-4-7" → "claude-opus-4-7"
 * "anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
 * "claude-opus-4-7" → "claude-opus-4-7" (no prefix)
 */
function stripProviderPrefix(modelRef: string): string {
  const slashIdx = modelRef.indexOf('/');
  return slashIdx >= 0 ? modelRef.slice(slashIdx + 1) : modelRef;
}

/**
 * Look up capabilities for a model ID.
 * Priority:
 *   1. config.models.capabilities exact match (by bare model ID)
 *   2. config.models.capabilities substring match
 *   3. Safe defaults
 */
function getModelCapabilities(
  modelRef: string | undefined,
  config?: GatewayConfig,
): ModelCapabilities {
  if (!modelRef) return { ...MODEL_DEFAULTS };

  const bareId = stripProviderPrefix(modelRef);
  const caps = config?.models?.capabilities;

  if (caps) {
    // 1. Exact match
    if (caps[bareId]) {
      return { ...MODEL_DEFAULTS, ...caps[bareId] };
    }

    // 2. Exact match on full ref (backward compat)
    if (caps[modelRef] && modelRef !== bareId) {
      return { ...MODEL_DEFAULTS, ...caps[modelRef] };
    }

    // 3. Substring match — longest match wins
    const key = Object.keys(caps)
      .filter(k => bareId.includes(k) || modelRef.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key) {
      return { ...MODEL_DEFAULTS, ...caps[key] };
    }
  }

  return { ...MODEL_DEFAULTS };
}

/**
 * Parse Anthropic /v1/models response into capabilities entries.
 */
function parseAnthropicModels(
  data: { data?: Array<Record<string, unknown>> },
): Record<string, Partial<ModelCapabilities>> {
  const result: Record<string, Partial<ModelCapabilities>> = {};
  for (const m of data.data || []) {
    const id = m.id as string;
    if (!id) continue;

    const caps = m.capabilities as Record<string, Record<string, unknown>> | undefined;
    const isOpus = id.includes('opus');

    result[id] = {
      contextWindow: (m.max_input_tokens as number) || 200000,
      maxOutputTokens: (m.max_tokens as number) || (isOpus ? 16384 : 8192),
      supportsVision: caps?.image_input?.supported === true,
      supportsThinking: caps?.thinking?.supported === true,
      supportsToolCalling: true,
      supportsStreaming: true,
      timeoutMs: isOpus ? 180000 : 120000,
      provider: 'anthropic',
      displayName: (m.display_name as string) || id,
      source: 'auto' as const,
    };
  }
  return result;
}

/**
 * Parse Ollama /api/show response into capabilities entry.
 */
function parseOllamaModel(
  name: string,
  showData: Record<string, unknown>,
): Partial<ModelCapabilities> {
  const ollamaCaps = showData.capabilities as string[] | undefined;
  const modelInfo = showData.model_info as Record<string, unknown> | undefined;

  let contextWindow = 128000;
  if (modelInfo) {
    for (const [k, v] of Object.entries(modelInfo)) {
      if (k.endsWith('.context_length') && typeof v === 'number') {
        contextWindow = v;
        break;
      }
    }
  }

  return {
    contextWindow,
    maxOutputTokens: 8192,
    supportsVision: ollamaCaps?.includes('vision') ?? false,
    supportsToolCalling: ollamaCaps?.includes('tools') ?? false,
    supportsStreaming: true,
    supportsThinking: false,
    timeoutMs: 120000,
    provider: 'ollama',
    displayName: name,
    source: 'auto' as const,
  };
}

/**
 * Merge auto-fetched capabilities into config.
 *
 * Rules:
 *  - source: "manual" → skip entirely (admin owns all fields)
 *  - source: "auto"   → replace with fetched data, but carry forward
 *    costPer1M from existing entry (no provider API returns pricing)
 */
function mergeCapabilities(
  existing: Record<string, Partial<ModelCapabilities>>,
  fetched: Record<string, Partial<ModelCapabilities>>,
): Record<string, Partial<ModelCapabilities>> {
  const merged = { ...existing };
  for (const [id, caps] of Object.entries(fetched)) {
    if (merged[id]?.source === 'manual') continue;
    const existingCost = merged[id]?.costPer1M;
    merged[id] = caps;
    if (existingCost && !caps.costPer1M) merged[id].costPer1M = existingCost;
  }
  return merged;
}

/**
 * Estimate cost for token usage on a given model.
 * Returns { input, output, total } in dollars, or null if unknown.
 */
function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  config?: GatewayConfig,
): CostEstimate | null {
  const caps = getModelCapabilities(modelId, config);
  const rates = caps.costPer1M;
  if (!rates) return null;
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  return { input: inputCost, output: outputCost, total: inputCost + outputCost };
}

export {
  MODEL_DEFAULTS,
  getModelCapabilities,
  estimateCost,
  stripProviderPrefix,
  parseAnthropicModels,
  parseOllamaModel,
  mergeCapabilities,
};
