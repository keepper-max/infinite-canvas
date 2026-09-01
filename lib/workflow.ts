export function topologicalOrder<T extends { id: string }>(
  nodes: T[],
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.sourceNodeId) || !byId.has(edge.targetNodeId)) continue;
    next.set(edge.sourceNodeId, [
      ...(next.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const result: T[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(byId.get(id)!);
    for (const target of next.get(id) ?? []) {
      const degree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, degree);
      if (degree === 0) queue.push(target);
    }
  }
  return result.length === nodes.length ? result : nodes;
}
