import { createGraphNode } from "./editor-model.mjs";

const state = {
  graph: { nodes: [], edges: [], floors: [] },
  tool: "select",
  building: 1,
  floor: 1,
  selected: null,
  pendingEdge: null,
  svg: null,
  drag: null,
};

const $ = (selector) => document.querySelector(selector);
const canvas = $("#editor-map-canvas");
const status = $("#editor-status");
const validation = $("#validation");

const nodeTypes = ["street", "normal", "stairs", "elevator"];
const typeColors = { street: "#2f9e62", normal: "#9aa8b6", stairs: "#df9d2c", elevator: "#4e87d9" };
let verifyToken = 0;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function visibleNodes() {
  return state.graph.nodes.filter((node) => Number(node.building) === Number(state.building)
    && Number(node.floor) === Number(state.floor));
}

function visibleEdges() {
  const ids = new Set(visibleNodes().map((node) => node.id));
  return state.graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
}

function setTool(tool) {
  state.tool = tool;
  state.pendingEdge = null;
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  if (state.svg) state.svg.className.baseVal = `editor-cursor-${tool}`;
  renderOverlay();
}

function pointFromEvent(event) {
  const point = state.svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(state.svg.getScreenCTM().inverse());
  return { x: Math.round(transformed.x), y: Math.round(transformed.y) };
}

function nodeById(id) {
  return state.graph.nodes.find((node) => node.id === id);
}

function edgeIndex(edge) {
  return state.graph.edges.indexOf(edge);
}

function selectObject(type, value) {
  state.selected = { type, value };
  renderOverlay();
  renderProperties();
}

function removeNode(node) {
  state.graph.nodes = state.graph.nodes.filter((item) => item !== node);
  state.graph.edges = state.graph.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
  state.selected = null;
  renderOverlay();
  renderProperties();
  updateStats();
}

function removeEdge(edge) {
  state.graph.edges = state.graph.edges.filter((item) => item !== edge);
  state.selected = null;
  renderOverlay();
  renderProperties();
  updateStats();
}

function edgeDistance(edge) {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  if (!from || !to) return 0;
  return Math.round(Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y)) * 10) / 10;
}

function updateAutoDistances(nodeId) {
  for (const edge of state.graph.edges) {
    if (edge.autoDistance !== false && (edge.from === nodeId || edge.to === nodeId)) {
      edge.distance = edgeDistance(edge);
    }
  }
}

function renderOverlay() {
  if (!state.svg) return;
  state.svg.querySelector(".editor-overlay")?.remove();
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  overlay.classList.add("editor-overlay");

  for (const edge of visibleEdges()) {
    const from = nodeById(edge.from);
    const to = nodeById(edge.to);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("editor-edge");
    if (state.selected?.type === "edge" && state.selected.value === edgeIndex(edge)) line.classList.add("selected");
    line.setAttribute("x1", from.x); line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x); line.setAttribute("y2", to.y);
    line.dataset.edgeIndex = edgeIndex(edge);
    line.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.tool === "delete") removeEdge(edge);
      else if (state.tool === "select") selectObject("edge", edgeIndex(edge));
    });
    overlay.append(line);
  }

  for (const node of visibleNodes()) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.classList.add("editor-node");
    if (state.selected?.type === "node" && state.selected.value === node.id) circle.classList.add("selected");
    if (state.pendingEdge === node.id) circle.classList.add("pending");
    circle.setAttribute("cx", node.x); circle.setAttribute("cy", node.y); circle.setAttribute("r", node.name ? "8" : "7");
    circle.style.fill = typeColors[node.type] || "#81909f";
    circle.dataset.nodeId = node.id;
    circle.addEventListener("pointerdown", (event) => startNodeInteraction(event, node));
    overlay.append(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("editor-node-label");
    label.setAttribute("x", Number(node.x) + 11); label.setAttribute("y", Number(node.y) - 10);
    label.textContent = node.name || node.id;
    overlay.append(label);
  }
  state.svg.append(overlay);
}

function startNodeInteraction(event, node) {
  event.stopPropagation();
  if (state.tool === "delete") { removeNode(node); return; }
  if (state.tool === "edge") {
    if (!state.pendingEdge) state.pendingEdge = node.id;
    else if (state.pendingEdge !== node.id) {
      const exists = state.graph.edges.some((edge) => (edge.from === state.pendingEdge && edge.to === node.id) || (edge.bidirectional !== false && edge.from === node.id && edge.to === state.pendingEdge));
      if (!exists) state.graph.edges.push({ from: state.pendingEdge, to: node.id, distance: edgeDistance({ from: state.pendingEdge, to: node.id }), stairs: false, elevator: false, outdoor: false, bidirectional: true, autoDistance: true });
      state.pendingEdge = null;
      updateStats();
    }
    renderOverlay();
    return;
  }
  if (state.tool === "select") {
    selectObject("node", node.id);
    state.drag = { node, pointerId: event.pointerId };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
  }
}

