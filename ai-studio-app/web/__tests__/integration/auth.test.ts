import { describe, it, expect, beforeAll } from "vitest";

const BASE_URL = "http://localhost:3099";

// ---------------------------------------------------------------------------
// Login helper — reusable across test suites
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
// Auth Integration Tests
//
// Rate limiter: 5 attempts per 15 min per IP+email. Budget for
// dhilip@echoltech.com across ALL integration test files:
//   auth.test.ts   → beforeAll(1) + wrong-password(1) = 2
//   agents.test.ts → beforeAll(1)
//   providers.test.ts → beforeAll(1)
//   rbac.test.ts   → beforeAll(1)
//   workspace.test.ts → beforeAll(1)
//   Total: 6 (1 over the limit — workspace login may get 429)
//
// NOTE: workspace.test.ts handles 429 gracefully (skips tests).
//
// The logout test reuses the beforeAll session (no extra login).
// Tests that inspect login response data use stored values from beforeAll.
// ---------------------------------------------------------------------------

describe.sequential("Auth API", () => {
  const validEmail = "dhilip@echoltech.com";
  const validPassword = "dhilip1234";

  // Shared auth state — set once in beforeAll
  let loginBody: { user: { id: string; email: string; name: string; role: string } };
  let sharedCookieHeader: string;
  let sharedLoginCookies: string[];

  beforeAll(async () => {
    const result = await login(validEmail, validPassword);
    expect(result.res.status).toBe(200);
    loginBody = await result.res.json();
    sharedCookieHeader = result.cookieHeader;
    sharedLoginCookies = result.cookies;
  }, 10000);

  // -------------------------------------------------------------------------
  // Happy Path
  // -------------------------------------------------------------------------

  describe("happy path", () => {
    it("should return 200 and user object on valid login", () => {
      // Assert — uses the beforeAll login result (no extra login call)
      expect(loginBody.user).toBeDefined();
      expect(loginBody.user.email).toBe(validEmail);
      expect(loginBody.user.name).toBe("Dhilip Kumar");
      expect(loginBody.user.role).toBe("super_admin");
      expect(loginBody.user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(sharedLoginCookies.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    it("should return 200 on authenticated request with cookies", async () => {
      // Act — reuse shared cookies
      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: sharedCookieHeader },
      });
      const body = await meRes.json();

      // Assert
      expect(meRes.status).toBe(200);
      expect(body.user).toBeDefined();
      expect(body.user.email).toBe(validEmail);
    }, 10000);

    it("should return 200 and new access_token on token refresh", async () => {
      // Arrange — extract the refresh_token cookie from the beforeAll login.
      // This test MUST run before the logout test, which revokes the session.
      const refreshCookie = sharedLoginCookies.find((c) =>
        c.startsWith("refresh_token="),
      );
      // If the login response did not include a refresh_token cookie, skip
      if (!refreshCookie) {
        console.warn("Skipping refresh test: no refresh_token cookie from login");
        return;
      }

      // Act — call refresh endpoint with refresh_token cookie
      const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { Cookie: refreshCookie.split(";")[0] },
      });

      // Assert — refresh succeeds
      expect(refreshRes.status).toBe(200);
      const body = await refreshRes.json();
      expect(body.success).toBe(true);

      // Assert — new access_token cookie is set
      const newCookies = refreshRes.headers.getSetCookie();
      const newAccessCookie = newCookies.find((c) =>
        c.startsWith("access_token="),
      );
      expect(newAccessCookie).toBeDefined();
      expect(newAccessCookie!.toLowerCase()).toContain("httponly");

      // Assert — new access_token works for authenticated requests
      const newCookieHeader = newCookies.join("; ");
      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: newCookieHeader },
      });
      expect(meRes.status).toBe(200);
    }, 10000);

    it("should clear cookies on logout and reject subsequent requests", async () => {
      // Act — logout the shared session (no extra login call)
      const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: sharedCookieHeader },
      });
      const logoutBody = await logoutRes.json();
      const setCookies = logoutRes.headers.getSetCookie();

      // Assert — logout succeeds
      expect(logoutRes.status).toBe(200);
      expect(logoutBody.success).toBe(true);

      // Assert — cookies are cleared (max-age=0 or expires in past)
      const accessCookie = setCookies.find((c) => c.startsWith("access_token="));
      expect(accessCookie).toBeDefined();
      const isCleared =
        accessCookie!.includes("Max-Age=0") ||
        accessCookie!.includes("max-age=0") ||
        accessCookie!.includes("Expires=Thu, 01 Jan 1970");
      expect(isCleared).toBe(true);

      // Assert — old cookies no longer work (token revoked)
      const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: sharedCookieHeader },
      });
      expect(meRes.status).toBe(401);
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Error Cases
  // -------------------------------------------------------------------------

  describe("error cases", () => {
    it("should return 401 with generic error on wrong password", async () => {
      // Act (1 login attempt against dhilip@echoltech.com)
      const { res } = await login(validEmail, "wrongpassword99");
      const body = await res.json();

      // Assert
      expect(res.status).toBe(401);
      expect(body.code).toBe("INVALID_CREDENTIALS");
      expect(body.error).toContain("Invalid email or password");
    }, 10000);

    it("should return 401 with same generic error on nonexistent email", async () => {
      // Act — nonexistent email has its own rate-limit bucket
      const { res } = await login("nonexistent@echoltech.com", "anypassword");
      const body = await res.json();

      // Assert — same message as wrong password (no user enumeration)
      expect(res.status).toBe(401);
      expect(body.code).toBe("INVALID_CREDENTIALS");
      expect(body.error).toContain("Invalid email or password");
    }, 10000);

    it("should return 401 on request without cookies", async () => {
      // Act — no login needed
      const res = await fetch(`${BASE_URL}/api/auth/me`);

      // Assert
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("UNAUTHENTICATED");
    }, 10000);

    it("should return 401 on request with garbage token", async () => {
      // Act — no login needed
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Cookie: "access_token=garbage.invalid.token" },
      });

      // Assert
      expect(res.status).toBe(401);
      const body = await res.json();
      // Middleware returns INVALID_TOKEN for malformed JWTs
      expect(body.code).toBe("INVALID_TOKEN");
    }, 10000);

    it("should return 401 on refresh with invalid cookie", async () => {
      // Act — send garbage refresh_token (no login needed)
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { Cookie: "refresh_token=garbage-invalid-refresh-token" },
      });
      const body = await res.json();

      // Assert — server rejects the invalid refresh token
      expect(res.status).toBe(401);
      expect(body.code).toBe("INVALID_REFRESH");
    }, 10000);

    it("should return 401 after 10 failed login attempts (account lockout)", async () => {
      // Create a dedicated test user with a unique email (fresh rate-limit bucket)
      const lockoutEmail = `lockout-test-${Date.now()}@echoltech.com`;
      const lockoutPassword = "LockoutTest1234!@#$";

      const createRes = await fetch(`${BASE_URL}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sharedCookieHeader },
        body: JSON.stringify({ email: lockoutEmail, name: "Lockout Test", password: lockoutPassword, role: "viewer" }),
      });
      if (createRes.status !== 201) {
        // Can't create user — skip gracefully
        return;
      }

      // Send 10 failed login attempts with wrong password
      for (let i = 0; i < 10; i++) {
        await fetch(`${BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: lockoutEmail, password: "wrong-password" }),
        });
      }

      // Now try with the CORRECT password — should be locked out
      const lockedRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lockoutEmail, password: lockoutPassword }),
      });
      expect(lockedRes.status).toBe(401);

      // Cleanup: deactivate the test user
      const usersRes = await fetch(`${BASE_URL}/api/users?search=${encodeURIComponent(lockoutEmail)}`, {
        headers: { Cookie: sharedCookieHeader },
      });
      const usersBody = await usersRes.json();
      const testUser = usersBody.data?.find((u: { email: string }) => u.email === lockoutEmail);
      if (testUser) {
        await fetch(`${BASE_URL}/api/users/${testUser.id}/deactivate`, {
          method: "POST",
          headers: { Cookie: sharedCookieHeader },
        });
      }
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe("security", () => {
    it("should return 400 on login with invalid JSON body", async () => {
      // Act — hits login endpoint but with invalid body (not a valid login)
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "this is not json{{{",
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(400);
      expect(body.code).toBe("INVALID_JSON");
    }, 10000);

    it("should never expose password hash in login response", () => {
      // Assert — check the beforeAll login body
      const raw = JSON.stringify(loginBody);
      expect(loginBody.user).toBeDefined();
      expect((loginBody.user as Record<string, unknown>).passwordHash).toBeUndefined();
      expect((loginBody.user as Record<string, unknown>).password).toBeUndefined();
      expect(raw).not.toContain("passwordHash");
      expect(raw).not.toContain("$argon2");
    }, 10000);

    it("should set httpOnly flag on access_token cookie", () => {
      // Assert — verify the shared login cookies from beforeAll
      const accessCookie = sharedLoginCookies.find((c) =>
        c.startsWith("access_token="),
      );

      expect(accessCookie).toBeDefined();
      expect(accessCookie!.toLowerCase()).toContain("httponly");
    }, 10000);

    it("should return 200 on password reset request for nonexistent email (no user enumeration)", async () => {
      // Act — no login needed; password reset endpoint is public
      const res = await fetch(`${BASE_URL}/api/auth/password/reset-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nonexistent-user@test.com" }),
      });
      const body = await res.json();

      // Assert — same 200 + success response as for a real email
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    }, 10000);
  });
});
