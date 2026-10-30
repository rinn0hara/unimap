export function createGraphNode(existingNodes, {
  building,
  floor,
  x,
  y,
  type = "normal",
  name = "",
  label = "",
}) {
  const base = `node_b${building}_f${floor}_`;
  const used = new Set(existingNodes.map((node) => node.id));
  let suffix = existingNodes.length + 1;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  const trimmedName = name.trim();
  const trimmedLabel = label.trim();
  return {
    id: `${base}${suffix}`,
    type,
    name: trimmedName,
    ...(trimmedLabel ? { label: trimmedLabel } : {}),
    building: Number(building),
    floor: Number(floor),
    x: Number(x),
    y: Number(y),
  };
}

export function nodeCaption(node) {
  const label = typeof node?.label === "string" ? node.label.trim() : "";
  return label || null;
}

export function createInterFloorEdge(from, to, {
  kind,
  distance = 0,
  bidirectional = true,
} = {}) {
  if (!from || !to || !from.id || !to.id || from.id === to.id) {
    throw new Error("Выберите две разные точки.");
  }
  if (Number(from.building) === Number(to.building)
    && Number(from.floor) === Number(to.floor)) {
    throw new Error("Переход должен соединять разные этажи или корпуса.");
  }
  if (!["elevator", "stairs", "passage"].includes(kind)) {
    throw new Error("Выберите тип перехода.");
  }
  if (kind === "elevator" && (from.type !== "elevator" || to.type !== "elevator")) {
    throw new Error("Переход на лифте должен соединять две точки лифта.");
  }
  if (kind === "stairs" && (from.type !== "stairs" || to.type !== "stairs")) {
    throw new Error("Переход по лестнице должен соединять две точки лестницы.");
  }
  const numericDistance = Number(distance);
  if (!Number.isFinite(numericDistance) || numericDistance < 0) {
    throw new Error("Расстояние должно быть неотрицательным числом.");
  }
  return {
    from: from.id,
    to: to.id,
    distance: numericDistance,
    stairs: kind === "stairs",
    elevator: kind === "elevator",
    outdoor: false,
    bidirectional: Boolean(bidirectional),
    autoDistance: false,
  };
}

export function hasExistingEdge(edges, fromId, toId) {
  return edges.some((edge) => (edge.from === fromId && edge.to === toId)
    || (edge.bidirectional !== false && edge.from === toId && edge.to === fromId));
}

export function canAutoCalculateDistance(edge, nodesById) {
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  return Boolean(from && to
    && Number(from.building) === Number(to.building)
    && Number(from.floor) === Number(to.floor));
}

export function interFloorEdgeLabel(edge, endpoint, other) {
  const kind = edge.elevator ? "Лифт" : edge.stairs ? "Лестница" : "Переход";
  const icon = edge.elevator ? "↕" : edge.stairs ? "⇅" : "↔";
  const destination = Number(endpoint.building) !== Number(other.building)
    ? `корп. ${other.building} · эт. ${other.floor}`
    : `эт. ${other.floor}`;
  const direction = edge.bidirectional
    ? "↔"
    : edge.from === endpoint.id ? "→" : "←";
  return `${icon} ${kind} ${direction} ${destination}`;
}

export function describeInterFloorEndpoint(edge, from, to) {
  if (edge.from === from.id && edge.to === to.id) {
    return interFloorEdgeLabel(edge, from, to);
  }
  if (edge.to === from.id && edge.from === to.id) {
    return interFloorEdgeLabel(edge, from, to);
  }
  throw new Error("Эти точки не принадлежат связи.");
}

export function interFloorEndpointsForFloor(edges, nodes, building, floor) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const endpoints = [];
  for (const edge of edges) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) continue;
    const differentPlace = Number(from.building) !== Number(to.building)
      || Number(from.floor) !== Number(to.floor);
    if (!differentPlace) continue;
    const onFrom = Number(from.building) === Number(building)
      && Number(from.floor) === Number(floor);
    const onTo = Number(to.building) === Number(building)
      && Number(to.floor) === Number(floor);
    if (onFrom) endpoints.push({ edge, endpoint: from, other: to });
    if (onTo) endpoints.push({ edge, endpoint: to, other: from });
  }
  return endpoints;
}

export function interFloorBadgePosition(endpoint, index, badgeWidth, viewBox) {
  const row = Math.floor(index / 2);
  const side = index % 2 === 0 ? 1 : -1;
  const rowOffset = row * 25;
  let x = side > 0
    ? Number(endpoint.x) + 10
    : Number(endpoint.x) - badgeWidth - 10;
  let y = Number(endpoint.y) + (row % 2 === 0 ? rowOffset + 18 : -(rowOffset + 30));
  if (viewBox.width && x + badgeWidth > viewBox.x + viewBox.width) {
    x = Number(endpoint.x) - badgeWidth - 10;
  }
  if (viewBox.width && x < viewBox.x) x = Number(endpoint.x) + 10;
  if (viewBox.height && y + 21 > viewBox.y + viewBox.height) y = Number(endpoint.y) - rowOffset - 30;
  if (y < viewBox.y) y = Number(endpoint.y) + rowOffset + 18;
  return { x, y };
}
