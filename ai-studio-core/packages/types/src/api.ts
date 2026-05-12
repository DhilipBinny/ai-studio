/**
 * REST API request and response types.
 *
 * These types cover the key HTTP endpoints exposed by the gateway.
 */

/**
 * Response from `GET /api/health`.
 *
 * Returns basic server health information.
 */
export interface HealthResponse {
  /** Server status string (e.g. `'ok'`). */
  status: string;
  /** Software version. */
  version: string;
  /** Server uptime in seconds. */
  uptime: number;
  /** Memory usage snapshot. */
  memory: {
    /** Resident set size in bytes. */
    rss: number;
    /** V8 heap used in bytes. */
    heapUsed: number;
    /** V8 total heap in bytes. */
    heapTotal: number;
  };
}

/**
 * Request body for `POST /api/auth/login`.
 */
export interface LoginRequest {
  /** The API key / bearer token to authenticate with. */
  apiKey: string;
}

/**
 * Response from `POST /api/auth/login`.
 */
export interface LoginResponse {
  /** JWT or session token for subsequent requests. */
  token: string;
  /** Authenticated user information. */
  user: {
    id: string;
    role: string;
  };
}

/**
 * Request body for `POST /api/chat`.
 */
export interface ChatRequest {
  /** The user's message text. */
  message: string;
  /** Session ID to continue (omit to auto-resolve). */
  sessionId?: string;
  /** Model override for this request. */
  model?: string;
}

/**
 * Response from `POST /api/chat`.
 */
export interface ChatResponse {
  /** The assistant's reply text. */
  text: string | null;
  /** Session ID for the conversation. */
  sessionId: string;
  /** Token usage for this turn. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Media attachments from tool results. */
  media?: import('./message.js').MediaAttachment[];
}

/**
 * Standard error response returned by the API.
 */
export interface ErrorResponse {
  /** Human-readable error message. */
  error: string;
  /** HTTP status code. */
  statusCode: number;
}
