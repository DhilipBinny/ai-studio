import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "../src/encryption";
import { randomBytes } from "crypto";

// Set up a valid 64-hex-char encryption key for tests
beforeAll(() => {
  const testKey = randomBytes(32).toString("hex"); // 64 hex chars
  process.env.ENCRYPTION_KEY = testKey;
  process.env.ENCRYPTION_KEY_VERSION = "1";
});

describe("encryptSecret / decryptSecret", () => {
  // --- Happy path ---

  it("should decrypt an encrypted value back to the original plaintext", () => {
    const plaintext = "sk-ant-api03-secret-key-value";

    const encrypted = encryptSecret(plaintext);
    const decrypted = decryptSecret(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should produce encrypted output matching v{n}:{iv}:{ct}:{tag} format", () => {
    const encrypted = encryptSecret("test-value");

    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatch(/^v\d+$/);
    // IV, ciphertext, and tag should be base64
    expect(parts[1]).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(parts[2]).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(parts[3]).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  // --- Edge cases ---

  it("should encrypt and decrypt an empty string", () => {
    const encrypted = encryptSecret("");
    const decrypted = decryptSecret(encrypted);

    expect(decrypted).toBe("");
    // Empty plaintext produces an empty ciphertext segment, so the
    // v{n}:{iv}:{ct}:{tag} regex in isEncrypted (which requires 1+ chars
    // per segment) returns false. The round-trip still works correctly.
    expect(encrypted.split(":")).toHaveLength(4);
    expect(encrypted).toMatch(/^v\d+:/);
  });

  it("should encrypt and decrypt a very long string (10KB)", () => {
    const longString = "A".repeat(10 * 1024);

    const encrypted = encryptSecret(longString);
    const decrypted = decryptSecret(encrypted);

    expect(decrypted).toBe(longString);
    expect(decrypted).toHaveLength(10 * 1024);
  });

  // --- Error cases ---

  it("should throw when decrypting a garbage string", () => {
    expect(() => decryptSecret("not-encrypted-at-all")).toThrow();
  });

  it("should throw when decrypting a string with wrong version prefix", () => {
    // Use a version that has no key configured
    const encrypted = encryptSecret("test");
    const tampered = encrypted.replace(/^v\d+/, "v999");

    expect(() => decryptSecret(tampered)).toThrow(/version 999 not found/i);
  });

  // --- Tamper detection ---

  it("should throw when ciphertext segment is tampered", () => {
    const encrypted = encryptSecret("tamper-test-value");
    const parts = encrypted.split(":");
    // Flip a character in the ciphertext (index 2)
    const ct = parts[2];
    const flipped = ct[0] === "A" ? "B" + ct.slice(1) : "A" + ct.slice(1);
    const tampered = `${parts[0]}:${parts[1]}:${flipped}:${parts[3]}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("should throw when auth tag segment is tampered", () => {
    const encrypted = encryptSecret("tag-tamper-test");
    const parts = encrypted.split(":");
    // Flip a character in the auth tag (index 3)
    const tag = parts[3];
    const flipped = tag[0] === "A" ? "B" + tag.slice(1) : "A" + tag.slice(1);
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${flipped}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });

  // --- Security cases ---

  it("should produce different ciphertexts for the same plaintext (random IV)", () => {
    const plaintext = "identical-secret-value";

    const encrypted1 = encryptSecret(plaintext);
    const encrypted2 = encryptSecret(plaintext);

    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same value
    expect(decryptSecret(encrypted1)).toBe(plaintext);
    expect(decryptSecret(encrypted2)).toBe(plaintext);
  });
});

describe("isEncrypted", () => {
  // --- Happy path ---

  it("should return true for a valid encrypted string", () => {
    const encrypted = encryptSecret("some-secret");

    expect(isEncrypted(encrypted)).toBe(true);
  });

  // --- Edge cases ---

  it("should return false for plain text", () => {
    expect(isEncrypted("sk-ant-api03-my-key")).toBe(false);
  });

  it("should return false for a partial format like 'v1:abc'", () => {
    expect(isEncrypted("v1:abc")).toBe(false);
  });

  it("should return false for a partial format like 'v1:a:b:'", () => {
    expect(isEncrypted("v1:a:b:")).toBe(false);
  });
});
