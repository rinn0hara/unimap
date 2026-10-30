import {
  createGraphNode,
  createInterFloorEdge,
  canAutoCalculateDistance,
  hasExistingEdge,
  interFloorBadgePosition,
  interFloorEdgeLabel,
  interFloorEndpointsForFloor,
} from "./editor-model.mjs";
import { nodeDetails } from "./node-display.mjs";

const state = {
  graph: { nodes: [], edges: [], floors: [] },
  tool: "select",
  building: 1,
  floor: 1,
  selected: null,
  pendingEdge: null,
  pendingConnector: null,
  svg: null,
  drag: null,
  mapRequest: 0,
};

const $ = (selector) => document.querySelector(selector);
const canvas = $("#editor-map-canvas");
const status = $("#editor-status");
const validation = $("#validation");

const nodeTypes = ["street", "normal", "stairs", "elevator"];
const typeLabels = { street: "Улица", normal: "Точка", stairs: "Лестница", elevator: "Лифт" };
const typeColors = { street: "#2f9e62", normal: "#9aa8b6", stairs: "#df9d2c", elevator: "#4e87d9" };
let verifyToken = 0;
let pendingUploads = 0;

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
  if (tool !== "connector") state.pendingConnector = null;
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  if (state.svg) state.svg.className.baseVal = `editor-cursor-${tool}`;
  $("#interfloor-settings").hidden = tool !== "connector";
  $("#cancel-connector").hidden = tool !== "connector" || !state.pendingConnector;
  if (tool === "connector") {
    setStatus("Выберите точку лифта или лестницы, переключите этаж и выберите соответствующую точку.");
  } else if (state.selected) {
    setStatus("");
  }
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
  if (state.pendingConnector === node.id) {
    state.pendingConnector = null;
    $("#cancel-connector").hidden = true;
  }
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
  if (Number(from.building) !== Number(to.building) || Number(from.floor) !== Number(to.floor)) return 0;
  return Math.round(Math.hypot(Number(to.x) - Number(from.x), Number(to.y) - Number(from.y)) * 10) / 10;
}

