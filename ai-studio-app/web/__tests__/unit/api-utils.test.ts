import { describe, it, expect } from "vitest";
import { escapeLike, parseJsonBody, errorResponse } from "@/lib/api-utils";

describe("escapeLike", () => {
  // ── Happy path ──────────────────────────────────────────────────────
  describe("happy path", () => {
    it("should return a normal string unchanged", () => {
      expect(escapeLike("hello world")).toBe("hello world");
    });

    it("should escape percent signs", () => {
      expect(escapeLike("100%")).toBe("100\\%");
    });

    it("should escape underscores", () => {
      expect(escapeLike("user_name")).toBe("user\\_name");
    });

    it("should escape backslashes", () => {
      expect(escapeLike("test\\value")).toBe("test\\\\value");
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("should return empty string for empty input", () => {
      expect(escapeLike("")).toBe("");
    });

    it("should escape all special characters in one string", () => {
      expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
    });
  });

  // ── Security ────────────────────────────────────────────────────────
  describe("security", () => {
    it("should escape wildcards in SQL injection attempts", () => {
      const input = "'; DROP TABLE--%";
      const result = escapeLike(input);
      expect(result).toBe("'; DROP TABLE--\\%");
      // Verify no unescaped % remains (strip escaped sequences, check nothing left)
      expect(result.replace(/\\%/g, "")).not.toContain("%");
    });
  });
});

describe("parseJsonBody", () => {
  // ── Happy path ──────────────────────────────────────────────────────
  describe("happy path", () => {
    it("should parse a valid JSON body", async () => {
      const request = new Request("http://test", {
        method: "POST",
        body: JSON.stringify({ name: "test", value: 42 }),
        headers: { "Content-Type": "application/json" },
      });

      const result = await parseJsonBody(request);
      expect(result).toEqual({ name: "test", value: 42 });
    });
  });

  // ── Error cases ─────────────────────────────────────────────────────
  describe("error cases", () => {
    it("should return null for invalid JSON", async () => {
      const request = new Request("http://test", {
        method: "POST",
        body: "not valid json {{{",
        headers: { "Content-Type": "application/json" },
      });

      const result = await parseJsonBody(request);
      expect(result).toBeNull();
    });

    it("should return null for empty body", async () => {
      const request = new Request("http://test", {
        method: "POST",
      });

      const result = await parseJsonBody(request);
      expect(result).toBeNull();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("should parse deeply nested JSON correctly", async () => {
      const nested = { a: { b: { c: { d: [1, 2, 3] } } } };
      const request = new Request("http://test", {
        method: "POST",
        body: JSON.stringify(nested),
        headers: { "Content-Type": "application/json" },
      });

      const result = await parseJsonBody(request);
      expect(result).toEqual(nested);
    });
  });
});

describe("errorResponse", () => {
  it("should return the correct JSON shape { error, code, details }", async () => {
    const details = { field: "email", reason: "invalid format" };
    const res = errorResponse("Validation failed", "VALIDATION_ERROR", 422, details);

    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body).toEqual({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: { field: "email", reason: "invalid format" },
    });
  });

  it("should return the correct status code", async () => {
    const res = errorResponse("Not found", "NOT_FOUND", 404);
    expect(res.status).toBe(404);
  });

  it("should work without details parameter", async () => {
    const res = errorResponse("Server error", "INTERNAL_ERROR", 500);

    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("Server error");
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.details).toBeUndefined();
  });
});
