import { describe, it, expect } from "vitest";
import { hasPermission, canView, canManage } from "../src/rbac";
import type { AccessRights } from "@ais-app/types";

const superAdminRights: AccessRights = {
  DASHBOARD: 20,
  AGENTS: 20,
  TOOLS: 20,
  KNOWLEDGE: 20,
  WORKFLOWS: 20,
  CONNECTORS: 20,
  RUNS: 20,
  PROVIDERS: 20,
  USERS: 20,
  PROFILES: 20,
  AUDIT: 20,
  SETTINGS: 20,
};

const viewerRights: AccessRights = {
  DASHBOARD: 10,
  AGENTS: 10,
  TOOLS: 10,
  KNOWLEDGE: 10,
  WORKFLOWS: 10,
  CONNECTORS: 10,
  RUNS: 10,
  PROVIDERS: 10,
  USERS: 0,
  PROFILES: 0,
  AUDIT: 0,
  SETTINGS: 0,
};

describe("RBAC", () => {
  describe("hasPermission", () => {
    it("grants access when user level >= required level", () => {
      expect(hasPermission(superAdminRights, "AGENTS", 20)).toBe(true);
      expect(hasPermission(superAdminRights, "AGENTS", 10)).toBe(true);
      expect(hasPermission(superAdminRights, "AGENTS", 0)).toBe(true);
    });

    it("denies access when user level < required level", () => {
      expect(hasPermission(viewerRights, "USERS", 10)).toBe(false);
      expect(hasPermission(viewerRights, "USERS", 20)).toBe(false);
    });

    it("handles level 0 (no access)", () => {
      expect(hasPermission(viewerRights, "PROFILES", 10)).toBe(false);
      expect(hasPermission(viewerRights, "PROFILES", 0)).toBe(true);
    });
  });

  describe("canView", () => {
    it("returns true when permission >= 10", () => {
      expect(canView(viewerRights, "DASHBOARD")).toBe(true);
      expect(canView(superAdminRights, "USERS")).toBe(true);
    });

    it("returns false when permission < 10", () => {
      expect(canView(viewerRights, "USERS")).toBe(false);
    });
  });

  describe("canManage", () => {
    it("returns true when permission >= 20", () => {
      expect(canManage(superAdminRights, "AGENTS")).toBe(true);
    });

    it("returns false when permission < 20", () => {
      expect(canManage(viewerRights, "AGENTS")).toBe(false);
    });
  });
});
