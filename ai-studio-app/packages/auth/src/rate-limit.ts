interface WindowEntry {
  count: number;
  windowStart: number;
}

const MAX_ENTRIES = 10_000;

export class RateLimiter {
  private windows = new Map<string, WindowEntry>();
  private maxRequests: number;
  private windowMs: number;
  private checkCount = 0;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    this.checkCount++;
    if (this.checkCount % 1000 === 0) {
      this.forceEvict(now);
    } else {
      this.evictExpired(now);
    }

    const entry = this.windows.get(key);

    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.windows.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetAt: now + this.windowMs,
      };
    }

    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowStart + this.windowMs,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt: entry.windowStart + this.windowMs,
    };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private evictExpired(now: number): void {
    if (this.windows.size <= MAX_ENTRIES) return;
    this.forceEvict(now);
  }

  private forceEvict(now: number): void {
    for (const [key, entry] of this.windows) {
      if (now - entry.windowStart >= this.windowMs) {
        this.windows.delete(key);
      }
    }
  }
}
