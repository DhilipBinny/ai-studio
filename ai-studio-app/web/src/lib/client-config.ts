export const PASSWORD_CONFIG = {
  minLength: 12,
  maxLength: 128,
  minStrength: 3,
} as const;

export const HIBP_API_URL = "https://api.pwnedpasswords.com/range";

export const PROVIDER_DEFAULTS = {
  anthropic: { baseUrl: "https://api.anthropic.com" },
  openai: { baseUrl: "https://api.openai.com/v1" },
  ollama: { baseUrl: "http://localhost:11434" },
  openai_compatible: { baseUrl: "" },
} as const;
