import { describe, it, expect } from "vitest";
import { validatePassword, checkBreached } from "../src/password-policy";

describe("validatePassword", () => {
  // --- Happy path ---

  it("should return valid=true when password is 12+ chars with mixed case, numbers, and symbols", () => {
    const result = validatePassword("Tr0ub4dor&Ex!");

    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.errors).toHaveLength(0);
  });

  it("should return a high score for a strong passphrase", () => {
    const result = validatePassword("correct-horse-battery-staple-42!");

    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  // --- Edge cases ---

  it("should return valid=true when password is exactly 12 characters and strong", () => {
    // 12 chars, mixed case + number + symbol — strong enough for zxcvbn
    const result = validatePassword("kX9$mWp2rZ!q");

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should return valid=false when password is exactly 11 characters", () => {
    const result = validatePassword("kX9$mWp2rZ!");

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at least 12"))).toBe(true);
  });

  it("should return valid=true when password is exactly 128 characters", () => {
    // Build a 128-char password that is random enough to score well
    const base = "aB3$xY7!";
    const password = base.repeat(16); // 8 * 16 = 128

    expect(password).toHaveLength(128);

    const result = validatePassword(password);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should return valid=false when password is 129 characters", () => {
    const base = "aB3$xY7!";
    const password = base.repeat(16) + "Z"; // 129

    expect(password).toHaveLength(129);

    const result = validatePassword(password);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("128"))).toBe(true);
  });

  // --- Error cases ---

  it("should return errors when password is an empty string", () => {
    const result = validatePassword("");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("at least 12"))).toBe(true);
  });

  it("should return valid=false for common password 'password123!'", () => {
    const result = validatePassword("password123!");

    expect(result.valid).toBe(false);
    expect(result.score).toBeLessThan(3);
  });

  it("should return errors for a very short password", () => {
    const result = validatePassword("abc");

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("at least 12"))).toBe(true);
  });

  // --- Security cases ---

  it("should penalize password containing user's email via userInputs", () => {
    const email = "dhilip@example.com";
    // Password built around the user's email
    const password = "dhilip@example.com99!!";

    const withEmail = validatePassword(password, [email]);
    const withoutEmail = validatePassword(password, []);

    // When user email is provided as input, zxcvbn should score lower or equal
    expect(withEmail.score).toBeLessThanOrEqual(withoutEmail.score);
  });

  it("should return a low score for an all-lowercase 12-char password", () => {
    // Common dictionary-ish lowercase word repeated
    const result = validatePassword("abcdefghijkl");

    expect(result.score).toBeLessThan(3);
    expect(result.valid).toBe(false);
  });

  it("should return valid=false for a password of only repeated characters", () => {
    const result = validatePassword("aaaaaaaaaaaa"); // 12 a's

    expect(result.valid).toBe(false);
    expect(result.score).toBeLessThan(3);
  });

  it("should include suggestions or warning for a weak but long-enough password", () => {
    const result = validatePassword("password1234");

    expect(result.valid).toBe(false);
    // zxcvbn provides either a warning or suggestions for weak passwords
    const hasFeedback =
      result.warning !== null || result.suggestions.length > 0;
    expect(hasFeedback).toBe(true);
  });
});

describe("checkBreached", () => {
  // --- Happy path ---

  it("should return breached=false for a unique random password", async () => {
    // A password that is extremely unlikely to appear in any breach database
    const randomPassword = `zK!9x${Date.now()}Qw#${Math.random().toString(36)}`;

    const result = await checkBreached(randomPassword);

    expect(result.breached).toBe(false);
    expect(result.count).toBe(0);
  });

  // --- Edge cases ---

  it("should return breached=true for a known breached password 'password'", async () => {
    const result = await checkBreached("password");

    expect(result.breached).toBe(true);
    expect(result.count).toBeGreaterThan(0);
  });

  it("should return breached=true for '123456'", async () => {
    const result = await checkBreached("123456");

    expect(result.breached).toBe(true);
    expect(result.count).toBeGreaterThan(0);
  });
});
