export interface ConfigFieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "readonly";
  description?: string;
  default: string | number | boolean | null;
  options?: string[];
  min?: number;
  max?: number;
  required?: boolean;
}

export interface ConfigSectionDef {
  key: string;
  label: string;
  description: string;
  fields: ConfigFieldDef[];
}

export const SYSTEM_CONFIG_SCHEMA: ConfigSectionDef[] = [
  {
    key: "general",
    label: "General",
    description: "Application name and regional settings",
    fields: [
      { key: "app_name", label: "Application Name", type: "text", default: "Echol AI Studio", required: true },
      { key: "timezone", label: "Timezone", type: "select", default: "Asia/Singapore", options: [
        "Asia/Singapore", "Asia/Kolkata", "Asia/Tokyo", "Asia/Shanghai", "Asia/Dubai",
        "Europe/London", "Europe/Paris", "Europe/Berlin",
        "America/New_York", "America/Chicago", "America/Los_Angeles",
        "Australia/Sydney", "Pacific/Auckland", "UTC",
      ]},
    ],
  },
  {
    key: "auth",
    label: "Authentication",
    description: "Login security, 2FA, and lockout policies",
    fields: [
      { key: "enable_2fa", label: "Enable 2FA (OTP)", type: "boolean", default: false, description: "Require OTP verification after password login" },
      { key: "max_failed_attempts", label: "Max Failed Attempts", type: "number", default: 10, min: 3, max: 50, description: "Lock account after this many failed logins" },
      { key: "otp_validity_seconds", label: "OTP Validity (seconds)", type: "number", default: 300, min: 60, max: 900 },
      { key: "otp_max_resend", label: "OTP Max Resend", type: "number", default: 5, min: 1, max: 20 },
      { key: "otp_block_duration_minutes", label: "OTP Block Duration (minutes)", type: "number", default: 30, min: 5, max: 120, description: "Block OTP requests after max resends" },
    ],
  },
  {
    key: "billing",
    label: "Billing & Cost",
    description: "Cost tracking, margin factor, and usage reporting",
    fields: [
      { key: "cost_margin_factor", label: "Cost Margin Factor", type: "number", default: 1.0, min: 1.0, max: 10.0, description: "Multiplier applied to raw LLM costs. 1.0 = actual cost, 1.3 = 30% markup." },
      { key: "cost_currency", label: "Display Currency", type: "select", default: "USD", options: ["USD", "EUR", "GBP", "SGD", "INR", "JPY", "AUD"], description: "Currency label for cost display (costs are always calculated in USD)" },
    ],
  },
];

export function getConfigDefaults(sectionKey: string): Record<string, unknown> {
  const section = SYSTEM_CONFIG_SCHEMA.find((s) => s.key === sectionKey);
  if (!section) return {};
  return Object.fromEntries(section.fields.map((f) => [f.key, f.default]));
}

export function validateConfigValue(sectionKey: string, value: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const section = SYSTEM_CONFIG_SCHEMA.find((s) => s.key === sectionKey);
  if (!section) return { valid: false, errors: [`Unknown config key: ${sectionKey}`] };

  const errors: string[] = [];

  for (const field of section.fields) {
    const val = value[field.key];

    if (field.required && (val === undefined || val === null || val === "")) {
      errors.push(`${field.label} is required`);
      continue;
    }

    if (val === undefined || val === null) continue;

    if (field.type === "number" && typeof val === "number") {
      if (field.min !== undefined && val < field.min) errors.push(`${field.label} must be at least ${field.min}`);
      if (field.max !== undefined && val > field.max) errors.push(`${field.label} must be at most ${field.max}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