function updateAutoDistances(nodeId) {
  const nodesById = new Map(state.graph.nodes.map((node) => [node.id, node]));
  for (const edge of state.graph.edges) {
    if (edge.autoDistance === false) continue;
    if (!canAutoCalculateDistance(edge, nodesById)) {
      edge.autoDistance = false;
      continue;
    }
    if (edge.from === nodeId || edge.to === nodeId) edge.distance = edgeDistance(edge);
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
    if (state.pendingEdge === node.id || state.pendingConnector === node.id) circle.classList.add("pending");
    circle.setAttribute("cx", node.x); circle.setAttribute("cy", node.y); circle.setAttribute("r", node.name ? "8" : "7");
    circle.style.fill = typeColors[node.type] || "#81909f";
    circle.dataset.nodeId = node.id;
    circle.addEventListener("pointerdown", (event) => startNodeInteraction(event, node));
    overlay.append(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("editor-node-label");
    label.setAttribute("x", Number(node.x) + 11);
    label.setAttribute("y", Number(node.y) - 10);
    label.textContent = node.name || node.id;
    overlay.append(label);
    if (node.label?.trim()) {
      const caption = document.createElementNS("http://www.w3.org/2000/svg", "text");
      caption.classList.add("editor-node-caption");
      caption.setAttribute("x", Number(node.x) + 11);
      caption.setAttribute("y", Number(node.y) + 13);
      caption.textContent = node.label.trim();
      overlay.append(caption);
    }
  }

  const interFloorEndpoints = interFloorEndpointsForFloor(
    state.graph.edges,
    state.graph.nodes,
    state.building,
    state.floor,
  );
  const labelIndexes = new Map();
  for (const item of interFloorEndpoints) {
    const previous = labelIndexes.get(item.endpoint.id) || 0;
    item.labelIndex = previous;
    labelIndexes.set(item.endpoint.id, previous + 1);
  }
  for (const { edge, endpoint, other, labelIndex } of interFloorEndpoints) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("editor-interfloor-edge");
    if (state.selected?.type === "edge" && state.selected.value === edgeIndex(edge)) group.classList.add("selected");
    if (state.pendingConnector === endpoint.id) group.classList.add("pending");
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    const label = interFloorEdgeLabel(edge, endpoint, other);
    group.setAttribute("aria-label", label);
    const badge = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    badge.setAttribute("x", "0");
    badge.setAttribute("y", "0");
    const badgeWidth = Math.max(98, 20 + label.length * 6);
    badge.setAttribute("width", String(badgeWidth));
    badge.setAttribute("height", "21");
    badge.setAttribute("rx", "8");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "7");
    text.setAttribute("y", "14");
    text.textContent = label;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${label} · ${other.name || other.id}`;
    group.append(badge, text, title);
    const rawViewBox = state.svg.viewBox.baseVal;
    const viewBox = { x: rawViewBox.x, y: rawViewBox.y, width: rawViewBox.width, height: rawViewBox.height };
    const { x: labelX, y: labelY } = interFloorBadgePosition(endpoint, labelIndex, badgeWidth, viewBox);
    group.setAttribute("transform", `translate(${labelX} ${labelY})`);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.tool === "delete") removeEdge(edge);
      else if (state.tool === "select") selectObject("edge", edgeIndex(edge));
    });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (state.tool === "select") selectObject("edge", edgeIndex(edge));
      else if (state.tool === "delete") removeEdge(edge);
    });
    overlay.append(group);
  }
  state.svg.append(overlay);
}

function startNodeInteraction(event, node) {
  event.stopPropagation();
  if (state.tool === "delete") { removeNode(node); return; }
  if (state.tool === "connector") { connectAcrossFloors(node); return; }
  if (state.tool === "edge") {
    if (!state.pendingEdge) state.pendingEdge = node.id;
    else if (state.pendingEdge !== node.id) {
      const exists = hasExistingEdge(state.graph.edges, state.pendingEdge, node.id);
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

function connectAcrossFloors(node) {
  if (!state.pendingConnector) {
    state.pendingConnector = node.id;
    if (node.type === "elevator" || node.type === "stairs") {
      $("#interfloor-kind").value = node.type;
    }
    $("#cancel-connector").hidden = false;
    state.selected = { type: "node", value: node.id };
    renderOverlay();
    renderProperties();
    setStatus(`Выбрана точка ${node.name || node.id}: корпус ${node.building}, этаж ${node.floor}. Переключите этаж и выберите соответствующую точку.`);
    return;
  }

  const from = nodeById(state.pendingConnector);
  try {
    const edge = createInterFloorEdge(from, node, {
      kind: $("#interfloor-kind").value,
      distance: $("#interfloor-distance").value,
      bidirectional: $("#interfloor-bidirectional").checked,
    });
    if (hasExistingEdge(state.graph.edges, edge.from, edge.to)) {
      throw new Error("Эти точки уже соединены.");
    }
    state.graph.edges.push(edge);
    state.pendingConnector = null;
    $("#cancel-connector").hidden = true;
    state.selected = { type: "edge", value: edgeIndex(edge) };
    updateStats();
    renderOverlay();
    renderProperties();
    setStatus(`Переход добавлен: корпус ${from.building}, этаж ${from.floor} ↔ корпус ${node.building}, этаж ${node.floor}.`);
  } catch (error) {
    setStatus(error.message || "Не удалось соединить точки.", true);
  }
}

function cancelPendingConnector() {
  if (!state.pendingConnector) return;
  state.pendingConnector = null;
  $("#cancel-connector").hidden = true;
  renderOverlay();
  setStatus("Создание перехода отменено.");
}

function validatePendingConnector() {
  if (!state.pendingConnector) return;
  const node = nodeById(state.pendingConnector);
  if (node) return;
  state.pendingConnector = null;
  $("#cancel-connector").hidden = true;
  setStatus("Выбранная точка перехода больше недоступна. Начните создание перехода заново.", true);
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
  if (!state.selected) { title.textContent = "Ничего не выбрано"; container.className = "empty-state"; container.textContent = "Выберите точку или связь, чтобы изменить её свойства."; return; }
  container.className = "editor-form";
  if (state.selected.type === "node") renderNodeProperties(title, container, nodeById(state.selected.value));
  else renderEdgeProperties(title, container, state.graph.edges[state.selected.value]);
}

function renderNodeProperties(title, container, node) {
  if (!node) { state.selected = null; renderProperties(); return; }
  title.textContent = "Свойства точки";
  container.innerHTML = `
    ${formInput("Идентификатор", "id", node.id)}
    <label>Тип<select id="property-type">${nodeTypes.map((type) => `<option value="${type}" ${type === node.type ? "selected" : ""}>${typeLabels[type]}</option>`).join("")}</select></label>
    ${formInput("Название", "name", node.name || "")}
    ${formInput("Подпись на карте", "label", node.label || "")}
    <label>Описание<textarea id="property-description" rows="4" placeholder="Расскажите об этом месте"></textarea></label>
    <label>Теги через запятую<input id="property-tags" type="text" placeholder="Например: библиотека, книги"></label>
    ${formInput("Корпус", "building", node.building, "number")}
    ${formInput("Этаж", "floor", node.floor, "number")}
    <div class="inline-fields">${formInput("Координата X", "x", node.x, "number")}${formInput("Координата Y", "y", node.y, "number")}</div>
    <label class="photo-upload">Выбрать фотографии<input id="property-photo-file" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
    <p class="field-hint">JPEG, PNG или WebP, до 8 МБ на фото.</p>
    <label>Адрес фотографии<input id="property-photo-url" type="url" placeholder="https://… или /uploads/…"></label>
    <button id="add-photo-url" class="secondary" type="button">Добавить по адресу</button>
    <div id="node-photos" class="editor-photos"></div>
    <button id="delete-selected" class="danger" type="button">Удалить точку</button>`;
  ["id", "type", "name", "label", "building", "floor", "x", "y"].forEach((field) => $(`#property-${field}`).addEventListener("change", () => updateNode(node, field)));
  $("#property-description").value = node.description || "";
  $("#property-description").addEventListener("input", (event) => { node.description = event.target.value; });
  $("#property-tags").value = (node.tags || []).join(", ");
  $("#property-tags").addEventListener("input", (event) => { node.tags = event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean); });
  $("#property-photo-file").addEventListener("change", (event) => uploadNodePhotos(node, [...event.target.files]));
  $("#add-photo-url").addEventListener("click", () => {
    const input = $("#property-photo-url");
    if (!input.value.trim()) return;
    node.photos = [...new Set([...nodeDetails(node).photos, input.value.trim()])];
    delete node.photo;
    input.value = "";
    renderNodePhotos(node);
  });
  renderNodePhotos(node);
  $("#delete-selected").addEventListener("click", () => removeNode(node));
}

