import { describe, it, expect } from "vitest";
import { getModelPricing, calculateCost } from "../src/model-pricing";

// ---------------------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------------------

describe("getModelPricing", () => {
  // --- Happy paths ---

  it("should return correct rates for a known Anthropic model", () => {
    const pricing = getModelPricing("anthropic", "claude-opus-4-7", null, null);
    expect(pricing.inputPerToken).toBe(15 / 1_000_000);
    expect(pricing.outputPerToken).toBe(75 / 1_000_000);
  });

  it("should return correct rates for a known OpenAI model", () => {
    const pricing = getModelPricing("openai", "gpt-4o-2024-11-20", null, null);
    expect(pricing.inputPerToken).toBe(2.5 / 1_000_000);
    expect(pricing.outputPerToken).toBe(10 / 1_000_000);
  });

  it("should use DB costs when provided, overriding builtin table", () => {
    const pricing = getModelPricing(
      "anthropic",
      "claude-opus-4-7",
      "0.001",
      "0.002",
    );
    expect(pricing.inputPerToken).toBe(0.001);
    expect(pricing.outputPerToken).toBe(0.002);
  });

  it("should return $0 for Ollama regardless of model", () => {
    const pricing = getModelPricing("ollama", "llama3:70b", null, null);
    expect(pricing.inputPerToken).toBe(0);
    expect(pricing.outputPerToken).toBe(0);
  });

  // --- Edge cases ---

  it("should return $0 fallback for an unknown model and provider", () => {
    const pricing = getModelPricing("unknown_provider", "unknown_model", null, null);
    expect(pricing.inputPerToken).toBe(0);
    expect(pricing.outputPerToken).toBe(0);
  });

  it("should strip date suffix for fuzzy match", () => {
    // "claude-opus-4-5-20251101" is in the table directly, but let's test the
    // fuzzy-match path with a date suffix that isn't an exact match.
    // "claude-3-5-sonnet-20241022" is exact. Using "claude-3-5-sonnet-20250101"
    // should fuzzy-match to "claude-3-5-sonnet" base.
    const pricing = getModelPricing("anthropic", "claude-3-5-sonnet-20250101", null, null);
    // Should fuzzy match to claude-3-5-sonnet-20241022 (same base after stripping date)
    expect(pricing.inputPerToken).toBe(3 / 1_000_000);
    expect(pricing.outputPerToken).toBe(15 / 1_000_000);
  });

  it("should strip colon suffix for fuzzy match", () => {
    // "gpt-4o-2024-11-20:latest" should match "gpt-4o-2024-11-20"
    const pricing = getModelPricing("openai", "gpt-4o-2024-11-20:latest", null, null);
    expect(pricing.inputPerToken).toBe(2.5 / 1_000_000);
    expect(pricing.outputPerToken).toBe(10 / 1_000_000);
  });

  it("should use builtin table when DB costs are null", () => {
    const pricing = getModelPricing("anthropic", "claude-3-haiku-20240307", null, null);
    expect(pricing.inputPerToken).toBe(0.25 / 1_000_000);
    expect(pricing.outputPerToken).toBe(1.25 / 1_000_000);
  });

  it("should use builtin table when DB costs are zero strings", () => {
    // parseFloat("0") gives 0, so dbInput > 0 is false -> falls through to builtin
    const pricing = getModelPricing("anthropic", "claude-opus-4-7", "0", "0");
    expect(pricing.inputPerToken).toBe(15 / 1_000_000);
    expect(pricing.outputPerToken).toBe(75 / 1_000_000);
  });

  it("should return correct rates for a known Google model", () => {
    const pricing = getModelPricing("google", "gemini-2.0-flash", null, null);
    expect(pricing.inputPerToken).toBe(0.1 / 1_000_000);
    expect(pricing.outputPerToken).toBe(0.4 / 1_000_000);
  });
});

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

describe("calculateCost", () => {
  it("should calculate cost correctly with known rates", () => {
    const pricing = { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 };
    const cost = calculateCost(pricing, 1000, 500);
    // (1000 * 15/1M) + (500 * 75/1M) = 0.015 + 0.0375 = 0.0525
    expect(cost).toBeCloseTo(0.0525, 10);
  });

  it("should return $0 for zero tokens", () => {
    const pricing = { inputPerToken: 15 / 1_000_000, outputPerToken: 75 / 1_000_000 };
    expect(calculateCost(pricing, 0, 0)).toBe(0);
  });

  it("should return $0 for zero rates", () => {
    const pricing = { inputPerToken: 0, outputPerToken: 0 };
    expect(calculateCost(pricing, 1000, 500)).toBe(0);
  });

  it("should handle only input tokens", () => {
    const pricing = { inputPerToken: 10 / 1_000_000, outputPerToken: 30 / 1_000_000 };
    const cost = calculateCost(pricing, 5000, 0);
    expect(cost).toBeCloseTo(0.05, 10);
  });

  it("should handle only output tokens", () => {
    const pricing = { inputPerToken: 10 / 1_000_000, outputPerToken: 30 / 1_000_000 };
    const cost = calculateCost(pricing, 0, 5000);
    expect(cost).toBeCloseTo(0.15, 10);
  });
});
