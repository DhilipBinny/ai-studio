# 15 - Testing Standards & Guardrails

Rules every test must follow. Referenced by all test-writing agents.

---

## 1. Test Categories (every function gets all 4)

### A. Happy Path
- Normal input, expected output
- Confirms the feature WORKS as documented

### B. Edge Cases
- Empty input, null, undefined, boundary values
- Maximum lengths, zero, negative numbers
- Unicode, special characters, whitespace-only strings
- Single item arrays, empty arrays, deeply nested objects

### C. Error Cases
- Invalid input types (string where number expected)
- Missing required fields
- Malformed data (bad JSON, invalid URLs, truncated tokens)
- Confirms correct error type/message is thrown or returned

### D. Security / Loophole Cases
- **Injection:** SQL wildcards in search, prototype pollution keys (`__proto__`, `constructor`), path traversal (`../`)
- **Bypass:** Empty strings that pass truthiness, type coercion tricks, null byte injection
- **Silent failures:** Functions that swallow errors — verify they DO swallow (not crash) AND the caller handles the null/false return
- **Boundary enforcement:** Rate limits at exactly the threshold, token expiry at exact second, role hierarchy at same rank
- **Tenant isolation:** Wrong tenant ID returns empty/forbidden, not other tenant's data

---

## 2. Test Structure (AAA Pattern)

```typescript
it("should [expected behavior] when [condition]", () => {
  // Arrange — set up inputs and expected state
  const input = { ... };
  
  // Act — call the function under test
  const result = functionUnderTest(input);
  
  // Assert — verify the output
  expect(result).toEqual(expectedOutput);
});
```

### Naming Convention
- `describe("moduleName")` — top level, matches the module
- `describe("functionName()")` — nested, one per exported function
- `it("should ...")` — describes the behavior, not the implementation
- Group by: happy path first, then edge cases, then errors, then security

```typescript
describe("validateProviderUrl()", () => {
  describe("happy path", () => {
    it("should accept valid HTTPS URL", () => { ... });
    it("should accept valid HTTP URL", () => { ... });
  });
  
  describe("edge cases", () => {
    it("should handle URL with port number", () => { ... });
    it("should handle URL with trailing slash", () => { ... });
  });
  
  describe("error cases", () => {
    it("should throw on malformed URL", () => { ... });
    it("should throw on non-HTTP scheme", () => { ... });
  });
  
  describe("security", () => {
    it("should block localhost", () => { ... });
    it("should block 169.254.169.254 (cloud metadata)", () => { ... });
    it("should block private IP 10.x.x.x", () => { ... });
  });
});
```

---

## 3. What to Assert

### DO Assert
- Return values (exact match or structural match)
- Thrown error types and messages
- Side effects (DB inserts, function calls) via spies when needed
- That silent fallbacks return the documented fallback value (not crash)
- That security checks reject BEFORE processing (early return)

### DO NOT Assert
- Implementation details (internal variable names, call order of private functions)
- Console output or log messages
- Timing (use fake timers for time-dependent tests)
- Exact error message wording (use `toContain` for key phrases)

---

## 4. Silent Fallback Pattern

Many functions in this codebase fail silently by design. Test BOTH sides:

```typescript
// Test 1: Verify the fallback VALUE is correct
it("should return null on malformed JSON", async () => {
  const req = new Request("http://test", { body: "not json", method: "POST" });
  const result = await parseJsonBody(req);
  expect(result).toBeNull(); // not undefined, not throw
});

// Test 2: Verify the CALLER handles the null
it("should return 400 when parseJsonBody returns null", async () => {
  // ... test the route handler that calls parseJsonBody
  expect(response.status).toBe(400);
  expect(body.code).toBe("INVALID_JSON");
});
```

---

## 5. Security Test Patterns

### Injection Prevention
```typescript
it("should escape LIKE wildcards in search input", () => {
  expect(escapeLike("100%")).toBe("100\\%");
  expect(escapeLike("user_name")).toBe("user\\_name");
  expect(escapeLike("test\\value")).toBe("test\\\\value");
});
```

### Prototype Pollution Blocked
```typescript
it("should block __proto__ in template resolution", () => {
  const state = { data: { value: "safe" } };
  const result = resolveTemplate("{{__proto__.constructor}}", state);
  expect(result).toBe(""); // blocked, not executed
});
```

### Boundary Exact Threshold
```typescript
it("should reject at exactly max failed attempts", () => {
  // Set attempts to exactly threshold - 1 = allowed
  // Set attempts to exactly threshold = locked
});

it("should reject role assignment at equal rank (not just above)", () => {
  // admin (30) trying to set admin (30) = REJECTED
  // admin (30) trying to set member (20) = ALLOWED
});
```

