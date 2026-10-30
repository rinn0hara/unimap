import {
  groupRouteSegments as routeSegments,
  routeEdgeForStep,
  routePreferenceNotes,
  transitionForEdge as edgeTransition,
  transitionLabel as transition,
} from "./route-model.mjs";
import { nodeCaption, nodeDetails } from "./node-display.mjs";

const state = {
  nodes: [],
  floors: [],
  currentBuilding: 1,
  currentFloor: 1,
  mapRequest: 0,
  focusedRouteNode: null,
  selected: { from: null, to: null },
  picking: null, // "from" | "to" | null — which route point the next map click fills
  inspected: null,
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
const TYPE_LABELS = { street: "улица", normal: "точка", stairs: "лестница", elevator: "лифт" };
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
  return routeEdgeForStep(state.route?.edges || [], fromId, toId);
}

function renderPointPhoto(node) {
  photoDetailsElement.replaceChildren();
  if (!node) {
    photoDetailsElement.hidden = true;
    return;
  }
  const details = nodeDetails(node);
  const heading = document.createElement("div");
  heading.className = "point-details-heading";
  const title = document.createElement("h3");
  title.className = "point-details-title";
  title.textContent = nodeLabel(node);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "point-details-close";
  close.setAttribute("aria-label", "Закрыть карточку точки");
  close.textContent = "×";
  close.addEventListener("click", () => { state.inspected = null; renderPointPhoto(null); renderNodeMarkers(); });
  heading.append(title, close);
  photoDetailsElement.append(heading);
  const location = document.createElement("p");
  location.className = "point-location";
  location.textContent = `Корпус ${node.building} · Этаж ${node.floor} · ${TYPE_LABELS[node.type] || "точка"}`;
  photoDetailsElement.append(location);
  if (details.caption) {
    const caption = document.createElement("p");
    caption.className = "point-details-caption";
    caption.textContent = details.caption;
    photoDetailsElement.append(caption);
  }
  if (details.description) {
    const description = document.createElement("p");
    description.className = "point-description";
    description.textContent = details.description;
    photoDetailsElement.append(description);
  }
  if (details.tags.length) {
    const tags = document.createElement("div");
    tags.className = "point-tags";
    details.tags.forEach((tag) => { const chip = document.createElement("span"); chip.textContent = tag; tags.append(chip); });
    photoDetailsElement.append(tags);
  }
  if (details.photos.length) {
    const gallery = document.createElement("div");
    gallery.className = "point-gallery";
    for (const [index, photo] of details.photos.entries()) {
      const image = document.createElement("img");
      image.src = photo;
      image.alt = `Фото ${index + 1}: ${nodeLabel(node)}`;
      image.loading = "lazy";
      image.addEventListener("error", () => {
        image.remove();
        const error = document.createElement("p");
        error.className = "point-details-photo-error";
        error.textContent = `Не удалось загрузить фото ${index + 1}.`;
        gallery.append(error);
      }, { once: true });
      gallery.append(image);
    }
    photoDetailsElement.append(gallery);
  }
  const actions = document.createElement("div");
  actions.className = "point-actions";
  for (const [field, text] of [["from", "Отсюда"], ["to", "Сюда"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = text;
    button.addEventListener("click", () => setPickPoint(field, node));
    actions.append(button);
  }
  photoDetailsElement.append(actions);
  photoDetailsElement.hidden = false;
}

function updateSelectionPhoto() {
  renderPointPhoto(nodeById(state.inspected));
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
  if (floor) $("#map-heading").textContent = `Корпус ${floor.building} · Этаж ${floor.floor}`;
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
    from: "Нажмите на точку на карте, чтобы выбрать начало маршрута.",
    to: "Нажмите на точку на карте, чтобы выбрать назначение.",
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
  document.querySelector('[data-pick-label="from"]').textContent = fromLabel || "Выберите точку";
  document.querySelector('[data-pick-label="to"]').textContent = toLabel || "Выберите точку";
  $("#pick-from").classList.toggle("filled", Boolean(fromLabel));
  $("#pick-to").classList.toggle("filled", Boolean(toLabel));
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
  setStatus(`Нажмите на точку на карте, чтобы выбрать ${field === "from" ? "начало маршрута" : "назначение"}.`);
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
      setStatus("Не удалось загрузить этаж начальной точки.", true);
    });
  }
  renderNodeMarkers();
  updatePickPanel();
  updateSelectionPhoto();
}

