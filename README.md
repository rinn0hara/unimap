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
- `POST /api/graph` — validate and atomically save `data/graph.json`
- `GET /api/nodes` — all navigation nodes
- `GET /api/search?q=...` — node autocomplete/search
- `POST /api/route` — Dijkstra route calculation

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

The response contains the node ID sequence, physical distance, preference-adjusted cost, and coordinates for rendering.

## Graph data

The initial sample is split by floor:

- `data/building1_floor1.json`
- `data/building1_floor2.json`

The loader combines these files until the editor saves a canonical `data/graph.json`. Once `graph.json` exists, it is the source of truth.

Maps are independent SVG files:

- `maps/building1_floor1.svg`
- `maps/building1_floor2.svg`

Node IDs are the integration key between graph data and SVG elements. Distances are stored separately from routing cost. Stairs and outdoor edges receive a large preference penalty; elevator edges receive a discount when elevator preference is enabled.

## Graph editor workflow

1. Open `/editor`.
2. Choose a floor.
3. Use `Add node` and click the SVG background.
4. Select a node to edit its ID, type, name, floor, building, and coordinates.
5. Use `Add edge` and click two nodes.
6. Select an edge to edit distance, automatic-distance behavior, direction, and route flags.
7. Run validation.
8. Export JSON for a local file, or use `Save graph` to write `data/graph.json`.

The save endpoint is deliberately limited to the fixed project data location; it does not accept filesystem paths.

## Tests

```bash
uv run pytest -q
node --check static/assets/app.js
node --check static/assets/editor.js
```

The automated tests cover graph validation/loading, Dijkstra routing and preferences, search, static assets, editor API behavior, and graph persistence.
