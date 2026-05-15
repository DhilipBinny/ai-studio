/**
 * LLM Behavior Tests — End-to-end agent behavior verification.
 *
 * These tests send real messages to agents via the API and validate that the
 * agentic runtime produces structurally correct responses.  They require:
 *   - Dev server running at http://localhost:3099
 *   - At least one agent with an active provider/model
 *   - Valid login credentials
 *
 * Run:  cd ai-studio-app/web && npx vitest run __tests__/llm/
 *
 * NOTE: LLM outputs are non-deterministic.  Tests use structural assertions
 * (length > 0, contains keywords) rather than exact string matching.
 */

import { describe, it, expect, beforeAll, type TestContext } from "vitest";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3099";
const LOGIN_EMAIL = process.env.TEST_EMAIL ?? "dhilip@echoltech.com";
const LOGIN_PASSWORD = process.env.TEST_PASSWORD ?? "dhilip1234";

// ---------------------------------------------------------------------------
// Agent name-to-ID mapping — populated dynamically in beforeAll
// ---------------------------------------------------------------------------

interface AgentEntry {
  id: string;
  name: string;
  slug: string;
}

/**
 * Agent IDs discovered at runtime from GET /api/agents.
 *
 * Expected agents (cheap Haiku for general tests, Sonnet for persona):
 *   - Server Health Monitor  → claude-haiku-4-5  (has tools)
 *   - Tech Pulse Monitor     → claude-haiku-4-5  (has tools)
 *   - Coder                  → claude-sonnet-4-6
 *   - Code Reviewer          → claude-sonnet-4-6
 *   - Document Reviewer      → claude-sonnet-4-6 (has systemPrompt + persona)
 */
const AGENTS: Record<string, string> = {};

// Use the cheapest Haiku agent for most tests to minimize cost.
let DEFAULT_AGENT = "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SessionResult {
  sessionId: string;
  response: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  status: string;
  error?: string;
}

interface SessionDetail {
  id: string;
  status: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
  totalToolCalls: number;
  totalTurns: number;
  messages: Array<{ id: number; role: string; content: string }>;
}

interface MessageList {
  messages: Array<{
    id: number;
    role: string;
    content: string;
    createdAt: string;
  }>;
}

let cookies = "";
let authFailed = false;

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }

  // Extract Set-Cookie headers and flatten into a Cookie header value
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies
    .map((c) => c.split(";")[0])
    .join("; ");
}

/**
 * Fetch all agents and populate the AGENTS map by name.
 */
async function discoverAgents(): Promise<void> {
  const res = await fetch(`${BASE}/api/agents?pageSize=100`, {
    headers: { Cookie: cookies },
  });

  if (!res.ok) {
    throw new Error(`Agent discovery failed: ${res.status}`);
  }

  const body = await res.json();
  const agents: AgentEntry[] = body.data ?? [];

  // Map well-known agent names to their IDs
  const nameMap: Record<string, string> = {
    "Server Health Monitor": "serverHealth",
    "Tech Pulse Monitor": "techPulse",
    "Coder": "coder",
    "Code Reviewer": "codeReviewer",
    "Document Reviewer": "documentReviewer",
    "Test Writer": "testWriter",
    "Code Scout": "codeScout",
  };

  for (const agent of agents) {
    const key = nameMap[agent.name];
    if (key) {
      AGENTS[key] = agent.id;
    }
  }

  // DEFAULT_AGENT: prefer Server Health Monitor (Haiku, cheapest)
  DEFAULT_AGENT = AGENTS.serverHealth ?? AGENTS.techPulse ?? agents[0]?.id ?? "";

  if (!DEFAULT_AGENT) {
    throw new Error("No agents found in the system — cannot run LLM tests");
  }
}

