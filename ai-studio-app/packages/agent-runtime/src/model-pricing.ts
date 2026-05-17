interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
}

const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 },
  "claude-opus-4-6": { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 },
  "claude-sonnet-4-6": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-opus-4-5-20251101": { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 },
  "claude-sonnet-4-5-20250929": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-haiku-4-5-20251001": { inputPerToken: 0.8 / 1_000_000, outputPerToken: 4 / 1_000_000 },
  "claude-opus-4-1-20250805": { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 },
  "claude-opus-4-20250514": { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 },
  "claude-sonnet-4-20250514": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-3-7-sonnet-20250219": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-3-5-sonnet-20241022": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-3-5-sonnet-20240620": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-3-5-haiku-20241022": { inputPerToken: 0.8 / 1_000_000, outputPerToken: 4 / 1_000_000 },
  "claude-3-opus-20240229": { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 },
  "claude-3-sonnet-20240229": { inputPerToken: 3 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "claude-3-haiku-20240307": { inputPerToken: 0.25 / 1_000_000, outputPerToken: 1.25 / 1_000_000 },
};

const OPENAI_PRICING: Record<string, ModelPricing> = {
  "gpt-4.1-2025-04-14": { inputPerToken: 2 / 1_000_000, outputPerToken: 8 / 1_000_000 },
  "gpt-4.1-mini-2025-04-14": { inputPerToken: 0.4 / 1_000_000, outputPerToken: 1.6 / 1_000_000 },
  "gpt-4.1-nano-2025-04-14": { inputPerToken: 0.1 / 1_000_000, outputPerToken: 0.4 / 1_000_000 },
  "gpt-4o-2024-11-20": { inputPerToken: 2.5 / 1_000_000, outputPerToken: 10 / 1_000_000 },
  "gpt-4o-2024-08-06": { inputPerToken: 2.5 / 1_000_000, outputPerToken: 10 / 1_000_000 },
  "gpt-4o-2024-05-13": { inputPerToken: 5 / 1_000_000, outputPerToken: 15 / 1_000_000 },
  "gpt-4o-mini-2024-07-18": { inputPerToken: 0.15 / 1_000_000, outputPerToken: 0.6 / 1_000_000 },
  "gpt-4-turbo-2024-04-09": { inputPerToken: 10 / 1_000_000, outputPerToken: 30 / 1_000_000 },
  "gpt-4-0125-preview": { inputPerToken: 10 / 1_000_000, outputPerToken: 30 / 1_000_000 },
  "gpt-4-1106-preview": { inputPerToken: 10 / 1_000_000, outputPerToken: 30 / 1_000_000 },
  "gpt-4-0613": { inputPerToken: 30 / 1_000_000, outputPerToken: 60 / 1_000_000 },
  "gpt-3.5-turbo-0125": { inputPerToken: 0.5 / 1_000_000, outputPerToken: 1.5 / 1_000_000 },
  "o3-2025-04-16": { inputPerToken: 2 / 1_000_000, outputPerToken: 8 / 1_000_000 },
  "o3-mini-2025-01-31": { inputPerToken: 1.1 / 1_000_000, outputPerToken: 4.4 / 1_000_000 },
  "o1-2024-12-17": { inputPerToken: 15 / 1_000_000, outputPerToken: 60 / 1_000_000 },
  "o1-mini-2024-09-12": { inputPerToken: 3 / 1_000_000, outputPerToken: 12 / 1_000_000 },
};

const GOOGLE_PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-pro-preview-05-06": { inputPerToken: 1.25 / 1_000_000, outputPerToken: 10 / 1_000_000 },
  "gemini-2.5-flash-preview-04-17": { inputPerToken: 0.15 / 1_000_000, outputPerToken: 0.6 / 1_000_000 },
  "gemini-2.0-flash": { inputPerToken: 0.1 / 1_000_000, outputPerToken: 0.4 / 1_000_000 },
  "gemini-1.5-pro": { inputPerToken: 1.25 / 1_000_000, outputPerToken: 5 / 1_000_000 },
  "gemini-1.5-flash": { inputPerToken: 0.075 / 1_000_000, outputPerToken: 0.3 / 1_000_000 },
};

const PROVIDER_PRICING: Record<string, Record<string, ModelPricing>> = {
  anthropic: ANTHROPIC_PRICING,
  openai: OPENAI_PRICING,
  google: GOOGLE_PRICING,
};

function fuzzyMatch(provider: string, modelId: string): ModelPricing | null {
  const table = PROVIDER_PRICING[provider];
  if (!table) return null;

  if (table[modelId]) return table[modelId];

  const base = modelId.replace(/:.*$/, "");
  if (table[base]) return table[base];

  for (const [key, pricing] of Object.entries(table)) {
    const keyBase = key.replace(/-\d{8}$/, "");
    const modelBase = modelId.replace(/-\d{8}$/, "");
    if (keyBase === modelBase) return pricing;
  }

  return null;
}

export function getModelPricing(
  provider: string,
  modelId: string,
  dbInputCost: string | null,
  dbOutputCost: string | null,
): ModelPricing {
  const dbInput = parseFloat(dbInputCost || "0");
  const dbOutput = parseFloat(dbOutputCost || "0");

  if (dbInput > 0 || dbOutput > 0) {
    return { inputPerToken: dbInput, outputPerToken: dbOutput };
  }

  if (provider === "ollama") {
    return { inputPerToken: 0, outputPerToken: 0 };
  }

  return fuzzyMatch(provider, modelId) || { inputPerToken: 0, outputPerToken: 0 };
}

export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number {
  return (inputTokens * pricing.inputPerToken) + (outputTokens * pricing.outputPerToken);
}
