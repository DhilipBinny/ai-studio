import { describe, it, expect } from "vitest";
import { buildExecutionGraph } from "../src/workflow/graph-builder";
import type { GraphNode, GraphEdge } from "../src/workflow/types";
import { DEFAULT_ERROR_POLICY } from "../src/workflow/types";

function makeNode(id: string, nodeType = "transform", name?: string): GraphNode {
  return {
    id,
    nodeType,
    name: name || id,
    config: {},
    errorPolicy: { ...DEFAULT_ERROR_POLICY },
  };
}

function makeEdge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  edgeType = "default",
  sortOrder = 0,
): GraphEdge {
  return {
    id,
    fromNodeId,
    toNodeId,
    conditionLabel: null,
    conditionExpr: null,
    edgeType,
    sortOrder,
  };
}

// ---------------------------------------------------------------------------
// buildExecutionGraph
// ---------------------------------------------------------------------------

describe("buildExecutionGraph", () => {
  // --- Happy paths ---

  it("should build a linear 3-node graph with correct adjacency and startNodeId", () => {
    const nodes = [
      makeNode("n1", "input"),
      makeNode("n2", "transform"),
      makeNode("n3", "output"),
    ];
    const edges = [
      makeEdge("e1", "n1", "n2"),
      makeEdge("e2", "n2", "n3"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    expect(graph.startNodeId).toBe("n1");
    expect(graph.adjacency.get("n1")?.map((e) => e.toNodeId)).toEqual(["n2"]);
    expect(graph.adjacency.get("n2")?.map((e) => e.toNodeId)).toEqual(["n3"]);
    expect(graph.adjacency.get("n3")).toEqual([]);
    expect(graph.inDegree.get("n1")).toBe(0);
    expect(graph.inDegree.get("n2")).toBe(1);
    expect(graph.inDegree.get("n3")).toBe(1);
  });

  it("should build a branching graph with correct edges", () => {
    const nodes = [
      makeNode("input", "input"),
      makeNode("condition", "condition"),
      makeNode("a", "transform"),
      makeNode("b", "transform"),
      makeNode("output", "output"),
    ];
    const edges = [
      makeEdge("e1", "input", "condition"),
      makeEdge("e2", "condition", "a"),
      makeEdge("e3", "condition", "b"),
      makeEdge("e4", "a", "output"),
      makeEdge("e5", "b", "output"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    expect(graph.startNodeId).toBe("input");
    expect(graph.adjacency.get("condition")?.map((e) => e.toNodeId)).toEqual(["a", "b"]);
    expect(graph.inDegree.get("output")).toBe(2);
    expect(graph.reverseAdj.get("output")).toEqual(["a", "b"]);
  });

  // --- Edge cases ---

  it("should handle a single node", () => {
    const nodes = [makeNode("solo", "input")];
    const edges: GraphEdge[] = [];

    const graph = buildExecutionGraph(nodes, edges);

    expect(graph.startNodeId).toBe("solo");
    expect(graph.nodes.size).toBe(1);
    expect(graph.adjacency.get("solo")).toEqual([]);
    expect(graph.inDegree.get("solo")).toBe(0);
  });

  it("should pick first in-degree-0 node when no input node exists", () => {
    const nodes = [
      makeNode("a", "transform"),
      makeNode("b", "transform"),
      makeNode("c", "output"),
    ];
    const edges = [
      makeEdge("e1", "a", "b"),
      makeEdge("e2", "b", "c"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    // No "input" type node, so it picks the first node with inDegree 0
    expect(graph.startNodeId).toBe("a");
  });

  it("should exclude loop_back edges from adjacency and inDegree", () => {
    const nodes = [
      makeNode("n1", "input"),
      makeNode("n2", "transform"),
    ];
    const edges = [
      makeEdge("e1", "n1", "n2", "default"),
      makeEdge("e2", "n2", "n1", "loop_back"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    // loop_back edge should NOT be in adjacency
    expect(graph.adjacency.get("n2")).toEqual([]);
    // n1 inDegree should still be 0 (loop_back not counted)
    expect(graph.inDegree.get("n1")).toBe(0);
    // Only the forward edge should appear
    expect(graph.adjacency.get("n1")?.length).toBe(1);
  });

  it("should handle empty nodes array gracefully", () => {
    const graph = buildExecutionGraph([], []);

    expect(graph.startNodeId).toBe("");
    expect(graph.nodes.size).toBe(0);
  });

  it("should handle duplicate edge IDs without crashing", () => {
    const nodes = [
      makeNode("n1", "input"),
      makeNode("n2", "transform"),
      makeNode("n3", "output"),
    ];
    const edges = [
      makeEdge("same-id", "n1", "n2"),
      makeEdge("same-id", "n2", "n3"),
    ];

    // Should not throw
    const graph = buildExecutionGraph(nodes, edges);

    expect(graph.startNodeId).toBe("n1");
    expect(graph.adjacency.get("n1")?.length).toBe(1);
    expect(graph.adjacency.get("n2")?.length).toBe(1);
  });

  it("should populate reverseAdj correctly", () => {
    const nodes = [
      makeNode("n1", "input"),
      makeNode("n2", "transform"),
      makeNode("n3", "output"),
    ];
    const edges = [
      makeEdge("e1", "n1", "n2"),
      makeEdge("e2", "n2", "n3"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    expect(graph.reverseAdj.get("n1")).toEqual([]);
    expect(graph.reverseAdj.get("n2")).toEqual(["n1"]);
    expect(graph.reverseAdj.get("n3")).toEqual(["n2"]);
  });

  it("should not crash on edge referencing non-existent node ID", () => {
    const nodes = [
      makeNode("n1", "input"),
      makeNode("n2", "output"),
    ];
    const edges = [
      makeEdge("e1", "n1", "n2"),
      makeEdge("e2", "n2", "phantom"), // phantom node does not exist
    ];

    const graph = buildExecutionGraph(nodes, edges);

    expect(graph.startNodeId).toBe("n1");
    expect(graph.nodes.size).toBe(2);
    // The phantom node should not appear in adjacency
    expect(graph.adjacency.has("phantom")).toBe(false);
    // n2's adjacency should be empty because adjacency.get("n2") exists
    // but the push to adjacency uses optional chaining, so phantom edge
    // still gets pushed to n2's list
    expect(graph.adjacency.get("n2")?.map((e) => e.toNodeId)).toEqual(["phantom"]);
    // Phantom should not exist in inDegree map
    expect(graph.nodes.has("phantom")).toBe(false);
  });

  it("should pick the first input-type node when multiple input nodes exist", () => {
    const nodes = [
      makeNode("input1", "input"),
      makeNode("input2", "input"),
      makeNode("out", "output"),
    ];
    const edges = [
      makeEdge("e1", "input1", "out"),
      makeEdge("e2", "input2", "out"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    // Array.find returns the first match
    expect(graph.startNodeId).toBe("input1");
  });

  it("should fall back to nodes[0] when all nodes have inDegree > 0 (cyclic graph)", () => {
    const nodes = [
      makeNode("a", "transform"),
      makeNode("b", "transform"),
      makeNode("c", "transform"),
    ];
    // Every node has at least one incoming edge — a cycle
    const edges = [
      makeEdge("e1", "a", "b"),
      makeEdge("e2", "b", "c"),
      makeEdge("e3", "c", "a"),
    ];

    const graph = buildExecutionGraph(nodes, edges);

    // No input node, no node with inDegree 0 — falls back to nodes[0].id
    expect(graph.startNodeId).toBe("a");
  });
});
