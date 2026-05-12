import { zxcvbn, zxcvbnOptions } from "@zxcvbn-ts/core";
import * as zxcvbnCommonPackage from "@zxcvbn-ts/language-common";
import * as zxcvbnEnPackage from "@zxcvbn-ts/language-en";
import { createHash } from "node:crypto";
import { AUTH_CONFIG, EXTERNAL_URLS } from "./config";

zxcvbnOptions.setOptions({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

export const PASSWORD_POLICY = AUTH_CONFIG.password;

export interface PasswordValidationResult {
  valid: boolean;
  score: number;
  errors: string[];
  warning: string | null;
  suggestions: string[];
}

export function validatePassword(
  password: string,
  userInputs: string[] = []
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    errors.push(`Must be at least ${PASSWORD_POLICY.minLength} characters`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    errors.push(`Must be ${PASSWORD_POLICY.maxLength} characters or fewer`);
  }

  const result = zxcvbn(password, userInputs);
  const score = result.score;

  if (password.length >= PASSWORD_POLICY.minLength && score < PASSWORD_POLICY.minStrength) {
    errors.push("Password is too weak — try adding more unique words");
  }

  return {
    valid: errors.length === 0,
    score,
    errors,
    warning: result.feedback.warning || null,
    suggestions: result.feedback.suggestions || [],
  };
}

export async function checkBreached(password: string): Promise<{ breached: boolean; count: number }> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`${EXTERNAL_URLS.hibpApi}/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return { breached: false, count: 0 };

    const text = await res.text();
    for (const line of text.split("\n")) {
      const [hash, countStr] = line.trim().split(":");
      if (hash === suffix) {
        const count = parseInt(countStr, 10);
        return { breached: count > 0, count };
      }
    }
    return { breached: false, count: 0 };
  } catch {
    return { breached: false, count: 0 };
  }
}