async function sendMessage(
  agentId: string,
  message: string,
  sessionId?: string,
): Promise<SessionResult> {
  const url = sessionId
    ? `${BASE}/api/agents/${agentId}/sessions/${sessionId}/messages`
    : `${BASE}/api/agents/${agentId}/sessions`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`sendMessage failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<SessionResult>;
}

async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  const res = await fetch(`${BASE}/api/runs/${sessionId}`, {
    headers: { Cookie: cookies },
  });

  if (!res.ok) {
    throw new Error(`getSessionDetail failed: ${res.status}`);
  }

  return res.json() as Promise<SessionDetail>;
}

async function getSessionMessages(
  agentId: string,
  sessionId: string,
): Promise<MessageList> {
  const res = await fetch(
    `${BASE}/api/agents/${agentId}/sessions/${sessionId}/messages`,
    { headers: { Cookie: cookies } },
  );

  if (!res.ok) {
    throw new Error(`getSessionMessages failed: ${res.status}`);
  }

  return res.json() as Promise<MessageList>;
}

/**
 * Skip the current test if auth setup failed (dev server not running).
 * Uses vitest's ctx.skip() so skipped tests appear clearly in output.
 */
function skipIfNoAuth(ctx: TestContext): void {
  if (authFailed) {
    ctx.skip();
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  try {
    cookies = await login();
    await discoverAgents();
  } catch (err) {
    console.warn(
      `LLM test setup failed — dev server may not be running. Tests will be skipped. (${err})`,
    );
    authFailed = true;
  }
}, 15_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LLM Agent Behavior", () => {
  // 1. Agent responds to simple question
  it("agent responds to a simple question with non-empty text", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    const result = await sendMessage(DEFAULT_AGENT, "What is 2+2? Reply with just the number.");

    expect(result.sessionId).toBeTruthy();
    expect(result.status).toBe("waiting");
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.response).toContain("4");
  });

  // 2. Agent uses tools when appropriate
  it("agent uses tools when task requires them", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    // Server Health Monitor has exec_command and get_current_time tools.
    // Ask explicitly for the REAL current time to force tool usage —
    // vague phrasing lets the LLM answer from training data.
    const agentId = AGENTS.serverHealth ?? DEFAULT_AGENT;
    const result = await sendMessage(
      agentId,
      "Use your get_current_time tool to tell me the exact current date and time right now. Do not guess — you must call the tool.",
    );

    expect(result.sessionId).toBeTruthy();
    expect(result.response.length).toBeGreaterThan(0);

    // Verify tool usage via session detail
    const detail = await getSessionDetail(result.sessionId);
    expect(detail.totalToolCalls).toBeGreaterThan(0);
  });

  // 3. Session tracks token usage
  it("session tracks input and output tokens", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    const result = await sendMessage(DEFAULT_AGENT, "Say hello.");

    const detail = await getSessionDetail(result.sessionId);

    expect(detail.totalInputTokens).toBeGreaterThan(0);
    expect(detail.totalOutputTokens).toBeGreaterThan(0);
  });

  // 4. Session tracks cost
  it("session tracks cost (>= 0 for cloud providers)", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    const result = await sendMessage(DEFAULT_AGENT, "What is TypeScript?");

    const detail = await getSessionDetail(result.sessionId);
    const cost = parseFloat(detail.totalCostUsd);

    // Cloud providers (Anthropic) should have cost > 0.
    // Ollama would be 0. Either way, it should be a non-negative number.
    expect(cost).toBeGreaterThanOrEqual(0);
    // Since we are using Anthropic, cost should actually be positive.
    expect(cost).toBeGreaterThan(0);
  });

  // 5. Session status is correct after completion
  it("session status is 'waiting' after successful completion", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    const result = await sendMessage(DEFAULT_AGENT, "Say OK.");

    expect(result.status).toBe("waiting");

    const detail = await getSessionDetail(result.sessionId);
    expect(detail.status).toBe("waiting");
  });

  // 6. Agent follows system prompt / persona
  it("agent follows its persona in responses", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    // The Code Reviewer agent has persona: "code review specialist with a security focus"
    // and rules like "Categorize as Critical, Warning, or Info"
    const agentId = AGENTS.codeReviewer;
    if (!agentId) {
      console.warn("Skipping persona test: Code Reviewer agent not found");
      ctx.skip();
      return;
    }

    const result = await sendMessage(
      agentId,
      'Review this code:\n\n```typescript\nconst query = `SELECT * FROM users WHERE id = ${userId}`;\n```',
    );

    expect(result.response.length).toBeGreaterThan(0);

    // The code reviewer should flag the SQL injection vulnerability.
    // Check for structural indicators of a code review response.
    const lower = result.response.toLowerCase();
    const hasReviewIndicators =
      lower.includes("sql injection") ||
      lower.includes("security") ||
      lower.includes("critical") ||
      lower.includes("warning") ||
      lower.includes("vulnerability") ||
      lower.includes("parameterized") ||
      lower.includes("prepared statement");

    expect(hasReviewIndicators).toBe(true);
  });

  // 7. Multi-turn conversation — agent remembers context
  it("agent remembers context across multiple turns", { timeout: 60_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    // Turn 1: Introduce a fact
    const turn1 = await sendMessage(
      DEFAULT_AGENT,
      "Remember this number: 7742. I will ask about it later.",
    );
    expect(turn1.sessionId).toBeTruthy();
    expect(turn1.status).toBe("waiting");

    // Turn 2: Ask about the fact in the same session
    const turn2 = await sendMessage(
      DEFAULT_AGENT,
      "What was the number I asked you to remember?",
      turn1.sessionId,
    );

    expect(turn2.response.length).toBeGreaterThan(0);
    expect(turn2.response).toContain("7742");
  });

  // 8. Session has messages (user + assistant)
  it("session contains user and assistant messages", { timeout: 30_000 }, async (ctx) => {
    skipIfNoAuth(ctx);

    const result = await sendMessage(DEFAULT_AGENT, "Respond with OK.");

    const msgs = await getSessionMessages(DEFAULT_AGENT, result.sessionId);

    expect(msgs.messages.length).toBeGreaterThanOrEqual(2);

    const roles = msgs.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");

    // The first message should be the user's input
    const userMsg = msgs.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain("Respond with OK");

    // There should be at least one assistant message with content
    const assistantMsgs = msgs.messages.filter(
      (m) => m.role === "assistant" && m.content.length > 0,
    );
    expect(assistantMsgs.length).toBeGreaterThan(0);
  });
});