function setupMapInteractions() {
  state.svg.addEventListener("click", (event) => {
    if (state.tool !== "node" || event.target.closest(".editor-overlay")) return;
    const point = pointFromEvent(event);
    const selectedFloor = state.graph.floors.find((floor) => Number(floor.building) === Number(state.building)
      && Number(floor.floor) === Number(state.floor));
    const node = createGraphNode(state.graph.nodes, {
      building: Number(selectedFloor?.building || 1),
      floor: state.floor,
      x: point.x,
      y: point.y,
      type: $("#new-node-type").value,
      name: $("#new-node-name").value,
    });
    const id = node.id;
    state.graph.nodes.push(node);
    selectObject("node", id);
    updateStats();
    $("#property-name")?.focus();
    $("#property-name")?.select();
  });
  state.svg.addEventListener("pointermove", (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    state.drag.node.x = point.x; state.drag.node.y = point.y;
    updateAutoDistances(state.drag.node.id);
    renderOverlay();
  });
  state.svg.addEventListener("pointerup", (event) => {
    if (state.drag?.pointerId === event.pointerId) state.drag = null;
  });
}

function formInput(label, id, value, type = "text") {
  const escaped = String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<label>${label}<input id="property-${id}" type="${type}" value="${escaped}"></label>`;
}

function renderProperties() {
  const title = $("#properties-title");
  const container = $("#properties");
  if (!state.selected) { title.textContent = "Nothing selected"; container.className = "empty-state"; container.innerHTML = "Select a node or edge to edit its properties."; return; }
  container.className = "editor-form";
  if (state.selected.type === "node") renderNodeProperties(title, container, nodeById(state.selected.value));
  else renderEdgeProperties(title, container, state.graph.edges[state.selected.value]);
}

function renderNodeProperties(title, container, node) {
  if (!node) { state.selected = null; renderProperties(); return; }
  title.textContent = "Node properties";
  container.innerHTML = `${formInput("ID", "id", node.id)}<label>Type<select id="property-type">${nodeTypes.map((type) => `<option ${type === node.type ? "selected" : ""}>${type}</option>`).join("")}</select></label>${formInput("Name", "name", node.name || "")}${formInput("Building", "building", node.building, "number")}${formInput("Floor", "floor", node.floor, "number")}<div class="inline-fields">${formInput("X", "x", node.x, "number")}${formInput("Y", "y", node.y, "number")}</div>${formInput("Photo URL", "photo", node.photo || "")}<label>Upload photo<input id="property-photo-file" type="file" accept="image/jpeg,image/png,image/webp"></label><img id="node-photo-preview" class="photo-preview" alt="Node reference photo" hidden><button id="remove-photo" class="secondary" type="button" ${node.photo ? "" : "hidden"}>Remove photo</button><button id="delete-selected" class="danger" type="button">Delete node</button>`;
  ["id", "type", "name", "building", "floor", "x", "y", "photo"].forEach((field) => $(`#property-${field}`).addEventListener("change", () => updateNode(node, field)));
  const preview = $("#node-photo-preview");
  if (node.photo) {
    preview.src = node.photo;
    preview.hidden = false;
  }
  $("#property-photo-file").addEventListener("change", (event) => uploadNodePhoto(node, event.target.files[0]));
  $("#remove-photo").addEventListener("click", () => {
    node.photo = undefined;
    $("#property-photo").value = "";
    preview.removeAttribute("src");
    preview.hidden = true;
    $("#remove-photo").hidden = true;
    setStatus("Photo removed from this node. Save the graph to keep the change.");
  });
  $("#delete-selected").addEventListener("click", () => removeNode(node));
}

async function uploadNodePhoto(node, file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    setStatus("Photo exceeds the 8 MB limit.", true);
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus("Choose a JPEG, PNG, or WebP image.", true);
    return;
  }
  setStatus("Uploading photo…");
  try {
    const response = await fetch("/api/photos", {
      method: "POST",
      headers: { "Content-Type": file.type, "X-Admin-Token": currentAdminPassword() },
      body: file,
    });
    const payload = await response.json();
    if (response.status === 401) throw new Error("Wrong admin password. Enter the password in the left panel.");
    if (!response.ok) throw new Error(payload.detail || "Could not upload photo.");
    node.photo = payload.photo;
    if (state.selected?.type === "node" && state.selected.value === node.id) {
      renderNodeProperties($("#properties-title"), $("#properties"), node);
    }
    setStatus("Photo uploaded. Save the graph to keep its reference.");
  } catch (error) {
    setStatus(error.message || "Could not upload photo.", true);
  }
}

