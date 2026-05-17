import { describe, it, expect } from "vitest";
import { validateProviderUrl } from "@/lib/services/validate-provider-url";

describe("validateProviderUrl", () => {
  // ── Happy path ──────────────────────────────────────────────────────
  describe("happy path", () => {
    it("should accept a valid HTTPS URL", () => {
      const result = validateProviderUrl("https://api.openai.com");
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe("api.openai.com");
    });

    it("should accept a valid HTTP URL with port", () => {
      const result = validateProviderUrl("http://api.example.com:8080");
      expect(result).toBeInstanceOf(URL);
      expect(result.port).toBe("8080");
    });

    it("should accept a valid HTTPS URL with path", () => {
      const result = validateProviderUrl("https://api.anthropic.com/v1");
      expect(result).toBeInstanceOf(URL);
      expect(result.pathname).toBe("/v1");
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("should accept a URL with trailing slash", () => {
      const result = validateProviderUrl("https://api.openai.com/");
      expect(result).toBeInstanceOf(URL);
      expect(result.pathname).toBe("/");
    });

    it("should accept a URL with query params", () => {
      const result = validateProviderUrl("https://api.example.com?key=value");
      expect(result).toBeInstanceOf(URL);
      expect(result.search).toBe("?key=value");
    });
  });

  // ── Error cases ─────────────────────────────────────────────────────
  describe("error cases", () => {
    it("should throw for a malformed URL", () => {
      expect(() => validateProviderUrl("not-a-url")).toThrow("Invalid provider URL");
    });

    it("should throw for FTP scheme", () => {
      expect(() => validateProviderUrl("ftp://server")).toThrow("Blocked URL scheme");
    });
  });

  // ── Security: loopback ──────────────────────────────────────────────
  describe("security — loopback addresses", () => {
    it("should block http://localhost", () => {
      expect(() => validateProviderUrl("http://localhost")).toThrow("Blocked");
    });

    it("should block http://127.0.0.1", () => {
      expect(() => validateProviderUrl("http://127.0.0.1")).toThrow("Blocked");
    });

    it("should block http://0.0.0.0", () => {
      expect(() => validateProviderUrl("http://0.0.0.0")).toThrow("Blocked");
    });

    it("should block http://[::1] (IPv6 loopback)", () => {
      expect(() => validateProviderUrl("http://[::1]")).toThrow("Blocked");
    });
  });

  // ── Security: private IPs ──────────────────────────────────────────
  describe("security — private IP ranges", () => {
    it("should block 10.0.0.1 (10.0.0.0/8)", () => {
      expect(() => validateProviderUrl("http://10.0.0.1")).toThrow("Blocked");
    });

    it("should block 172.16.0.1 (172.16.0.0/12)", () => {
      expect(() => validateProviderUrl("http://172.16.0.1")).toThrow("Blocked");
    });

    it("should allow 172.15.255.255 (NOT private — 172.15 is public)", () => {
      const result = validateProviderUrl("http://172.15.255.255");
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe("172.15.255.255");
    });

    it("should block 192.168.1.1 (192.168.0.0/16)", () => {
      expect(() => validateProviderUrl("http://192.168.1.1")).toThrow("Blocked");
    });
  });

  // ── Security: cloud metadata ────────────────────────────────────────
  describe("security — cloud metadata endpoints", () => {
    it("should block 169.254.169.254 (cloud metadata IP)", () => {
      expect(() => validateProviderUrl("http://169.254.169.254")).toThrow("Blocked");
    });

    it("should block metadata.google.internal", () => {
      expect(() => validateProviderUrl("http://metadata.google.internal")).toThrow("Blocked");
    });
  });

  // ── Security: IPv6 private/reserved ──────────────────────────────────
  describe("security — IPv6 private and mapped addresses", () => {
    it("should block IPv6 link-local (fe80::1)", () => {
      expect(() => validateProviderUrl("http://[fe80::1]")).toThrow("Blocked");
    });

    it("should block IPv6 ULA (fd00::1)", () => {
      expect(() => validateProviderUrl("http://[fd00::1]")).toThrow("Blocked");
    });

    it("should block IPv4-mapped IPv6 (::ffff:192.168.1.1)", () => {
      expect(() => validateProviderUrl("http://[::ffff:192.168.1.1]")).toThrow("Blocked");
    });
  });

  // ── Security: additional cloud metadata ────────────────────────────
  describe("security — additional cloud metadata hosts", () => {
    it("should block metadata.google.com", () => {
      expect(() => validateProviderUrl("http://metadata.google.com")).toThrow("Blocked");
    });

    it("should block instance-data", () => {
      expect(() => validateProviderUrl("http://instance-data")).toThrow("Blocked");
    });

    it("should block subdomain of metadata.google.internal", () => {
      expect(() => validateProviderUrl("http://sub.metadata.google.internal")).toThrow("Blocked");
    });
  });

  // ── Security: boundary and edge ────────────────────────────────────
  describe("security — boundary cases", () => {
    it("should block 172.31.255.255 (upper boundary of 172.16.0.0/12)", () => {
      expect(() => validateProviderUrl("http://172.31.255.255")).toThrow("Blocked");
    });

    it("should throw for empty string", () => {
      expect(() => validateProviderUrl("")).toThrow();
    });
  });

  // ── Security: CGNAT & reserved ──────────────────────────────────────
  describe("security — CGNAT and reserved ranges", () => {
    it("should block 100.64.0.1 (CGNAT 100.64.0.0/10)", () => {
      expect(() => validateProviderUrl("http://100.64.0.1")).toThrow("Blocked");
    });

    it("should block 240.0.0.1 (reserved range)", () => {
      expect(() => validateProviderUrl("http://240.0.0.1")).toThrow("Blocked");
    });
  });
});
