const state = {
  nodes: [],
  floors: [],
  currentFloor: 1,
  selected: { from: null, to: null },
  route: null,
};

const $ = (selector) => document.querySelector(selector);
const mapElement = $("#map");
const statusElement = $("#status");
const summaryElement = $("#route-summary");

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function renderFloorTabs() {
  const container = $("#floor-tabs");
  container.replaceChildren();
  for (const floor of state.floors) {
    const button = document.createElement("button");
    button.className = `floor-tab${floor.floor === state.currentFloor ? " active" : ""}`;
    button.type = "button";
    button.textContent = `Floor ${floor.floor}`;
    button.setAttribute("aria-selected", String(floor.floor === state.currentFloor));
    button.addEventListener("click", () => {
      state.currentFloor = floor.floor;
      renderFloorTabs();
      loadMap();
    });
    container.append(button);
  }
}

async function loadMap() {
  const floor = state.floors.find((item) => Number(item.floor) === Number(state.currentFloor));
  if (!floor) {
    mapElement.textContent = "No floor map is configured.";
    return;
  }
  const response = await fetch(`/maps/${encodeURIComponent(floor.map)}`);
  if (!response.ok) throw new Error(`Could not load map: ${floor.map}`);
  mapElement.innerHTML = await response.text();
  drawRoute();
}

function drawRoute() {
  const svg = mapElement.querySelector("svg");
  if (!svg || !state.route) return;
  const routeNodes = state.route.nodes.filter((node) => node.floor === state.currentFloor);
  if (routeNodes.length === 0) return;

  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  overlay.setAttribute("aria-label", "Calculated route");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.classList.add("route-line");
  line.setAttribute("points", routeNodes.map((node) => `${node.x},${node.y}`).join(" "));
  overlay.append(line);

  for (const node of routeNodes) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.classList.add("route-node");
    marker.setAttribute("cx", node.x);
    marker.setAttribute("cy", node.y);
    marker.setAttribute("r", "8");
    marker.setAttribute("aria-label", node.name || node.id);
    overlay.append(marker);
  }
  svg.append(overlay);
}

function chooseSuggestion(field, node) {
  state.selected[field] = node.id;
  $(`#${field}-input`).value = node.name || node.id;
  $(`#${field}-results`).replaceChildren();
}

function renderSuggestions(field, nodes) {
  const container = $(`#${field}-results`);
  container.replaceChildren();
  for (const node of nodes.slice(0, 8)) {
    const button = document.createElement("button");
    button.className = "suggestion";
    button.type = "button";
    button.innerHTML = `${node.name || node.id}<small>${node.type} · Building ${node.building}, floor ${node.floor}</small>`;
    button.addEventListener("click", () => chooseSuggestion(field, node));
    container.append(button);
  }
}

async function search(field, value) {
  state.selected[field] = null;
  if (!value.trim()) {
    renderSuggestions(field, []);
    return;
  }
  const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
  if (response.ok) renderSuggestions(field, await response.json());
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
  state.currentFloor = payload.nodes[0].floor;
  renderFloorTabs();
  await loadMap();
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
  state.currentFloor = Number(state.floors[0]?.floor || 1);
  renderFloorTabs();
  setupSearch("from");
  setupSearch("to");
  $("#route-button").addEventListener("click", calculateRoute);
  await loadMap();
}

initialize().catch((error) => {
  console.error(error);
  setStatus("The application could not load its map data.", true);
});
