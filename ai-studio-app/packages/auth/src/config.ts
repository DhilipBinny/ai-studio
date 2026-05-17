export const AUTH_CONFIG = {
  jwt: {
    accessTokenExpiry: "15m",
    accessTokenMaxAge: 15 * 60,
    refreshTokenDays: 7,
    refreshTokenMaxAge: 7 * 24 * 60 * 60,
    minSecretLength: 32,
  },
  password: {
    minLength: 12,
    maxLength: 128,
    minStrength: 3,
    historyCount: 5,
    resetTokenExpiryMinutes: 30,
  },
  otp: {
    validitySeconds: 300,
    maxResend: 5,
    blockDurationMinutes: 30,
  },
  rateLimit: {
    loginAttempts: 5,
    loginWindowMs: 15 * 60 * 1000,
  },
  lockout: {
    maxFailedAttempts: 10,
  },
} as const;

export const EXTERNAL_URLS = {
  hibpApi: "https://api.pwnedpasswords.com/range",
} as const;

export const APP_CONFIG = {
  baseUrl: process.env.APP_URL || "http://localhost:3099",
} as const;

export const PROVIDER_DEFAULTS = {
  anthropic: { baseUrl: "https://api.anthropic.com" },
  openai: { baseUrl: "https://api.openai.com/v1" },
  ollama: { baseUrl: "http://localhost:11434" },
  openai_compatible: { baseUrl: "" },
} as const;
