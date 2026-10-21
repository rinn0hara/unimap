export function groupRouteSegments(routeNodes) {
  const segments = [];
  for (const node of routeNodes) {
    const last = segments[segments.length - 1];
    if (last
      && Number(last.building) === Number(node.building)
      && Number(last.floor) === Number(node.floor)) {
      last.nodes.push(node);
    } else {
      segments.push({ building: node.building, floor: node.floor, nodes: [node] });
    }
  }
  return segments;
}

export function transitionForEdge(edge) {
  if (!edge) return "passage";
  if (edge.elevator) return "elevator";
  if (edge.stairs) return "stairs";
  return "passage";
}

export function transitionLabel(kind) {
  if (kind === "elevator") return "the elevator";
  if (kind === "stairs") return "the stairs";
  return "the passage";
}
