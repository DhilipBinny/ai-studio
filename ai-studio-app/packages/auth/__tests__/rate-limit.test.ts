import { describe, it, expect } from "vitest";
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
});
