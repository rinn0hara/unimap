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

export function routeEdgeForStep(edges, fromId, toId) {
  return edges.find((edge) => edge.from === fromId && edge.to === toId)
    || edges.find((edge) => edge.bidirectional !== false && edge.from === toId && edge.to === fromId)
    || null;
}

export function transitionLabel(kind) {
  if (kind === "elevator") return "На лифте";
  if (kind === "stairs") return "По лестнице";
  return "Через переход";
}

export function routePreferenceNotes(edges, preferences) {
  const notes = [];
  if (preferences.avoid_stairs && edges.some((edge) => edge.stairs)) {
    notes.push("Не удалось избежать лестниц: подходящей альтернативы нет.");
  }
  if (preferences.avoid_outdoor && edges.some((edge) => edge.outdoor)) {
    notes.push("Не удалось избежать улицы: подходящей альтернативы нет.");
  }
  if (preferences.prefer_elevator && !edges.some((edge) => edge.elevator)) {
    notes.push("В выбранном маршруте нет лифта.");
  }
  return notes;
}
