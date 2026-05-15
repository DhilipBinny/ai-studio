import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/password/reset-request",
  "/api/auth/password/reset",
  "/api/auth/otp/verify",
  "/api/health",
  "/embed/",
];

function getSecret(): Uint8Array | null {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

function getAllowedOrigins(): string[] {
  const env = process.env.CORS_ALLOWED_ORIGINS;
  if (!env) return [];
  return env.split(",").map((o) => o.trim()).filter(Boolean);
}

function setCorsHeaders(request: NextRequest, response: NextResponse): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return;

  if (allowed.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Vary", "Origin");
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Handle CORS preflight for /api/v1/ routes (OPTIONS only)
  if (pathname.startsWith("/api/v1/") && request.method === "OPTIONS") {
    const preflightResponse = new NextResponse(null, { status: 204 });
    setCorsHeaders(request, preflightResponse);
    return preflightResponse;
  }

  // v1 routes use their own API key auth via authenticateApiKey() — skip JWT check
  // but still apply CORS headers on the response
  if (pathname.startsWith("/api/v1/")) {
    const response = NextResponse.next();
    setCorsHeaders(request, response);
    return response;
  }

  const token = request.cookies.get("access_token")?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required", code: "UNAUTHENTICATED" },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const secret = getSecret();
  if (!secret) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Server configuration error", code: "CONFIG_ERROR" },
        { status: 500 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret, { issuer: "ais", audience: "ais-app" });

    const response = NextResponse.next();
    response.headers.set("x-tenant-id", (payload.tid as string) || "");
    response.headers.set("x-user-id", (payload.sub as string) || "");
    response.headers.set("x-profile-id", (payload.pid as string) || "");
    return response;
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Invalid or expired token", code: "INVALID_TOKEN" },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