function setPickPoint(field, node) {
  clearRouteDisplay();
  state.selected[field] = node.id;
  state.inspected = node.id;
  $(`#${field}-input`).value = nodeLabel(node);
  $(`#${field}-results`).replaceChildren();
  state.currentBuilding = Number(node.building);
  state.currentFloor = Number(node.floor);
  setPicking(null, { silent: true });
  renderFloorTabs();
  loadMap().catch((error) => {
    console.error(error);
    setStatus("Не удалось загрузить этаж выбранной точки.", true);
  });
  renderNodeMarkers();
  updateSelectionPhoto();
  updatePickPanel();
  setStatus(
    state.selected.from && state.selected.to
      ? `Откуда: «${selectedNodeLabel("from")}», куда: «${selectedNodeLabel("to")}». Постройте маршрут.`
      : `${field === "from" ? "Начало маршрута" : "Назначение"}: «${nodeLabel(node)}». Выберите вторую точку.`
  );
}

function pickNode(node) {
  state.inspected = node.id;
  if (state.picking) {
    setPickPoint(state.picking, node);
    return;
  }
  renderPointPhoto(node);
  renderNodeMarkers();
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
    button.textContent = `Корпус ${building} · этаж ${floorNumber}`;
    button.setAttribute("aria-selected", String(building === state.currentBuilding && floorNumber === state.currentFloor));
    button.addEventListener("click", () => {
      state.currentBuilding = building;
      state.currentFloor = floorNumber;
      renderFloorTabs();
      loadMap().catch((error) => {
        console.error(error);
        setStatus("Не удалось загрузить карту этажа.", true);
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
      mapElement.textContent = "Карта этажа не настроена.";
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
  layer.setAttribute("aria-label", "Точки на карте");
  layer.setAttribute("class", "map-nodes");
  for (const node of state.nodes) {
    if (Number(node.building) !== Number(state.currentBuilding)) continue;
    if (Number(node.floor) !== Number(state.currentFloor)) continue;
    if (node.x == null || node.y == null) continue;
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("class", "map-node");
    if (state.selected.from === node.id) marker.classList.add("picked-from");
    if (state.selected.to === node.id) marker.classList.add("picked-to");
    if (state.inspected === node.id) marker.classList.add("inspected");
    marker.setAttribute("cx", node.x);
    marker.setAttribute("cy", node.y);
    marker.setAttribute("r", node.name ? "9" : "6");
    marker.style.fill = TYPE_COLORS[node.type] || "#81909f";
    marker.setAttribute("aria-label", nodeLabel(node));
    marker.setAttribute("role", "button");
    marker.setAttribute("tabindex", "0");
    const tooltip = document.createElementNS(SVG_NS, "title");
    tooltip.textContent = `${nodeLabel(node)}${node.name ? ` · ${TYPE_LABELS[node.type] || "точка"}` : ""}${nodeCaption(node) ? ` · ${nodeCaption(node)}` : ""}`;
    marker.append(tooltip);
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      pickNode(node);
    });
    marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pickNode(node); } });
    layer.append(marker);
    if (nodeCaption(node)) {
      const caption = document.createElementNS(SVG_NS, "text");
      caption.setAttribute("class", "map-node-caption");
      caption.setAttribute("x", Number(node.x) + 12);
      caption.setAttribute("y", Number(node.y) - 10);
      caption.textContent = nodeCaption(node);
      layer.append(caption);
    }
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
  overlay.setAttribute("aria-label", "Построенный маршрут");

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
    focus.setAttribute("aria-label", `Текущий шаг: ${nodeLabel(focusedNode)}`);
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
    ? `корп. ${targetNode.building}, эт. ${targetNode.floor}`
    : `эт. ${targetNode.floor}`;
  const label = `${kind === "elevator" ? "Лифт" : kind === "stairs" ? "Лестница" : "Переход"} → ${destination}`;
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
    setStatus("Не удалось загрузить карту этажа.", true);
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
    chip.textContent = `Корп. ${segment.building} · эт. ${segment.floor}`;
    chip.setAttribute(
      "aria-label",
      `Показать этаж ${segment.floor} корпуса ${segment.building} на карте`
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
      ? `корпус ${next.building}, этаж ${next.floor}`
      : `этаж ${next.floor}`;
    transitionChip.textContent = `${transition(viaKind)} → ${destination}`;
    transitionChip.setAttribute("aria-label", `Показать корпус ${next.building}, этаж ${next.floor} на карте`);
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
    details.textContent = `${TYPE_LABELS[node.type] || "точка"}${nodeCaption(node) ? ` · ${nodeCaption(node)}` : ""} · корпус ${node.building}, этаж ${node.floor}${node.tags?.length ? ` · ${node.tags.join(", ")}` : ""}`;
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
  if (!value.trim()) {
    renderSuggestions(field, []);
    return;
  }
  const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
  if (response.ok) {
    const nodes = await response.json();
    if ($(`#${field}-input`).value === value) renderSuggestions(field, nodes);
  }
}

function setupSearch(field) {
  const input = $(`#${field}-input`);
  input.addEventListener("input", () => search(field, input.value).catch(() => setStatus("Не удалось выполнить поиск.", true)));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = $(`#${field}-results .suggestion`);
      if (first) first.click();
    }
  });
}

