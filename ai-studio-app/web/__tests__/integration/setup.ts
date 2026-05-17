const BASE = "http://localhost:3099";

export interface AuthSession {
  cookieHeader: string;
  userId: string;
  role: string;
}

const sessionCache = new Map<string, AuthSession>();

export async function login(email: string, password: string): Promise<{ res: Response; cookieHeader: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  const cookies = res.headers.getSetCookie?.() || [];
  const cookieHeader = cookies.join("; ");
  return { res, cookieHeader };
}

export async function getAdminCookies(): Promise<string> {
  const cached = sessionCache.get("admin");
  if (cached) return cached.cookieHeader;

  const result = await login("dhilip@echoltech.com", "dhilip1234");
  if (result.res.status !== 200) {
    throw new Error(`Admin login failed: ${result.res.status}`);
  }
  const session: AuthSession = { cookieHeader: result.cookieHeader, userId: "", role: "super_admin" };
  sessionCache.set("admin", session);
  return session.cookieHeader;
}

export async function getViewerCookies(): Promise<string> {
  const cached = sessionCache.get("viewer");
  if (cached) return cached.cookieHeader;

  const result = await login("viewer@echoltech.com", "dhilip1234");
  if (result.res.status !== 200) {
    throw new Error(`Viewer login failed: ${result.res.status}`);
  }
  const session: AuthSession = { cookieHeader: result.cookieHeader, userId: "", role: "viewer" };
  sessionCache.set("viewer", session);
  return session.cookieHeader;
}

export async function authedFetch(path: string, cookies: string, options: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...options.headers as Record<string, string>, Cookie: cookies },
  });
}

export { BASE };