function renderNodePhotos(node) {
  const container = $("#node-photos");
  container.replaceChildren();
  nodeDetails(node).photos.forEach((photo, index) => {
    const item = document.createElement("div");
    item.className = "editor-photo";
    const image = document.createElement("img");
    image.className = "photo-preview";
    image.src = photo;
    image.alt = `Фото ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = `Удалить фото ${index + 1}`;
    remove.addEventListener("click", () => {
      node.photos = nodeDetails(node).photos.filter((_, photoIndex) => photoIndex !== index);
      delete node.photo;
      renderNodePhotos(node);
      setStatus("Фото удалено из точки. Сохраните граф, чтобы применить изменения.");
    });
    item.append(image, remove);
    container.append(item);
  });
}

async function uploadNodePhotos(node, files) {
  if (!files.length) return;
  const save = $("#save-button");
  pendingUploads += 1;
  save.disabled = true;
  setStatus("Загружаем фотографии…");
  const errors = [];
  try {
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        errors.push(`${file.name}: нужен JPEG, PNG или WebP размером до 8 МБ`);
        continue;
      }
      try {
        const response = await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": file.type, "X-Admin-Token": currentAdminPassword() },
          body: file,
        });
        const payload = await response.json();
        if (response.status === 401) throw new Error("неверный пароль администратора");
        if (!response.ok) throw new Error(response.status === 413 ? "фото слишком большое" : "не удалось загрузить фото");
        node.photos = [...nodeDetails(node).photos, payload.photo];
        delete node.photo;
      } catch (error) {
        errors.push(`${file.name}: ${error.message || "ошибка загрузки"}`);
      }
    }
    if (state.selected?.type === "node" && state.selected.value === node.id) renderNodePhotos(node);
    setStatus(errors.length ? `Не все фото загружены: ${errors.join("; ")}. Сохраните граф для сохранения загруженных фото.` : "Фото загружены. Сохраните граф, чтобы применить изменения.", errors.length > 0);
  } finally {
    pendingUploads -= 1;
    save.disabled = pendingUploads > 0;
    if (state.selected?.type === "node" && state.selected.value === node.id) $("#property-photo-file").value = "";
  }
}

function updateNode(node, field) {
  const input = $(`#property-${field}`);
  const oldId = node.id;
  if (field === "label") node[field] = input.value.trim() || undefined;
  else node[field] = ["building", "floor", "x", "y"].includes(field) ? Number(input.value) : input.value;
  if (field === "id" && node.id !== oldId) {
    if (!node.id || state.graph.nodes.some((item) => item !== node && item.id === node.id)) { node.id = oldId; input.value = oldId; setStatus("Идентификатор точки должен быть непустым и уникальным.", true); return; }
    state.graph.edges.forEach((edge) => { if (edge.from === oldId) edge.from = node.id; if (edge.to === oldId) edge.to = node.id; });
    state.selected.value = node.id;
  }
  if (["building", "floor"].includes(field)) updateAutoDistances(node.id);
  if (["x", "y"].includes(field)) updateAutoDistances(node.id);
  renderOverlay(); updateStats();
}

function renderEdgeProperties(title, container, edge) {
  if (!edge) { state.selected = null; renderProperties(); return; }
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  const isInterFloor = from && to
    && (Number(from.building) !== Number(to.building) || Number(from.floor) !== Number(to.floor));
  title.textContent = isInterFloor ? "Переход между этажами" : "Свойства связи";
  const canAutoDistance = canAutoCalculateDistance(edge, new Map(state.graph.nodes.map((node) => [node.id, node])));
  if (!canAutoDistance) edge.autoDistance = false;
  container.innerHTML = `${formInput("Расстояние", "distance", edge.distance, "number")}<label class="checkbox-row"><input id="property-auto-distance" type="checkbox" ${edge.autoDistance !== false && canAutoDistance ? "checked" : ""} ${canAutoDistance ? "" : "disabled"}> Рассчитывать автоматически</label><label class="checkbox-row"><input id="property-stairs" type="checkbox" ${edge.stairs ? "checked" : ""}> Лестница</label><label class="checkbox-row"><input id="property-elevator" type="checkbox" ${edge.elevator ? "checked" : ""}> Лифт</label><label class="checkbox-row"><input id="property-outdoor" type="checkbox" ${edge.outdoor ? "checked" : ""}> На улице</label><label class="checkbox-row"><input id="property-bidirectional" type="checkbox" ${edge.bidirectional !== false ? "checked" : ""}> В обоих направлениях</label><button id="delete-selected" class="danger" type="button">Удалить связь</button>`;
  const endpointSummary = document.createElement("p");
  endpointSummary.className = "stat";
  endpointSummary.textContent = isInterFloor
    ? `${from.name || from.id} · корп. ${from.building}, эт. ${from.floor} ↔ ${to.name || to.id} · корп. ${to.building}, эт. ${to.floor}`
    : `${edge.from} → ${edge.to}`;
  container.prepend(endpointSummary);
  $("#property-distance").disabled = edge.autoDistance !== false && canAutoDistance;
  ["distance", "auto-distance", "stairs", "elevator", "outdoor", "bidirectional"].forEach((field) => $("#property-" + field).addEventListener("change", () => updateEdge(edge, field)));
  $("#delete-selected").addEventListener("click", () => removeEdge(edge));
}

function updateEdge(edge, field) {
  const canAutoDistance = canAutoCalculateDistance(
    edge,
    new Map(state.graph.nodes.map((node) => [node.id, node])),
  );
  if (field === "auto-distance") edge.autoDistance = canAutoDistance && $("#property-auto-distance").checked;
  else if (field === "distance") {
    edge.distance = Number($("#property-distance").value);
    if (!Number.isFinite(edge.distance) || edge.distance < 0) {
      edge.distance = 0;
      setStatus("Расстояние должно быть неотрицательным.", true);
    }
  }
  else edge[field] = $("#property-" + field).checked;
  if (edge.autoDistance !== false && canAutoDistance) edge.distance = edgeDistance(edge);
  renderProperties(); renderOverlay();
}

function updateStats() { $("#graph-stat").textContent = `Точек: ${state.graph.nodes.length} · связей: ${state.graph.edges.length}`; }

function validateGraph() {
  const messages = [];
  const ids = state.graph.nodes.map((node) => node.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) messages.push(`✗ Повторяющиеся идентификаторы: ${[...new Set(duplicates)].join(", ")}`); else messages.push("✓ Идентификаторы точек уникальны");
  const known = new Set(ids);
  const missing = state.graph.edges.filter((edge) => !known.has(edge.from) || !known.has(edge.to));
  if (missing.length) messages.push(`✗ Связей с отсутствующими точками: ${missing.length}`); else messages.push("✓ Все связи ссылаются на существующие точки");
  const unnamed = state.graph.nodes.filter((node) => !String(node.name || "").trim());
  if (unnamed.length) messages.push(`⚠ Точек без названия: ${unnamed.length}`); else messages.push("✓ У всех точек есть названия");
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
  if (disconnected) messages.push(`⚠ Недоступных точек: ${disconnected}`); else messages.push("✓ Все точки связаны");
  const edgeKeys = state.graph.edges.map((edge) => `${edge.from}>${edge.to}`);
  const duplicateEdges = edgeKeys.filter((key, index) => edgeKeys.indexOf(key) !== index);
  if (duplicateEdges.length) messages.push(`✗ Повторяющиеся связи: ${[...new Set(duplicateEdges)].join(", ")}`); else messages.push("✓ Повторяющихся связей нет");
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
  setStatus("Файл графа скачан.");
}

function currentAdminPassword() {
  return $("#admin-password").value;
}

async function saveGraph() {
  if (!validateGraph()) {
    setStatus("Исправьте ошибки проверки перед сохранением.", true);
    return;
  }
  verifyToken += 1; // ignore in-flight password checks, save status is authoritative
  setStatus("Сохраняем граф…");
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
    setStatus("Неверный пароль. Введите пароль администратора в панели слева.", true);
    return;
  }
  if (!response.ok) {
    setStatus("Не удалось сохранить граф. Проверьте данные точек и связей.", true);
    return;
  }
  setStatus(`Граф сохранён: ${payload.file}.`);
}


async function loadFloor() {
  const request = ++state.mapRequest;
  const floor = state.graph.floors.find((item) => Number(item.building) === Number(state.building)
    && Number(item.floor) === Number(state.floor));
  canvas.classList.add("loading");
  canvas.setAttribute("aria-busy", "true");
  if (!floor) {
    if (request === state.mapRequest) {
      state.svg = null;
      canvas.textContent = "Для этого корпуса и этажа карта не настроена.";
      canvas.classList.remove("loading");
      canvas.setAttribute("aria-busy", "false");
    }
    return;
  }
  try {
    const response = await fetch(`/maps/${encodeURIComponent(floor.map)}`);
    if (!response.ok) throw new Error(`Could not load map: ${floor.map}`);
    const mapMarkup = await response.text();
    if (request !== state.mapRequest) return;
    validatePendingConnector();
    canvas.innerHTML = mapMarkup;
    state.svg = canvas.querySelector("svg");
    state.svg.classList.add(`editor-cursor-${state.tool}`);
    setupMapInteractions();
    $("#map-title").textContent = `Корпус ${floor.building} · Этаж ${floor.floor}`;
    renderOverlay();
  } finally {
    if (request === state.mapRequest) {
      canvas.classList.remove("loading");
      canvas.setAttribute("aria-busy", "false");
    }
  }
}

function renderFloorOptions() {
  const select = $("#floor-select"); select.replaceChildren();
  state.graph.floors.forEach((floor) => { const option = document.createElement("option"); option.value = `${floor.building}:${floor.floor}`; option.textContent = `Корпус ${floor.building} · Этаж ${floor.floor}`; select.append(option); });
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
          ? "Пароль принят. Сохранение доступно."
          : "Неверный пароль администратора.",
        !verify.ok
      );
    } catch {
      if (token !== verifyToken) return;
      setStatus("Не удалось проверить пароль администратора.", true);
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
$("#cancel-connector").addEventListener("click", cancelPendingConnector);

$("#floor-select").addEventListener("change", async (event) => {
  const [building, floor] = event.target.value.split(":").map(Number);
  state.building = building;
  state.floor = floor;
  state.selected = null;
  state.pendingEdge = null;
  state.drag = null;
  renderProperties();
  await loadFloor();
});

$("#validate-button").addEventListener("click", () => { const valid = validateGraph(); setStatus(valid ? "Проверка графа пройдена." : "При проверке найдены ошибки.", !valid); });
$("#save-button").addEventListener("click", () => saveGraph().catch((error) => { console.error(error); setStatus("Не удалось сохранить граф.", true); }));
$("#export-button").addEventListener("click", exportGraph);
$("#import-input").addEventListener("change", async (event) => { const file = event.target.files[0]; if (!file) return; try { state.graph = JSON.parse(await file.text()); state.selected = null; state.pendingConnector = null; $("#cancel-connector").hidden = true; state.building = Number(state.graph.floors?.[0]?.building || state.graph.nodes?.[0]?.building || 1); state.floor = Number(state.graph.floors?.[0]?.floor || state.graph.nodes?.[0]?.floor || 1); renderFloorOptions(); updateStats(); renderProperties(); await loadFloor(); setStatus("Граф загружен из файла."); } catch { setStatus("Не удалось прочитать файл графа.", true); } });

initialize().catch((error) => { console.error(error); setStatus("Не удалось загрузить редактор графа.", true); validation.textContent = "Проверьте доступность карты и данных графа."; validation.classList.add("error"); });