function updateNode(node, field) {
  const input = $(`#property-${field}`);
  const oldId = node.id;
  if (field === "photo") node.photo = input.value.trim() || undefined;
  else node[field] = ["building", "floor", "x", "y"].includes(field) ? Number(input.value) : input.value;
  if (field === "id" && node.id !== oldId) {
    if (!node.id || state.graph.nodes.some((item) => item !== node && item.id === node.id)) { node.id = oldId; input.value = oldId; setStatus("Node IDs must be unique and non-empty.", true); return; }
    state.graph.edges.forEach((edge) => { if (edge.from === oldId) edge.from = node.id; if (edge.to === oldId) edge.to = node.id; });
    state.selected.value = node.id;
  }
  if (["x", "y"].includes(field)) updateAutoDistances(node.id);
  if (field === "photo") {
    const preview = $("#node-photo-preview");
    const removePhoto = $("#remove-photo");
    preview.src = node.photo || "";
    preview.hidden = !node.photo;
    removePhoto.hidden = !node.photo;
  }
  renderOverlay(); updateStats();
}

function renderEdgeProperties(title, container, edge) {
  if (!edge) { state.selected = null; renderProperties(); return; }
  title.textContent = "Edge properties";
  container.innerHTML = `<p class="stat">${edge.from} → ${edge.to}</p>${formInput("Distance", "distance", edge.distance, "number")}<label class="checkbox-row"><input id="property-auto-distance" type="checkbox" ${edge.autoDistance !== false ? "checked" : ""}> Calculate automatically</label><label class="checkbox-row"><input id="property-stairs" type="checkbox" ${edge.stairs ? "checked" : ""}> Stairs</label><label class="checkbox-row"><input id="property-elevator" type="checkbox" ${edge.elevator ? "checked" : ""}> Elevator</label><label class="checkbox-row"><input id="property-outdoor" type="checkbox" ${edge.outdoor ? "checked" : ""}> Outdoor</label><label class="checkbox-row"><input id="property-bidirectional" type="checkbox" ${edge.bidirectional !== false ? "checked" : ""}> Bidirectional</label><button id="delete-selected" class="danger" type="button">Delete edge</button>`;
  $("#property-distance").disabled = edge.autoDistance !== false;
  ["distance", "auto-distance", "stairs", "elevator", "outdoor", "bidirectional"].forEach((field) => $("#property-" + field).addEventListener("change", () => updateEdge(edge, field)));
  $("#delete-selected").addEventListener("click", () => removeEdge(edge));
}

function updateEdge(edge, field) {
  if (field === "auto-distance") edge.autoDistance = $("#property-auto-distance").checked;
  else if (field === "distance") edge.distance = Number($("#property-distance").value);
  else edge[field] = $("#property-" + field).checked;
  if (edge.autoDistance !== false) edge.distance = edgeDistance(edge);
  renderProperties(); renderOverlay();
}

function updateStats() { $("#graph-stat").textContent = `${state.graph.nodes.length} nodes · ${state.graph.edges.length} edges`; }

function validateGraph() {
  const messages = [];
  const ids = state.graph.nodes.map((node) => node.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) messages.push(`✗ Duplicate node IDs: ${[...new Set(duplicates)].join(", ")}`); else messages.push("✓ No duplicate node IDs");
  const known = new Set(ids);
  const missing = state.graph.edges.filter((edge) => !known.has(edge.from) || !known.has(edge.to));
  if (missing.length) messages.push(`✗ ${missing.length} edge(s) reference missing nodes`); else messages.push("✓ All edges reference existing nodes");
  const unnamed = state.graph.nodes.filter((node) => !String(node.name || "").trim());
  if (unnamed.length) messages.push(`⚠ ${unnamed.length} point(s) have no name (they are not searchable)`); else messages.push("✓ All points have names");
  const adjacency = new Map(state.graph.nodes.map((node) => [node.id, new Set()]));
  state.graph.edges.forEach((edge) => {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) return;
    adjacency.get(edge.from).add(edge.to);
    if (edge.bidirectional !== false) adjacency.get(edge.to).add(edge.from);
  });
  const reachable = new Set();
  const pending = state.graph.nodes.length ? [state.graph.nodes[0].id] : [];
  while (pending.length) {
    const nodeId = pending.pop();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    adjacency.get(nodeId)?.forEach((neighbor) => pending.push(neighbor));
  }
  const disconnected = state.graph.nodes.length - reachable.size;
  if (disconnected) messages.push(`⚠ ${disconnected} disconnected node(s)`); else messages.push("✓ All nodes are connected");
  const edgeKeys = state.graph.edges.map((edge) => `${edge.from}>${edge.to}`);
  const duplicateEdges = edgeKeys.filter((key, index) => edgeKeys.indexOf(key) !== index);
  if (duplicateEdges.length) messages.push(`✗ Duplicate directed edges: ${[...new Set(duplicateEdges)].join(", ")}`); else messages.push("✓ No duplicate directed edges");
  validation.textContent = messages.join("\n");
  validation.classList.toggle("error", messages.some((message) => message.startsWith("✗")));
  return !messages.some((message) => message.startsWith("✗"));
}