### Path Traversal
```typescript
it("should block path traversal with ../", () => {
  expect(() => validatePath("../../../etc/passwd")).toThrow();
});

it("should block null byte injection", () => {
  expect(() => validatePath("file.txt\0.jpg")).toThrow();
});
```

---

## 6. Integration Test Rules

### Database
- Use the REAL dev database (not mocks) — tests must pass against actual PostgreSQL
- Each test creates its own data with unique identifiers
- Clean up after each test (delete created rows)
- Use `beforeAll` for shared setup, `afterAll` for cleanup
- Never rely on existing data — tests must be self-contained

### API Routes
- Use `fetch("http://localhost:3099/api/...")` against running dev server
- Authenticate via login endpoint, capture cookies
- Test both success AND failure paths per endpoint
- Verify response status codes, not just body content
- Verify audit log entries are created for write operations

### Tenant Isolation
```typescript
it("should not return other tenant's agents", async () => {
  // Login as tenant A
  const agentsA = await fetchAgents(cookiesA);
  // Login as tenant B
  const agentsB = await fetchAgents(cookiesB);
  // Verify no overlap
  const idsA = new Set(agentsA.map(a => a.id));
  agentsB.forEach(a => expect(idsA.has(a.id)).toBe(false));
});
```

---

## 7. LLM Test Rules

### Non-Deterministic — Use Structural Assertions
```typescript
// BAD: exact match (will flake)
expect(response.text).toBe("The capital of France is Paris.");

// GOOD: structural assertion
expect(response.text.toLowerCase()).toContain("paris");
expect(response.inputTokens).toBeGreaterThan(0);
expect(response.outputTokens).toBeGreaterThan(0);
```

### Use Cheap Models
- All LLM tests use `claude-haiku-4-5-20251001` or equivalent cheap model
- Set `maxTokens: 256` to limit cost
- Set `temperature: 0` for maximum determinism

### Retry on Flakes
- LLM tests get 2 retries (`retry: 2` in vitest config)
- If a test fails 3 times, it's a real issue

### What to Assert
- Tool was called (check tool_calls array)
- Response contains expected keywords
- Token counts are non-zero
- Cost is calculated (> $0 for non-Ollama)
- Session status transitions correctly

---

## 8. E2E Test Rules

### Playwright-based
- Use existing MCP Playwright tools
- Login once per test suite, reuse cookies
- Wait for elements, don't sleep
- Assert visible text, not DOM structure
- Take screenshots on failure for debugging

---

## 9. File Organization

```
ai-studio-app/
├── packages/
│   ├── auth/__tests__/              # Unit tests for auth module
│   │   ├── audit.test.ts            # (existing)
│   │   ├── rbac.test.ts             # (existing)
│   │   ├── rate-limit.test.ts       # (existing)
│   │   ├── password-policy.test.ts  # NEW
│   │   └── encryption.test.ts       # NEW
│   ├── agent-runtime/__tests__/     # Unit tests for runtime
│   │   ├── expression-engine.test.ts
│   │   ├── graph-builder.test.ts
│   │   ├── model-pricing.test.ts
│   │   └── risk-map.test.ts
│   └── validation/__tests__/        # Schema validation tests
│       └── schemas.test.ts
├── web/__tests__/
│   ├── unit/                        # Unit tests
│   │   ├── validate-provider-url.test.ts
│   │   ├── api-utils.test.ts
│   │   └── branding.test.ts
│   ├── integration/                 # API integration tests
│   │   ├── auth.test.ts
│   │   ├── agents.test.ts
│   │   ├── workflows.test.ts
│   │   └── providers.test.ts
│   ├── e2e/                         # Playwright E2E tests
│   │   ├── login.test.ts
│   │   ├── agents.test.ts
│   │   └── workflows.test.ts
│   └── llm/                         # LLM behavior tests
│       ├── agent-chat.test.ts
│       ├── tool-usage.test.ts
│       └── workflow-llm-node.test.ts
ai-studio-core/
└── packages/rag-engine/__tests__/   # Unit tests for RAG
    ├── chunker.test.ts
    ├── rrf.test.ts
    └── search.test.ts
```

---

## 10. Coverage Expectations

| Level | Target | Rationale |
|-------|--------|-----------|
| Unit tests | 90%+ for tested modules | Pure functions, deterministic |
| Integration tests | All CRUD + auth endpoints | Critical paths |
| E2E tests | 5 core user journeys | Regression safety net |
| LLM tests | 8 behavioral assertions | Agent quality gate |
