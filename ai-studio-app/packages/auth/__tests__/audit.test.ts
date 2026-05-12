import { describe, it, expect } from "vitest";
import { computeAuditHash } from "../src/audit";

describe("Audit Hash Chain", () => {
  it("computes a deterministic hash", () => {
    const hash1 = computeAuditHash({
      prevHash: "",
      action: "auth.login",
      userId: "user-1",
      resourceType: "user",
      resourceId: "user-1",
      details: { ip: "127.0.0.1" },
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    const hash2 = computeAuditHash({
      prevHash: "",
      action: "auth.login",
      userId: "user-1",
      resourceType: "user",
      resourceId: "user-1",
      details: { ip: "127.0.0.1" },
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes for different inputs", () => {
    const hash1 = computeAuditHash({
      prevHash: "",
      action: "auth.login",
      userId: "user-1",
      resourceType: null,
      resourceId: null,
      details: {},
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    const hash2 = computeAuditHash({
      prevHash: "",
      action: "auth.logout",
      userId: "user-1",
      resourceType: null,
      resourceId: null,
      details: {},
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    expect(hash1).not.toBe(hash2);
  });

  it("chains hashes correctly", () => {
    const firstHash = computeAuditHash({
      prevHash: "",
      action: "auth.login",
      userId: "user-1",
      resourceType: null,
      resourceId: null,
      details: {},
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    const secondHash = computeAuditHash({
      prevHash: firstHash,
      action: "user.create",
      userId: "user-1",
      resourceType: "user",
      resourceId: "user-2",
      details: { email: "new@example.com" },
      createdAt: "2026-05-12T00:01:00.000Z",
    });

    expect(secondHash).not.toBe(firstHash);
    expect(secondHash).toHaveLength(64);
  });

  it("prevents delimiter collision attacks", () => {
    const hash1 = computeAuditHash({
      prevHash: "",
      action: "foo|bar",
      userId: "baz",
      resourceType: null,
      resourceId: null,
      details: {},
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    const hash2 = computeAuditHash({
      prevHash: "",
      action: "foo",
      userId: "bar|baz",
      resourceType: null,
      resourceId: null,
      details: {},
      createdAt: "2026-05-12T00:00:00.000Z",
    });

    expect(hash1).not.toBe(hash2);
  });
});