function exportGraph() {
  const payload = {
    nodes: state.graph.nodes,
    edges: state.graph.edges,
    floors: state.graph.floors,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "navigation-graph.json";
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus("Graph exported.");
}

function currentAdminPassword() {
  return $("#admin-password").value;
}

async function saveGraph() {
  if (!validateGraph()) {
    setStatus("Fix validation issues before saving.", true);
    return;
  }
  verifyToken += 1; // ignore in-flight password checks, save status is authoritative
  setStatus("Saving graph…");
  const response = await fetch("/api/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": currentAdminPassword() },
    body: JSON.stringify({
      nodes: state.graph.nodes,
      edges: state.graph.edges,
      floors: state.graph.floors,
    }),
  });
  const payload = await response.json();
  if (response.status === 401) {
    setStatus("Wrong admin password. Enter the admin password in the left panel to save.", true);
    return;
  }
  if (!response.ok) {
    setStatus(payload.detail || "Could not save graph.", true);
    return;
  }
  setStatus(`Saved ${payload.file}.`);
}


async function loadFloor() {
  const floor = state.graph.floors.find((item) => Number(item.building) === Number(state.building)
    && Number(item.floor) === Number(state.floor));
  if (!floor) return;
  const response = await fetch(`/maps/${encodeURIComponent(floor.map)}`);
  if (!response.ok) throw new Error(`Could not load map: ${floor.map}`);
  canvas.innerHTML = await response.text();
  state.svg = canvas.querySelector("svg");
  state.svg.classList.add(`editor-cursor-${state.tool}`);
  setupMapInteractions();
  $("#map-title").textContent = `Building ${floor.building} · Floor ${floor.floor}`;
  renderOverlay();
}

function renderFloorOptions() {
  const select = $("#floor-select"); select.replaceChildren();
  state.graph.floors.forEach((floor) => { const option = document.createElement("option"); option.value = `${floor.building}:${floor.floor}`; option.textContent = `Building ${floor.building} · Floor ${floor.floor}`; select.append(option); });
  select.value = `${state.building}:${state.floor}`;
}

async function initialize() {
  const adminPasswordInput = $("#admin-password");
  adminPasswordInput.value = sessionStorage.getItem("unimap-admin-password") || "";
  adminPasswordInput.addEventListener("change", async () => {
    sessionStorage.setItem("unimap-admin-password", adminPasswordInput.value);
    if (!adminPasswordInput.value) return;
    const token = ++verifyToken;
    try {
      const verify = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "X-Admin-Token": adminPasswordInput.value },
      });
      if (token !== verifyToken) return;
      setStatus(
        verify.ok
          ? "Admin password accepted — saving is unlocked."
          : "Admin password is incorrect.",
        !verify.ok
      );
    } catch {
      if (token !== verifyToken) return;
      setStatus("Could not verify the admin password.", true);
    }
  });
  const response = await fetch("/api/graph");
  if (!response.ok) throw new Error("Could not load graph");
  state.graph = await response.json();
  state.graph.nodes.forEach((node) => { node.x ??= 0; node.y ??= 0; });
  state.building = Number(state.graph.floors[0]?.building || 1);
  state.floor = Number(state.graph.floors[0]?.floor || 1);
  renderFloorOptions(); updateStats(); renderProperties(); await loadFloor();
}

document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));

$("#floor-select").addEventListener("change", async (event) => {
  const [building, floor] = event.target.value.split(":").map(Number);
  state.building = building;
  state.floor = floor;
  state.selected = null;
  state.pendingEdge = null;
  renderProperties();
  await loadFloor();
});

$("#validate-button").addEventListener("click", () => { const valid = validateGraph(); setStatus(valid ? "Graph is valid." : "Validation found issues.", !valid); });
$("#save-button").addEventListener("click", () => saveGraph().catch((error) => { console.error(error); setStatus("Could not save the graph.", true); }));
$("#export-button").addEventListener("click", exportGraph);
$("#import-input").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; try { state.graph = JSON.parse(await file.text()); state.building = Number(state.graph.floors?.[0]?.building || state.graph.nodes?.[0]?.building || 1); state.floor = Number(state.graph.floors?.[0]?.floor || state.graph.nodes?.[0]?.floor || 1); renderFloorOptions(); updateStats(); renderProperties(); await loadFloor(); setStatus("Graph imported."); } catch { setStatus("The selected file is not valid graph JSON.", true); } });

initialize().catch((error) => { console.error(error); setStatus("Could not load the graph editor.", true); validation.textContent = String(error.message); validation.classList.add("error"); });
