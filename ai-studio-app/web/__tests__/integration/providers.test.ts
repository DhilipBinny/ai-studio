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

function uniqueName() {
  return `test-provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Providers Integration Tests
// ---------------------------------------------------------------------------

describe.sequential("Providers API", () => {
  let cookieHeader: string;
  const createdProviderIds: string[] = [];

  beforeAll(async () => {
    const result = await login("dhilip@echoltech.com", "dhilip1234");
    expect(result.res.status).toBe(200);
    cookieHeader = result.cookieHeader;
  }, 10000);

  afterAll(async () => {
    // Cleanup: deactivate all test providers
    for (const id of createdProviderIds) {
      try {
        await fetch(`${BASE_URL}/api/providers/${id}/deactivate`, {
          method: "POST",
          headers: { Cookie: cookieHeader },
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
    it("should return 200 with masked apiKeyRef on GET /api/providers", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/providers`, {
        headers: { Cookie: cookieHeader },
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("page");

      // Every provider with an API key should show masked value
      for (const provider of body.data) {
        if (provider.apiKeyRef !== null) {
          expect(provider.apiKeyRef).toBe("****");
        }
      }
    }, 10000);

    it("should return 201 with masked apiKeyRef on POST /api/providers", async () => {
      // Arrange
      const name = uniqueName();
      const payload = {
        name,
        providerType: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKeyRef: "sk-test-key-that-should-be-encrypted",
        config: { orgId: "org-test" },
      };

      // Act
      const res = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.name).toBe(name);
      expect(body.providerType).toBe("openai");
      expect(body.apiKeyRef).toBe("****"); // masked
      expect(body.isActive).toBe(true);

      createdProviderIds.push(body.id);
    }, 10000);

    it("should return 200 with updated fields on PATCH /api/providers/{id}", async () => {
      // Arrange
      expect(createdProviderIds.length).toBeGreaterThan(0);
      const providerId = createdProviderIds[0];

      // Act
      const res = await fetch(`${BASE_URL}/api/providers/${providerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ status: "inactive" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("inactive");
      expect(body.apiKeyRef).toBe("****"); // still masked
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // Error Cases
  // -------------------------------------------------------------------------

  describe("error cases", () => {
    it("should return 409 on POST with duplicate name", async () => {
      // Arrange — create first provider
      const name = uniqueName();
      const first = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ name, providerType: "ollama" }),
      });
      const firstBody = await first.json();
      expect(first.status).toBe(201);
      createdProviderIds.push(firstBody.id);

      // Act — create second with same name
      const second = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({ name, providerType: "ollama" }),
      });
      const body = await second.json();

      // Assert
      expect(second.status).toBe(409);
      expect(body.code).toBe("NAME_EXISTS");
    }, 30000);
  });

  // -------------------------------------------------------------------------
  // Security — SSRF blocking
  // -------------------------------------------------------------------------

  describe("security", () => {
    it("should return 400 SSRF_BLOCKED for localhost baseUrl", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          name: uniqueName(),
          providerType: "custom",
          baseUrl: "http://localhost:8080/api",
        }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(400);
      expect(body.code).toBe("SSRF_BLOCKED");
    }, 10000);

    it("should return 400 SSRF_BLOCKED for cloud metadata IP 169.254.169.254", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          name: uniqueName(),
          providerType: "custom",
          baseUrl: "http://169.254.169.254/latest/meta-data/",
        }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(400);
      expect(body.code).toBe("SSRF_BLOCKED");
    }, 10000);

    it("should return 400 SSRF_BLOCKED for private IP 10.0.0.1", async () => {
      // Act
      const res = await fetch(`${BASE_URL}/api/providers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          name: uniqueName(),
          providerType: "custom",
          baseUrl: "http://10.0.0.1:9090/v1",
        }),
      });
      const body = await res.json();

      // Assert
      expect(res.status).toBe(400);
      expect(body.code).toBe("SSRF_BLOCKED");
    }, 10000);
  });
});
