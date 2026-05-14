import type { GraphNode, GraphEdge, ExecutionGraph } from "./types";

// ---------------------------------------------------------------------------
// Graph Builder
// ---------------------------------------------------------------------------

export function buildExecutionGraph(nodes: GraphNode[], edges: GraphEdge[]): ExecutionGraph {
  const nodeMap = new Map<string, GraphNode>();
  const adjacency = new Map<string, GraphEdge[]>();
  const reverseAdj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    adjacency.set(node.id, []);
    reverseAdj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (edge.edgeType === "loop_back") continue;
    adjacency.get(edge.fromNodeId)?.push(edge);
    reverseAdj.get(edge.toNodeId)?.push(edge.fromNodeId);
    inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) || 0) + 1);
  }

  let startNodeId = "";
  const inputNode = nodes.find((n) => n.nodeType === "input");
  if (inputNode) {
    startNodeId = inputNode.id;
  } else {
    const root = nodes.find((n) => (inDegree.get(n.id) || 0) === 0);
    startNodeId = root?.id || nodes[0]?.id || "";
  }

  return { nodes: nodeMap, adjacency, reverseAdj, inDegree, startNodeId };
}
