import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = "http://localhost:3099";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookies = res.headers.getSetCookie();
  return { res, cookies, cookieHeader: cookies.join("; ") };
}

function uniqueSlug() {
  return `rbac-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// RBAC Integration Tests
// ---------------------------------------------------------------------------

describe.sequential("RBAC API", () => {
  let adminCookie: string;
  let viewerCookie: string;
  let viewerUserId: string;

  const testViewerEmail = `rbac-viewer-${Date.now()}@echoltech.com`;
  const testViewerPassword = "RbacTestViewer!2026Sec";

  const createdAgentIds: string[] = [];

  beforeAll(async () => {
    // Login as super_admin
    const adminLogin = await login("dhilip@echoltech.com", "dhilip1234");
    expect(adminLogin.res.status).toBe(200);
    adminCookie = adminLogin.cookieHeader;

    // Create a viewer user for testing RBAC
    const createUserRes = await fetch(`${BASE_URL}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        email: testViewerEmail,
        name: "RBAC Test Viewer",
        password: testViewerPassword,
        role: "viewer",
        profileId: "00000000-0000-0000-0000-000000000013", // Viewer profile
      }),
    });
    const createdUser = await createUserRes.json();
    expect(createUserRes.status).toBe(201);
    viewerUserId = createdUser.id;

    // Login as the viewer
    const viewerLogin = await login(testViewerEmail, testViewerPassword);
    expect(viewerLogin.res.status).toBe(200);
    viewerCookie = viewerLogin.cookieHeader;
  }, 20000);

  afterAll(async () => {
    // Cleanup: deactivate test agents
    for (const id of createdAgentIds) {
      try {
        await fetch(`${BASE_URL}/api/agents/${id}/deactivate`, {
          method: "POST",
          headers: { Cookie: adminCookie },
        });
      } catch {
        // best-effort cleanup
      }
    }

    // Cleanup: deactivate the test viewer user
    if (viewerUserId) {
      try {
        await fetch(`${BASE_URL}/api/users/${viewerUserId}/deactivate`, {
          method: "POST",
          headers: { Cookie: adminCookie },
        });
      } catch {
        // best-effort cleanup
      }
    }
  }, 15000);

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  describe("happy path", () => {
    it("should allow super_admin to GET and POST agents", async () => {
      // Act — GET
      const listRes = await fetch(`${BASE_URL}/api/agents`, {
        headers: { Cookie: adminCookie },
      });
      expect(listRes.status).toBe(200);

      // Act — POST
      const slug = uniqueSlug();
      const createRes = await fetch(`${BASE_URL}/api/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({ name: "Admin RBAC Agent", slug }),
      });
      const body = await createRes.json();
      expect(createRes.status).toBe(201);
      createdAgentIds.push(body.id);
    }, 10000);

    it("should allow viewer to GET agents (level 10)", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/agents`, {
        headers: { Cookie: viewerCookie },
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    }, 10000);

    it("should allow super_admin to set user to lower rank (member)", async () => {
      // Act — change viewer to member
      const res = await fetch(`${BASE_URL}/api/users/${viewerUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({ role: "member" }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body.role).toBe("member");

      // Revert back to viewer for subsequent tests
      const revertRes = await fetch(`${BASE_URL}/api/users/${viewerUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({ role: "viewer" }),
      });
      expect(revertRes.status).toBe(200);
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // Error Cases
  // -------------------------------------------------------------------------

  describe("error cases", () => {
    it("should deny viewer from POST agents (level 20) with 403", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: viewerCookie,
        },
        body: JSON.stringify({
          name: "Viewer Should Not Create",
          slug: uniqueSlug(),
        }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");
    }, 10000);

    it("should deny viewer from POST providers with 403", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: viewerCookie,
        },
        body: JSON.stringify({
          name: "Viewer Should Not Create Provider",
          providerType: "openai",
        }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe("security", () => {
    it("should block role escalation — super_admin cannot set user to super_admin rank", async () => {
      // Act — try to escalate viewer to super_admin
      const res = await fetch(`${BASE_URL}/api/users/${viewerUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({ role: "super_admin" }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(403);
      expect(body.code).toBe("ROLE_ESCALATION");
    }, 10000);

    it("should block self role change", async () => {
      // Arrange — get admin's own user ID
      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: adminCookie },
      });
      const meBody = await meRes.json();
      const adminUserId = meBody.user.id;

      // Act — try to change own role
      const res = await fetch(`${BASE_URL}/api/users/${adminUserId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({ role: "admin" }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(403);
      expect(body.code).toBe("SELF_ROLE_CHANGE");
    }, 10000);
  });
});
