import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimiter } from "../src/rate-limit";

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new RateLimiter(3, 60_000);

    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").allowed).toBe(true);
  });

  it("blocks requests exceeding limit", () => {
    const limiter = new RateLimiter(2, 60_000);

    limiter.check("key1");
    limiter.check("key1");
    const result = limiter.check("key1");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks remaining count", () => {
    const limiter = new RateLimiter(5, 60_000);

    expect(limiter.check("key1").remaining).toBe(4);
    expect(limiter.check("key1").remaining).toBe(3);
    expect(limiter.check("key1").remaining).toBe(2);
  });

  it("isolates keys", () => {
    const limiter = new RateLimiter(1, 60_000);

    limiter.check("key1");
    expect(limiter.check("key2").allowed).toBe(true);
  });

  it("resets a key", () => {
    const limiter = new RateLimiter(1, 60_000);

    limiter.check("key1");
    expect(limiter.check("key1").allowed).toBe(false);

    limiter.reset("key1");
    expect(limiter.check("key1").allowed).toBe(true);
  });

  describe("window expiry (fake timers)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("allows requests again after windowMs elapses", () => {
      vi.useFakeTimers();
      const windowMs = 10_000;
      const limiter = new RateLimiter(1, windowMs);

      limiter.check("key1");
      expect(limiter.check("key1").allowed).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(windowMs + 1);

      expect(limiter.check("key1").allowed).toBe(true);
    });

    it("returns a resetAt value within windowMs of now", () => {
      vi.useFakeTimers();
      const windowMs = 30_000;
      const limiter = new RateLimiter(5, windowMs);

      const now = Date.now();
      const result = limiter.check("key1");

      expect(result.resetAt).toBeGreaterThanOrEqual(now);
      expect(result.resetAt).toBeLessThanOrEqual(now + windowMs);
    });

    it("remaining stays 0 after exhaustion", () => {
      vi.useFakeTimers();
      const limiter = new RateLimiter(2, 60_000);

      limiter.check("key1");
      limiter.check("key1");

      // All subsequent checks should have remaining === 0
      expect(limiter.check("key1").remaining).toBe(0);
      expect(limiter.check("key1").remaining).toBe(0);
      expect(limiter.check("key1").remaining).toBe(0);
    });
  });
});
