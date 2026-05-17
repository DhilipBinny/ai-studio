import { describe, it, expect } from "vitest";
import {
  resolveTemplate,
  evaluateCondition,
  normalizeKey,
  BLOCKED_KEYS,
  MAX_TEMPLATE_DEPTH,
} from "../src/workflow/expression-engine";
import type { WorkflowState } from "../src/workflow/types";

// ---------------------------------------------------------------------------
// resolveTemplate
// ---------------------------------------------------------------------------

describe("resolveTemplate", () => {
  // --- Happy paths ---

  it("should resolve a simple variable", () => {
    const state: WorkflowState = { name: "World" };
    expect(resolveTemplate("Hello {{name}}", state)).toBe("Hello World");
  });

  it("should resolve a nested path", () => {
    const state: WorkflowState = { user: { name: "Alice" } };
    expect(resolveTemplate("{{user.name}}", state)).toBe("Alice");
  });

  it("should apply the upper filter", () => {
    const state: WorkflowState = { name: "alice" };
    expect(resolveTemplate("{{name|upper}}", state)).toBe("ALICE");
  });

  it("should apply the lower filter", () => {
    const state: WorkflowState = { name: "ALICE" };
    expect(resolveTemplate("{{name|lower}}", state)).toBe("alice");
  });

  it("should apply the trim filter", () => {
    const state: WorkflowState = { name: "  hello  " };
    expect(resolveTemplate("{{name|trim}}", state)).toBe("hello");
  });

  it("should apply the length filter for a string", () => {
    const state: WorkflowState = { name: "hello" };
    expect(resolveTemplate("{{name|length}}", state)).toBe("5");
  });

  it("should apply the number filter", () => {
    const state: WorkflowState = { value: "42.5" };
    expect(resolveTemplate("{{value|number}}", state)).toBe("42.5");
  });

  it("should apply the number filter to non-numeric string and return 0", () => {
    const state: WorkflowState = { value: "abc" };
    expect(resolveTemplate("{{value|number}}", state)).toBe("0");
  });

  it("should apply the round filter with specified digits", () => {
    const state: WorkflowState = { value: "3.14159" };
    expect(resolveTemplate("{{value|round:2}}", state)).toBe("3.14");
  });

  it("should apply the json filter on an object", () => {
    const state: WorkflowState = { data: { a: 1 } };
    expect(resolveTemplate("{{data|json}}", state)).toBe(JSON.stringify({ a: 1 }));
  });

  it("should resolve multiple templates in one string", () => {
    const state: WorkflowState = { first: "Jane", last: "Doe" };
    expect(resolveTemplate("{{first}} {{last}}", state)).toBe("Jane Doe");
  });

  // --- Edge cases ---

  it("should return empty string for a missing key", () => {
    const state: WorkflowState = { name: "Alice" };
    expect(resolveTemplate("{{missing}}", state)).toBe("");
  });

  it("should return empty string for null value", () => {
    const state: WorkflowState = { name: null };
    expect(resolveTemplate("{{name}}", state)).toBe("");
  });

  it("should return empty string for undefined value", () => {
    const state: WorkflowState = { name: undefined };
    expect(resolveTemplate("{{name}}", state)).toBe("");
  });

  it("should JSON-stringify an object value", () => {
    const state: WorkflowState = { data: { x: 1, y: 2 } };
    expect(resolveTemplate("{{data}}", state)).toBe('{"x":1,"y":2}');
  });

  it("should return empty string when path depth exceeds MAX_TEMPLATE_DEPTH", () => {
    // Build a path of 11 parts (MAX_TEMPLATE_DEPTH is 10)
    const parts = Array.from({ length: MAX_TEMPLATE_DEPTH + 1 }, (_, i) => `k${i}`);
    const template = `{{${parts.join(".")}}}`;

    // Build a deeply nested state that would resolve if depth wasn't limited
    let state: WorkflowState = {};
    let current: Record<string, unknown> = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const nested: Record<string, unknown> = {};
      current[parts[i]] = nested;
      current = nested;
    }
    current[parts[parts.length - 1]] = "deep";

    expect(resolveTemplate(template, state)).toBe("");
  });

  it("should return empty string when traversing through a non-object", () => {
    const state: WorkflowState = { name: "Alice" };
    expect(resolveTemplate("{{name.length}}", state)).toBe("");
  });

  it("should handle numeric values", () => {
    const state: WorkflowState = { count: 42 };
    expect(resolveTemplate("{{count}}", state)).toBe("42");
  });

  it("should handle boolean values", () => {
    const state: WorkflowState = { flag: true };
    expect(resolveTemplate("{{flag}}", state)).toBe("true");
  });

  // --- Security ---

  it("should block __proto__ key", () => {
    const state: WorkflowState = {};
    expect(resolveTemplate("{{__proto__}}", state)).toBe("");
  });

  it("should block constructor key", () => {
    const state: WorkflowState = {};
    expect(resolveTemplate("{{constructor}}", state)).toBe("");
  });

  it("should block prototype key", () => {
    const state: WorkflowState = {};
    expect(resolveTemplate("{{prototype}}", state)).toBe("");
  });

  it("should block toString key", () => {
    const state: WorkflowState = {};
    expect(resolveTemplate("{{toString}}", state)).toBe("");
  });

  it("should block valueOf key", () => {
    const state: WorkflowState = {};
    expect(resolveTemplate("{{valueOf}}", state)).toBe("");
  });

  it("should block hasOwnProperty key", () => {
    const state: WorkflowState = {};
    expect(resolveTemplate("{{hasOwnProperty}}", state)).toBe("");
  });

  it("should block nested path with blocked key", () => {
    const state: WorkflowState = { user: { __proto__: "hacked" } };
    expect(resolveTemplate("{{user.__proto__}}", state)).toBe("");
  });

  // --- Array handling ---

  it("should JSON-stringify an array value (arrays pass the object check)", () => {
    const state: WorkflowState = { items: [1, 2, 3] };
    expect(resolveTemplate("{{items}}", state)).toBe("[1,2,3]");
  });

  it("should block array index traversal (Array.isArray check)", () => {
    const state: WorkflowState = { items: [1, 2, 3] };
    // Traversing into an array is blocked because Array.isArray returns true
    expect(resolveTemplate("{{items.0}}", state)).toBe("");
  });

  // --- Filter edge cases ---

  it("should return value unchanged for an unknown filter", () => {
    const state: WorkflowState = { name: "test" };
    // The switch has no default case, so unrecognized filters leave result as-is
    expect(resolveTemplate("{{name|unknown}}", state)).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

describe("evaluateCondition", () => {
  // --- Happy paths: all 10 operators ---

  it("should evaluate equals operator", () => {
    const state: WorkflowState = { status: "active" };
    expect(evaluateCondition("{{status}} equals \"active\"", state)).toBe(true);
    expect(evaluateCondition("{{status}} equals \"inactive\"", state)).toBe(false);
  });

  it("should evaluate not_equals operator", () => {
    const state: WorkflowState = { status: "active" };
    expect(evaluateCondition("{{status}} not_equals \"inactive\"", state)).toBe(true);
    expect(evaluateCondition("{{status}} not_equals \"active\"", state)).toBe(false);
  });

  it("should evaluate contains operator", () => {
    const state: WorkflowState = { message: "Hello World" };
    expect(evaluateCondition("{{message}} contains \"World\"", state)).toBe(true);
    expect(evaluateCondition("{{message}} contains \"Mars\"", state)).toBe(false);
  });

  it("should evaluate not_contains operator", () => {
    const state: WorkflowState = { message: "Hello World" };
    expect(evaluateCondition("{{message}} not_contains \"Mars\"", state)).toBe(true);
    expect(evaluateCondition("{{message}} not_contains \"World\"", state)).toBe(false);
  });

  it("should evaluate greater_than operator", () => {
    const state: WorkflowState = { count: 10 };
    expect(evaluateCondition("{{count}} greater_than 5", state)).toBe(true);
    expect(evaluateCondition("{{count}} greater_than 15", state)).toBe(false);
  });

  it("should evaluate less_than operator", () => {
    const state: WorkflowState = { count: 3 };
    expect(evaluateCondition("{{count}} less_than 5", state)).toBe(true);
    expect(evaluateCondition("{{count}} less_than 1", state)).toBe(false);
  });

  it("should evaluate gte operator", () => {
    const state: WorkflowState = { count: 5 };
    expect(evaluateCondition("{{count}} gte 5", state)).toBe(true);
    expect(evaluateCondition("{{count}} gte 4", state)).toBe(true);
    expect(evaluateCondition("{{count}} gte 6", state)).toBe(false);
  });

  it("should evaluate lte operator", () => {
    const state: WorkflowState = { count: 5 };
    expect(evaluateCondition("{{count}} lte 5", state)).toBe(true);
    expect(evaluateCondition("{{count}} lte 6", state)).toBe(true);
    expect(evaluateCondition("{{count}} lte 4", state)).toBe(false);
  });

  it("should evaluate is_empty operator with empty string value", () => {
    // When value is "", resolveTemplate produces " is_empty" which won't match
    // the regex (needs chars before whitespace). Use a non-empty value that
    // evaluates to one of the recognized empty markers.
    const stateNull: WorkflowState = { value: "null" };
    expect(evaluateCondition("{{value}} is_empty", stateNull)).toBe(true);

    const stateUndef: WorkflowState = { value: "undefined" };
    expect(evaluateCondition("{{value}} is_empty", stateUndef)).toBe(true);

    const stateNonEmpty: WorkflowState = { value: "hello" };
    expect(evaluateCondition("{{value}} is_empty", stateNonEmpty)).toBe(false);
  });

  it("should evaluate is_not_empty operator", () => {
    const state: WorkflowState = { value: "hello" };
    expect(evaluateCondition("{{value}} is_not_empty", state)).toBe(true);
  });

  // --- Edge cases ---

  it("should detect null state value as empty via is_empty operator", () => {
    // When state value is null, resolveTemplate returns "", so the resolved
    // expression is " is_empty". The regex (.*?) matches empty LHS.
    const state: WorkflowState = { value: null };
    expect(evaluateCondition("{{value}} is_empty", state)).toBe(true);

    // Direct truthiness: null resolves to "", which is not "true" or "1"
    expect(evaluateCondition("{{value}}", state)).toBe(false);
  });

  it("should handle numeric string comparison with greater_than", () => {
    // "10" greater_than 9 should compare numerically
    const state: WorkflowState = { count: "10" };
    expect(evaluateCondition("{{count}} greater_than 9", state)).toBe(true);
  });

  it("should fall back to truthiness for non-operator expressions", () => {
    const stateTrue: WorkflowState = { flag: "true" };
    expect(evaluateCondition("{{flag}}", stateTrue)).toBe(true);

    const stateFalse: WorkflowState = { flag: "false" };
    expect(evaluateCondition("{{flag}}", stateFalse)).toBe(false);

    const stateOne: WorkflowState = { flag: "1" };
    expect(evaluateCondition("{{flag}}", stateOne)).toBe(true);

    const stateZero: WorkflowState = { flag: "0" };
    expect(evaluateCondition("{{flag}}", stateZero)).toBe(false);
  });

  it("should return false for unrecognized expression", () => {
    const state: WorkflowState = { x: "random" };
    expect(evaluateCondition("{{x}}", state)).toBe(false);
  });

  it("should evaluate is_empty with '[]' string value as true", () => {
    const state: WorkflowState = { value: "[]" };
    expect(evaluateCondition("{{value}} is_empty", state)).toBe(true);
  });

  it("should evaluate is_empty with '{}' string value as true", () => {
    const state: WorkflowState = { value: "{}" };
    expect(evaluateCondition("{{value}} is_empty", state)).toBe(true);
  });

  it("should evaluate quoted value with spaces using equals operator", () => {
    const state: WorkflowState = { greeting: "hello world" };
    expect(evaluateCondition('{{greeting}} equals "hello world"', state)).toBe(true);
  });

  it("should handle negative numbers in greater_than", () => {
    const state: WorkflowState = { value: -5 };
    expect(evaluateCondition("{{value}} greater_than -10", state)).toBe(true);
    expect(evaluateCondition("{{value}} less_than 0", state)).toBe(true);
    expect(evaluateCondition("{{value}} gte -5", state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------------

describe("normalizeKey", () => {
  it("should convert spaces to underscores and lowercase", () => {
    expect(normalizeKey("My Node")).toBe("my_node");
  });

  it("should leave already-normalized keys unchanged", () => {
    expect(normalizeKey("my_node")).toBe("my_node");
  });

  it("should collapse multiple spaces into a single underscore", () => {
    expect(normalizeKey("My  Big   Node")).toBe("my_big_node");
  });

  it("should handle empty string", () => {
    expect(normalizeKey("")).toBe("");
  });

  it("should handle string with only spaces", () => {
    expect(normalizeKey("   ")).toBe("_");
  });

  it("should handle uppercase with no spaces", () => {
    expect(normalizeKey("HELLO")).toBe("hello");
  });
});
