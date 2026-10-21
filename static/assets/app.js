import {
  groupRouteSegments as routeSegments,
  transitionForEdge as edgeTransition,
  transitionLabel as transition,
} from "./route-model.mjs";

const state = {
  nodes: [],
  floors: [],
  currentBuilding: 1,
  currentFloor: 1,
  mapRequest: 0,
  focusedRouteNode: null,
  selected: { from: null, to: null },
  picking: null, // "from" | "to" | null — which route point the next map click fills
  route: null,
};

const $ = (selector) => document.querySelector(selector);
const mapElement = $("#map");
const statusElement = $("#status");
const summaryElement = $("#route-summary");
const stepsElement = $("#route-steps");
const photoDetailsElement = $("#point-photo-details");
const SVG_NS = "http://www.w3.org/2000/svg";
const TYPE_COLORS = { street: "#2f9e62", normal: "#9aa8b6", stairs: "#df9d2c", elevator: "#4e87d9" };
// How close (in SVG units) a click on the floor plan must be to snap to a vertex.
const PICK_RADIUS = 40;

function nodeById(id) {
  return state.nodes.find((node) => node.id === id) || null;
}

function nodeLabel(node) {
  return node.name || node.id;
}

function routeSegmentFloors() {
  if (!state.route) return new Set();
  return new Set(
    routeSegments(state.route.nodes).map((segment) => `${segment.building}_${segment.floor}`)
  );
}

function routeEdge(fromId, toId) {
  return state.route?.edges?.find((edge) => edge.from === fromId && edge.to === toId) || null;
}

function renderPointPhoto(node) {
  photoDetailsElement.replaceChildren();
  if (!node?.photo) {
    photoDetailsElement.hidden = true;
    return;
  }
  const heading = document.createElement("strong");
  heading.textContent = `Photo · ${nodeLabel(node)}`;
  const image = document.createElement("img");
  image.src = node.photo;
  image.alt = `Reference photo for ${nodeLabel(node)}`;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    photoDetailsElement.textContent = `Could not load photo for ${nodeLabel(node)}.`;
  }, { once: true });
  photoDetailsElement.append(heading, image);
  photoDetailsElement.hidden = false;
}

