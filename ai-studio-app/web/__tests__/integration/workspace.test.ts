import { describe, it, expect, beforeAll } from "vitest";

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

// ---------------------------------------------------------------------------
// Workspace Integration Tests
//
// Tests path traversal protection and input validation on the workspace API.
// Uses 1 login (dhilip@echoltech.com) — see auth.test.ts for full budget.
// If rate-limited (429), tests are skipped gracefully.
// ---------------------------------------------------------------------------

describe.sequential("Workspace API", () => {
  let cookieHeader: string;
  let rateLimited = false;

  beforeAll(async () => {
    const result = await login("dhilip@echoltech.com", "dhilip1234");
    if (result.res.status === 429) {
      console.warn(
        "Workspace tests: login rate-limited (429). Skipping all workspace tests.",
      );
      rateLimited = true;
      return;
    }
    expect(result.res.status).toBe(200);
    cookieHeader = result.cookieHeader;
  }, 10000);

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  describe("happy path", () => {
    it("should return 200 with files array on GET /api/workspace/files?scope=shared", async () => {
      if (rateLimited) return;

      // Act
      const res = await fetch(`${BASE_URL}/api/workspace/files?scope=shared`, {
        headers: { Cookie: cookieHeader },
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(body).toHaveProperty("files");
      expect(Array.isArray(body.files)).toBe(true);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Security — Path Traversal Protection
  // -------------------------------------------------------------------------

  describe("security", () => {
    it("should return 403 FORBIDDEN on path traversal via /api/workspace/files", async () => {
      if (rateLimited) return;

      // Act — attempt directory traversal to read /etc/passwd
      const res = await fetch(
        `${BASE_URL}/api/workspace/files?scope=agent&id=test&path=../../../etc/passwd`,
        { headers: { Cookie: cookieHeader } },
      );
      const body = await res.json();

      // Assert — server blocks path traversal
      expect(res.status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");
    }, 10000);

    it("should return 403 FORBIDDEN on path traversal via /api/workspace/file", async () => {
      if (rateLimited) return;

      // Act
      const res = await fetch(
        `${BASE_URL}/api/workspace/file?scope=agent&id=test&path=../../../etc/passwd`,
        { headers: { Cookie: cookieHeader } },
      );
      const body = await res.json();

      // Assert
      expect(res.status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");
    }, 10000);

    it("should return 403 FORBIDDEN on path traversal via /api/workspace/download", async () => {
      if (rateLimited) return;

      // Act
      const res = await fetch(
        `${BASE_URL}/api/workspace/download?scope=agent&id=test&path=../../../etc/passwd`,
        { headers: { Cookie: cookieHeader } },
      );
      const body = await res.json();

      // Assert
      expect(res.status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Error Cases — Input Validation
  // -------------------------------------------------------------------------

  describe("error cases", () => {
    it("should return 400 on GET /api/workspace/files without scope param", async () => {
      if (rateLimited) return;

      // Act — missing required scope parameter
      const res = await fetch(`${BASE_URL}/api/workspace/files`, {
        headers: { Cookie: cookieHeader },
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);

    it("should return 400 on GET /api/workspace/file without path param", async () => {
      if (rateLimited) return;

      // Act — scope and id present, but path is missing
      const res = await fetch(
        `${BASE_URL}/api/workspace/file?scope=agent&id=test`,
        { headers: { Cookie: cookieHeader } },
      );
      const body = await res.json();

      // Assert
      expect(res.status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    }, 10000);
  });
});
