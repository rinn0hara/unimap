# UniMap

MVP indoor university navigation system.

The project uses FastAPI, JSON graph data, Dijkstra routing, SVG floor plans, and plain browser JavaScript. The graph editor is available at `/editor` and is intended for developers or administrators.

## Requirements

- Python 3.12+
- uv

## Run locally

Install the locked environment:

```bash
uv sync
```

Start the application on every local network interface:

```bash
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

Open the application locally at `http://127.0.0.1:8000/`. From another device on the same Wi-Fi network, use the laptop's local IP address, for example `http://192.168.1.100:8000/`.

## Routes

- `GET /` — navigation UI
- `GET /editor` — graph editor
- `GET /api/health` — health check
- `GET /api/graph` — validated graph document for the editor
- `POST /api/graph` — validate and atomically save `data/graph.json` (**admin only**)
- `POST /api/photos` — upload a JPEG, PNG, or WebP node photo (**admin only**, maximum 8 MB / 40 megapixels); send the raw image bytes with the matching `Content-Type`
- `GET /uploads/{filename}` — serve an uploaded node photo
- `POST /api/admin/verify` — check the admin password
- `GET /api/nodes` — all navigation nodes
- `GET /api/search?q=...` — node autocomplete/search
- `POST /api/route` — Dijkstra route calculation

### Admin password

Graph modification is protected by an admin password. Clients must send it in the
`X-Admin-Token` header on every `POST /api/graph` and `POST /api/photos` request; the editor keeps the
password in the "Admin password" field (remembered for the session). The password
comes from the `UNIMAP_ADMIN_PASSWORD` environment variable and falls back to
`admin` for local development:

```bash
UNIMAP_ADMIN_PASSWORD="strong-secret" uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

Viewing the editor and the graph read APIs (`GET /api/graph`, `GET /api/nodes`,
`GET /api/search`, `POST /api/route`) stays open — only saving is restricted.

Example route request:

```json
{
  "from": "main_entrance",
  "to": "room_201",
  "avoid_stairs": true,
  "avoid_outdoor": true,
  "prefer_elevator": true
}
```

The response contains the node ID sequence, each traversed edge and its transition flags, physical distance, preference-adjusted cost, and coordinates for rendering.

## Graph data

The initial sample is split by floor:

- `data/building1_floor1.json`
- `data/building1_floor2.json`

The loader combines these files until the editor saves a canonical `data/graph.json`. Once `graph.json` exists, it is the source of truth.

Maps are independent SVG files:

- `maps/building1_floor1.svg`
- `maps/building1_floor2.svg`

Node IDs are the integration key between graph data and SVG elements. Distances are stored separately from routing cost. Stairs and outdoor edges receive a large preference penalty; elevator edges receive a discount when elevator preference is enabled.

### Node classification

Node types are intentionally minimal and strict — exactly four:

- `street` — outdoor navigation point (streets, building entrances);
- `normal` — ordinary graph waypoint (corridors, rooms, doors, junctions);
- `stairs` — stairwell point (per floor);
- `elevator` — elevator point (per floor).

Old classifications (`room`, `corridor`, `door`, `intersection`, `entrance`, `connection`)
are **not** accepted any more: the API rejects them with a validation error, so graph
files must use the four types above.

Each node may carry an optional `photo` field. Upload JPEG, PNG, or WebP in the graph
editor (maximum 8 MB); the file is stored in `data/photos/` and its `/uploads/...`
URL is saved on the selected node when the graph is saved. A node's photo is shown
in the navigation panel when that point is selected or is the route destination.

## Graph editor workflow

1. Open `/editor`.
2. Enter the admin password (required for saving).
3. Choose a floor.
4. Choose the default type and optional name, select `Add node`, and click the SVG background; the new point is created with those defaults and its name field is focused.
5. Select a node to edit its ID, type, name, floor, building, coordinates, and photo URL, or upload a photo file.
6. Use `Add edge` and click two nodes.
7. Select an edge to edit distance, automatic-distance behavior, direction, and route flags.
8. Run validation.
9. Export JSON for a local file, or use `Save graph` to write `data/graph.json`.

The save endpoint is deliberately limited to the fixed project data location; it does not accept filesystem paths.

## Navigation UI

- A picker panel above the map shows the currently chosen start and destination, with buttons to activate picking, clear a slot, and swap the two points. Route points can be picked by clicking a vertex marker on the map — a click near a vertex snaps to it — or through the search fields; both ways stay in sync.
- A searchable point list groups vertices by building and floor. Start and Goal buttons select any vertex and switch the map to its building/floor.
- A calculated route is split into per-building-and-floor segments. Route instructions use the traversed edge's stairs/elevator flags, and each step button switches to the correct building/floor and highlights the next route vertex. Floor tabs are labelled by building and floor to disambiguate matching floor numbers in different buildings.
- A legend under the map explains the marker colors (street/normal/stairs/elevator/route).

Static assets are served with `Cache-Control: no-store`, so browsers always run the
latest JavaScript (fixes stale-UI issues after updates).

## Tests

```bash
uv run pytest -q
node --check static/assets/app.js
node --check static/assets/editor.js
node tests/route-model.test.mjs
node tests/editor-model.test.mjs
```

The automated tests cover graph validation/loading, Dijkstra routing and preferences, cross-building/floor transitions, photo upload validation and persistence, search, static assets, editor API behavior, and graph persistence. Node.js tests cover the route model and generated editor-node defaults.
