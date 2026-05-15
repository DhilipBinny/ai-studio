import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:3099";
let cookies: string;

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "dhilip@echoltech.com",
      password: "dhilip1234",
    }),
    redirect: "manual",
  });

  expect(res.status).toBe(200);

  cookies = res.headers.getSetCookie().join("; ");
  expect(cookies).toContain("access_token");
});

/**
 * Helper: fetch a page with auth cookies and expect 200 + HTML content-type.
 */
async function expectPageLoads(path: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: cookies },
    redirect: "manual",
  });

  expect(res.status, `Expected 200 for ${path}, got ${res.status}`).toBe(200);

  const ct = res.headers.get("content-type") ?? "";
  expect(ct, `Expected HTML content-type for ${path}`).toContain("text/html");

  return res;
}

describe("E2E Smoke Tests", () => {
  describe("Authenticated pages", () => {
    it("Dashboard: GET /dashboard returns 200 with HTML", async () => {
      await expectPageLoads("/dashboard");
    });

    it("Agents: GET /agents returns 200 with HTML", { timeout: 15000 }, async () => {
      await expectPageLoads("/agents");
    });

    it("Workflows: GET /workflows returns 200 with HTML", async () => {
      await expectPageLoads("/workflows");
    });

    it("Runs: GET /runs returns 200 with HTML", async () => {
      await expectPageLoads("/runs");
    });

    it("Providers: GET /providers returns 200 with HTML", async () => {
      await expectPageLoads("/providers");
    });

    it("Workspace: GET /workspace returns 200 with HTML", async () => {
      await expectPageLoads("/workspace");
    });

    it("Users: GET /users returns 200 with HTML", async () => {
      await expectPageLoads("/users");
    });

    it("Settings: GET /settings returns 200 with HTML", async () => {
      await expectPageLoads("/settings");
    });

    it("Audit Log: GET /audit-log returns 200 with HTML", async () => {
      await expectPageLoads("/audit-log");
    });

    it("Connectors: GET /connectors returns 200 with HTML", async () => {
      await expectPageLoads("/connectors");
    });

    it("Tools: GET /tools returns 200 with HTML", async () => {
      await expectPageLoads("/tools");
    });

    it("Knowledge: GET /knowledge returns 200 with HTML", async () => {
      await expectPageLoads("/knowledge");
    });

    it("Scheduled: GET /scheduled returns 200 with HTML", async () => {
      await expectPageLoads("/scheduled");
    });
  });

  describe("Public pages", () => {
    it("Login page loads without auth", async () => {
      const res = await fetch(`${BASE}/login`, { redirect: "manual" });
      expect(res.status).toBe(200);

      const ct = res.headers.get("content-type") ?? "";
      expect(ct).toContain("text/html");
    });
  });

  describe("Auth enforcement", () => {
    it("Unauthenticated /dashboard redirects to /login", async () => {
      const res = await fetch(`${BASE}/dashboard`, { redirect: "manual" });

      expect([302, 307, 308]).toContain(res.status);

      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/login");
    });
  });

  describe("API health", () => {
    it("GET /api/health returns 200 with status healthy", async () => {
      const res = await fetch(`${BASE}/api/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe("healthy");
    });
  });
});