function updateSelectionPhoto() {
  renderPointPhoto(nodeById(state.selected.to) || nodeById(state.selected.from));
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function clearRouteDisplay() {
  if (!state.route) return;
  state.route = null;
  summaryElement.hidden = true;
  summaryElement.innerHTML = "";
  stepsElement.replaceChildren();
  stepsElement.hidden = true;
  mapElement.querySelector(".route-overlay")?.remove();
  renderFloorTabs();
}

function updateMapHeading() {
  const floor = state.floors.find(
    (item) => Number(item.building) === Number(state.currentBuilding)
      && Number(item.floor) === Number(state.currentFloor)
  );
  if (floor) $("#map-heading").textContent = `Building ${floor.building} · Floor ${floor.floor}`;
}

function setPicking(slot, options = {}) {
  state.picking = slot;
  const fromSlot = $("#pick-from");
  const toSlot = $("#pick-to");
  fromSlot.setAttribute("aria-pressed", String(slot === "from"));
  toSlot.setAttribute("aria-pressed", String(slot === "to"));
  fromSlot.classList.toggle("active", slot === "from");
  toSlot.classList.toggle("active", slot === "to");
  const hint = {
    from: "Click a graph point on the map to set the start.",
    to: "Click a graph point on the map to set the destination.",
  }[slot];
  if (hint && !options.silent) setStatus(hint);
}

function selectedNodeLabel(field) {
  const node = nodeById(state.selected[field]);
  return node ? nodeLabel(node) : null;
}

function updatePickPanel() {
  const fromLabel = selectedNodeLabel("from");
  const toLabel = selectedNodeLabel("to");
  document.querySelector('[data-pick-label="from"]').textContent = fromLabel || "Click a point on the map";
  document.querySelector('[data-pick-label="to"]').textContent = toLabel || "Click a point on the map";
  $("#pick-from").classList.toggle("filled", Boolean(fromLabel));
  $("#pick-to").classList.toggle("filled", Boolean(toLabel));
  if (!state.picking) {
    setPicking(!fromLabel ? "from" : !toLabel ? "to" : null, { silent: true });
  }
}

function clearPickPoint(field) {
  clearRouteDisplay();
  state.selected[field] = null;
  $(`#${field}-input`).value = "";
  $(`#${field}-results`).replaceChildren();
  setPicking(field, { silent: false });
  renderNodeMarkers();
  updatePickPanel();
  updateSelectionPhoto();
  renderPointList();
  setStatus(`Click a graph point on the map to set the ${field === "from" ? "start" : "destination"}.`);
}

function swapPickPoints() {
  clearRouteDisplay();
  const { from, to } = state.selected;
  state.selected = { from: to, to: from };
  $("#from-input").value = selectedNodeLabel("from") || "";
  $("#to-input").value = selectedNodeLabel("to") || "";
  const start = nodeById(state.selected.from);
  if (start) {
    state.currentBuilding = Number(start.building);
    state.currentFloor = Number(start.floor);
    renderFloorTabs();
    loadMap().catch((error) => {
      console.error(error);
      setStatus("Could not load the selected start point's floor.", true);
    });
  }
  renderNodeMarkers();
  updatePickPanel();
  updateSelectionPhoto();
  renderPointList();
}

function setPickPoint(field, node) {
  clearRouteDisplay();
  state.selected[field] = node.id;
  $(`#${field}-input`).value = nodeLabel(node);
  $(`#${field}-results`).replaceChildren();
  state.currentBuilding = Number(node.building);
  state.currentFloor = Number(node.floor);
  setPicking(field === "from" ? "to" : null);
  renderFloorTabs();
  loadMap().catch((error) => {
    console.error(error);
    setStatus("Could not load the selected point's floor.", true);
  });
  renderNodeMarkers();
  updateSelectionPhoto();
  renderPointList();
  updatePickPanel();
  setStatus(
    state.selected.from && state.selected.to
      ? `Start set to “${selectedNodeLabel("from")}”, destination set to “${selectedNodeLabel("to")}”. Press Calculate route.`
      : `${field === "from" ? "Start" : "Destination"} set to “${nodeLabel(node)}”. Press Calculate route, or set the remaining point.`
  );
}

function pickNode(node) {
  if (state.picking) {
    setPickPoint(state.picking, node);
    return;
  }
  if (!state.selected.from || (state.selected.from && state.selected.to)) {
    setPickPoint("from", node);
  } else if (state.selected.from !== node.id) {
    setPickPoint("to", node);
  }
}

function renderFloorTabs() {
  const container = $("#floor-tabs");
  container.replaceChildren();
  const routeFloors = routeSegmentFloors();
  for (const floor of state.floors) {
    const button = document.createElement("button");
    const building = Number(floor.building);
    const floorNumber = Number(floor.floor);
    const onRoute = routeFloors.has(`${building}_${floorNumber}`);
    button.className = `floor-tab${building === state.currentBuilding && floorNumber === state.currentFloor ? " active" : ""}${onRoute ? " has-route" : ""}`;
    button.type = "button";
    button.textContent = `B${building} · F${floorNumber}`;
    button.setAttribute("aria-selected", String(building === state.currentBuilding && floorNumber === state.currentFloor));
    button.addEventListener("click", () => {
      state.currentBuilding = building;
      state.currentFloor = floorNumber;
      renderFloorTabs();
      loadMap().catch((error) => {
        console.error(error);
        setStatus("Could not load the floor map.", true);
      });
    });
    container.append(button);
  }
}

async function loadMap() {
  const request = ++state.mapRequest;
  mapElement.classList.add("loading");
  mapElement.setAttribute("aria-busy", "true");
  const floor = state.floors.find((item) => Number(item.building) === Number(state.currentBuilding)
    && Number(item.floor) === Number(state.currentFloor));
  if (!floor) {
    if (request === state.mapRequest) {
      mapElement.textContent = "No floor map is configured.";
      mapElement.classList.remove("loading");
      mapElement.setAttribute("aria-busy", "false");
    }
    return;
  }
  try {
    const response = await fetch(`/maps/${encodeURIComponent(floor.map)}`);
    if (!response.ok) throw new Error(`Could not load map: ${floor.map}`);
    const mapMarkup = await response.text();
    if (request !== state.mapRequest) return;
    mapElement.innerHTML = mapMarkup;
    updateMapHeading();
    setupMapPicking();
    renderNodeMarkers();
    drawRoute();
  } finally {
    if (request === state.mapRequest) {
      mapElement.classList.remove("loading");
      mapElement.setAttribute("aria-busy", "false");
    }
  }
}

function svgPointFromEvent(svg, event) {
  if (typeof svg.getScreenCTM !== "function") return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  let point;
  if (typeof DOMPoint !== "undefined") {
    point = new DOMPoint(event.clientX, event.clientY);
  } else {
    point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
  }
  return point.matrixTransform(ctm.inverse());
}

function nearestNode(x, y) {
  let best = null;
  let bestDistance = PICK_RADIUS;
  for (const node of state.nodes) {
    if (Number(node.building) !== Number(state.currentBuilding)) continue;
    if (Number(node.floor) !== Number(state.currentFloor)) continue;
    if (node.x == null || node.y == null) continue;
    const distance = Math.hypot(Number(node.x) - x, Number(node.y) - y);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function setupMapPicking() {
  const svg = mapElement.querySelector("svg");
  if (!svg) return;
  svg.addEventListener("click", (event) => {
    if (event.target.closest(".map-nodes")) return; // marker clicks handle themselves
    const point = svgPointFromEvent(svg, event);
    if (!point) return;
    const node = nearestNode(point.x, point.y);
    if (node) pickNode(node);
  });
}

function renderNodeMarkers() {
  const svg = mapElement.querySelector("svg");
  if (!svg) return;
  svg.querySelector(".map-nodes")?.remove();
  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("aria-label", "Graph points");
  layer.setAttribute("class", "map-nodes");
  for (const node of state.nodes) {
    if (Number(node.building) !== Number(state.currentBuilding)) continue;
    if (Number(node.floor) !== Number(state.currentFloor)) continue;
    if (node.x == null || node.y == null) continue;
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("class", "map-node");
    if (state.selected.from === node.id) marker.classList.add("picked-from");
    if (state.selected.to === node.id) marker.classList.add("picked-to");
    marker.setAttribute("cx", node.x);
    marker.setAttribute("cy", node.y);
    marker.setAttribute("r", node.name ? "9" : "6");
    marker.style.fill = TYPE_COLORS[node.type] || "#81909f";
    marker.setAttribute("aria-label", nodeLabel(node));
    const tooltip = document.createElementNS(SVG_NS, "title");
    tooltip.textContent = `${nodeLabel(node)}${node.name ? ` · ${node.type}` : ""}`;
    marker.append(tooltip);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      pickNode(node);
    });
    layer.append(marker);
  }
  svg.append(layer);
}

function drawRoute() {
  const svg = mapElement.querySelector("svg");
  if (!svg || !state.route) return;
  const allSegments = routeSegments(state.route.nodes);
  const segments = allSegments.filter(
    (segment) => Number(segment.building) === Number(state.currentBuilding)
      && Number(segment.floor) === Number(state.currentFloor)
  );
  if (segments.length === 0) return;

  const overlay = document.createElementNS(SVG_NS, "g");
  overlay.classList.add("route-overlay");
  overlay.setAttribute("aria-label", "Calculated route");

  for (const segment of segments) {
    const line = document.createElementNS(SVG_NS, "polyline");
    line.classList.add("route-line");
    line.setAttribute(
      "points",
      segment.nodes.map((node) => `${node.x},${node.y}`).join(" ")
    );
    overlay.append(line);
  }

  for (const node of state.route.nodes.filter(
    (item) => Number(item.building) === Number(state.currentBuilding)
      && Number(item.floor) === Number(state.currentFloor)
  )) {
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.classList.add("route-node");
    marker.setAttribute("cx", node.x);
    marker.setAttribute("cy", node.y);
    marker.setAttribute("r", "8");
    marker.setAttribute("aria-label", nodeLabel(node));
    overlay.append(marker);
  }

  const focusedNode = nodeById(state.focusedRouteNode);
  if (focusedNode
    && Number(focusedNode.building) === Number(state.currentBuilding)
    && Number(focusedNode.floor) === Number(state.currentFloor)) {
    const focus = document.createElementNS(SVG_NS, "circle");
    focus.classList.add("route-focus-node");
    focus.setAttribute("cx", focusedNode.x);
    focus.setAttribute("cy", focusedNode.y);
    focus.setAttribute("r", "16");
    focus.setAttribute("aria-label", `Current step: ${nodeLabel(focusedNode)}`);
    overlay.append(focus);
  }

  // Prominent badges at the segment boundaries that continue on another floor.
  for (const segment of segments) {
    const index = allSegments.indexOf(segment);
    const next = allSegments[index + 1];
    const previous = allSegments[index - 1];
    if (next) {
      const from = segment.nodes[segment.nodes.length - 1];
      transitionBadge(overlay, from, next.nodes[0], routeEdge(from.id, next.nodes[0].id));
    }
    if (previous) {
      const from = previous.nodes[previous.nodes.length - 1];
      transitionBadge(overlay, segment.nodes[0], from, routeEdge(from.id, segment.nodes[0].id));
    }
  }

  svg.append(overlay);
}

function transitionBadge(overlay, atNode, targetNode, edge) {
  const kind = edgeTransition(edge);
  const destination = Number(atNode.building) !== Number(targetNode.building)
    ? `B${targetNode.building} F${targetNode.floor}`
    : `F${targetNode.floor}`;
  const label = `${kind === "elevator" ? "Elevator" : kind === "stairs" ? "Stairs" : "Continue"} → ${destination}`;
  const x = Number(atNode.x);
  const y = Number(atNode.y);
  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("route-transition-badge");
  group.setAttribute("aria-label", label);
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", x + 13);
  rect.setAttribute("y", y - 32);
  rect.setAttribute("width", 30 + label.length * 6.4);
  rect.setAttribute("height", 21);
  rect.setAttribute("rx", 10.5);
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", x + 23);
  text.setAttribute("y", y - 17);
  const icon = kind === "elevator" ? "↕" : kind === "stairs" ? "⇅" : "↔";
  text.textContent = `${icon} ${label}`;
  group.append(rect, text);
  overlay.append(group);
}

function showRouteFloor(building, floor, nodeId = null) {
  state.currentBuilding = Number(building);
  state.currentFloor = Number(floor);
  state.focusedRouteNode = nodeId;
  renderFloorTabs();
  loadMap().catch((error) => {
    console.error(error);
    setStatus("Could not load the floor map.", true);
  });
}

function renderRouteSteps(routeNodes) {
  stepsElement.replaceChildren();
  const segments = routeSegments(routeNodes);
  segments.forEach((segment, index) => {
    const item = document.createElement("li");
    item.className = "route-step";

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "route-floor-chip";
    chip.textContent = `B${segment.building} · F${segment.floor}`;
    chip.setAttribute(
      "aria-label",
      `Show floor ${segment.floor} of building ${segment.building} on the map`
    );
    chip.addEventListener("click", () => showRouteFloor(segment.building, segment.floor, segment.nodes[0].id));

    const text = document.createElement("span");
    text.className = "route-step-text";
    text.textContent = segment.nodes.map(nodeLabel).join(" → ");
    item.append(chip, text);
    stepsElement.append(item);

    const next = segments[index + 1];
    if (!next) return;
    const via = segment.nodes[segment.nodes.length - 1];
    const nextNode = next.nodes[0];
    const edge = routeEdge(via.id, nextNode.id);
    const viaKind = edgeTransition(edge);
    const transitionItem = document.createElement("li");
    transitionItem.className = `route-step route-transition via-${viaKind}`;
    transitionItem.innerHTML = `<span class="transition-icon">${viaKind === "elevator" ? "🛗" : viaKind === "stairs" ? "⇅" : "↔"}</span>`;

    const transitionChip = document.createElement("button");
    transitionChip.type = "button";
    transitionChip.className = "route-floor-chip transition";
    const destination = Number(segment.building) !== Number(next.building)
      ? `building ${next.building}`
      : `floor ${next.floor}`;
    transitionChip.textContent = `Take ${transition(viaKind)} to ${destination}`;
    transitionChip.setAttribute("aria-label", `Show building ${next.building}, floor ${next.floor} on the map`);
    transitionChip.addEventListener("click", () => showRouteFloor(next.building, next.floor, nextNode.id));
    transitionItem.append(transitionChip);
    stepsElement.append(transitionItem);
  });
  stepsElement.hidden = false;
}

function chooseSuggestion(field, node) {
  setPickPoint(field, node);
}

function renderSuggestions(field, nodes) {
  const container = $(`#${field}-results`);
  container.replaceChildren();
  for (const node of nodes.slice(0, 8)) {
    const button = document.createElement("button");
    button.className = "suggestion";
    button.type = "button";
    button.append(document.createTextNode(nodeLabel(node)));
    const details = document.createElement("small");
    details.textContent = `${node.type} · Building ${node.building}, floor ${node.floor}`;
    button.append(details);
    button.addEventListener("click", () => chooseSuggestion(field, node));
    container.append(button);
  }
}

async function search(field, value) {
  clearRouteDisplay();
  state.selected[field] = null;
  renderNodeMarkers();
  updatePickPanel();
  renderPointPhoto(nodeById(state.selected.to) || nodeById(state.selected.from));
  renderPointList();
  if (!value.trim()) {
    renderSuggestions(field, []);
    return;
  }
  const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
  if (response.ok) renderSuggestions(field, await response.json());
}

function renderPointList() {
  const container = $("#point-list");
  const query = $("#point-filter").value.trim().toLocaleLowerCase();
  const matching = state.nodes.filter((node) => {
    const searchable = `${node.name || ""} ${node.id} ${node.type} ${node.building} ${node.floor}`;
    return searchable.toLocaleLowerCase().includes(query);
  }).sort((left, right) => Number(left.building) - Number(right.building)
    || Number(left.floor) - Number(right.floor)
    || nodeLabel(left).localeCompare(nodeLabel(right), undefined, { numeric: true }));

  container.replaceChildren();
  if (!matching.length) {
    container.textContent = "No graph points match.";
    return;
  }

  const groups = new Map();
  for (const node of matching) {
    const key = `${node.building}_${node.floor}`;
    if (!groups.has(key)) groups.set(key, { building: node.building, floor: node.floor, nodes: [] });
    groups.get(key).nodes.push(node);
  }
  for (const group of groups.values()) {
    const section = document.createElement("section");
    section.className = "point-group";
    const heading = document.createElement("h3");
    heading.textContent = `Building ${group.building} · Floor ${group.floor}`;
    section.append(heading);
    for (const node of group.nodes) {
      const row = document.createElement("div");
      row.className = "point-row";
      const label = document.createElement("span");
      label.className = "point-row-label";
      label.textContent = `${nodeLabel(node)} · ${node.type}`;
      row.append(label);
      for (const [field, text] of [["from", "Start"], ["to", "Goal"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `point-select ${field}`;
        button.textContent = text;
        button.setAttribute("aria-label", `Set ${nodeLabel(node)} as ${field === "from" ? "start" : "destination"}`);
        button.setAttribute("aria-pressed", String(state.selected[field] === node.id));
        button.addEventListener("click", () => setPickPoint(field, node));
        row.append(button);
      }
      section.append(row);
    }
    container.append(section);
  }
}

function setupSearch(field) {
  const input = $(`#${field}-input`);
  input.addEventListener("input", () => search(field, input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = $(`#${field}-results .suggestion`);
      if (first) first.click();
    }
  });
}

async function calculateRoute() {
  const from = state.selected.from;
  const to = state.selected.to;
  if (!from || !to) {
    setStatus("Choose both a start point and a destination.", true);
    return;
  }
  setStatus("Calculating route…");
  const response = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      avoid_stairs: $("#avoid-stairs").checked,
      avoid_outdoor: $("#avoid-outdoor").checked,
      prefer_elevator: $("#prefer-elevator").checked,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    setStatus(payload.detail || "No route found.", true);
    return;
  }
  state.route = payload;
  state.currentBuilding = Number(payload.nodes[0].building);
  state.currentFloor = Number(payload.nodes[0].floor);
  state.focusedRouteNode = payload.nodes[0].id;
  renderFloorTabs();
  await loadMap();
  renderRouteSteps(payload.nodes);
  renderPointPhoto(payload.nodes[payload.nodes.length - 1]);
  summaryElement.hidden = false;
  summaryElement.innerHTML = `<strong>${payload.distance} map units</strong> ${payload.route.length} navigation points · preference cost ${payload.cost.toFixed(1)}`;
  setStatus("Route calculated.");
}

async function initialize() {
  const response = await fetch("/api/graph");
  if (!response.ok) throw new Error("Could not load graph data");
  const graph = await response.json();
  state.nodes = graph.nodes || [];
  state.floors = graph.floors || [];
  state.currentBuilding = Number(state.floors[0]?.building || 1);
  state.currentFloor = Number(state.floors[0]?.floor || 1);
  renderFloorTabs();
  renderPointList();
  $("#point-filter").addEventListener("input", renderPointList);
  setupSearch("from");
  setupSearch("to");
  $("#route-button").addEventListener("click", calculateRoute);
  const bindPickSlot = (selector, slot) => {
    const element = $(selector);
    element.addEventListener("click", () => setPicking(slot));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setPicking(slot);
      }
    });
  };
  bindPickSlot("#pick-from", "from");
  bindPickSlot("#pick-to", "to");
  $("#clear-from").addEventListener("click", (event) => {
    event.stopPropagation();
    clearPickPoint("from");
  });
  $("#clear-to").addEventListener("click", (event) => {
    event.stopPropagation();
    clearPickPoint("to");
  });
  $("#swap-points").addEventListener("click", swapPickPoints);
  await loadMap();
  updatePickPanel();
}

initialize().catch((error) => {
  console.error(error);
  setStatus("The application could not load its map data.", true);
});