function setupAdminMenu() {
  const toggle = $("#menu-toggle");
  const panel = $("#menu-panel");
  const password = $("#menu-password");
  const message = $("#login-status");
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) password.focus();
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("click", (event) => { if (!event.target.closest(".admin-menu")) setOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) { setOpen(false); toggle.focus(); } });
  $("#admin-login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    message.textContent = "Проверяем пароль…";
    try {
      const response = await fetch("/api/admin/verify", { method: "POST", headers: { "X-Admin-Token": password.value } });
      if (response.status === 401) { message.textContent = "Неверный пароль."; return; }
      if (!response.ok) throw new Error("verification failed");
      sessionStorage.setItem("unimap-admin-password", password.value);
      window.location.assign("/editor");
    } catch {
      message.textContent = "Не удалось проверить пароль. Попробуйте ещё раз.";
    } finally {
      button.disabled = false;
    }
  });
}

async function calculateRoute() {
  const from = state.selected.from;
  const to = state.selected.to;
  if (!from || !to) {
    setStatus("Выберите начало и назначение маршрута.", true);
    return;
  }
  setStatus("Строим маршрут…");
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
    setStatus("Маршрут не найден. Проверьте выбранные точки.", true);
    return;
  }
  state.route = payload;
  state.currentBuilding = Number(payload.nodes[0].building);
  state.currentFloor = Number(payload.nodes[0].floor);
  state.focusedRouteNode = payload.nodes[0].id;
  renderFloorTabs();
  await loadMap();
  renderRouteSteps(payload.nodes);
  summaryElement.hidden = false;
  summaryElement.replaceChildren();
  const distance = document.createElement("strong");
  distance.textContent = `${payload.distance} ед. карты`;
  const details = document.createElement("span");
  details.textContent = `Точек маршрута: ${payload.route.length} · стоимость с учётом пожеланий: ${Number(payload.cost).toFixed(1)}`;
  summaryElement.append(distance, details);
  const preferenceNotes = routePreferenceNotes(payload.edges, {
    ...(payload.preferences || {
      avoid_stairs: $("#avoid-stairs").checked,
      avoid_outdoor: $("#avoid-outdoor").checked,
      prefer_elevator: $("#prefer-elevator").checked,
    }),
  });
  if (preferenceNotes.length) {
    for (const message of preferenceNotes) {
      const warning = document.createElement("p");
      warning.className = "route-preference-warning";
      warning.textContent = message;
      summaryElement.append(warning);
    }
    setStatus("Маршрут найден, но не все пожелания удалось учесть.", true);
  } else {
    setStatus("Маршрут построен.");
  }
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
  setupSearch("from");
  setupSearch("to");
  $("#route-button").addEventListener("click", () => calculateRoute().catch(() => setStatus("Не удалось построить маршрут.", true)));
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

setupAdminMenu();
initialize().catch((error) => {
  console.error(error);
  setStatus("Не удалось загрузить данные карты.", true);
});
