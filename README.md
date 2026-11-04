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
`X-Admin-Token` header on every `POST /api/graph` and `POST /api/photos` request. Use the
menu in the upper-right corner of the navigation page to verify the password and open
the editor. The password is remembered in session storage and can be changed in the
editor. The password
comes from the `UNIMAP_ADMIN_PASSWORD` environment variable and falls back to
`admin` for local development:

```bash
UNIMAP_ADMIN_PASSWORD="strong-secret" uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

The menu is a convenience login, not a server-side access barrier: viewing `/editor`
directly and the graph read APIs (`GET /api/graph`, `GET /api/nodes`, `GET /api/search`,
`POST /api/route`) stays open — only saving and uploads are restricted. Set a strong
password and use HTTPS on an untrusted network; the local-development default and plain
HTTP do not protect credentials in transit.

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

Nodes can have a `description`, a list of `tags`, and a list of `photos`. Tags are
searchable along with the node's name, ID, and map caption. Upload multiple JPEG, PNG,
or WebP photos in the editor (maximum 8 MB per file), or add image URLs. Uploads are
stored in `data/photos/`; save the graph to persist their URLs. Existing graphs with a
single `photo` field remain supported and are displayed alongside `photos`. Removing
an image from a node does not delete its uploaded file from disk.

## Graph editor workflow

1. Open the menu on the navigation page and enter the admin password to open the editor.
2. The password is retained for the browser session and is required for saving and uploading.
3. Choose a floor.
4. Choose the default type and optional name, select `Add node`, and click the SVG background; the new point is created with those defaults and its name field is focused.
5. Select a node to edit its properties, description, comma-separated tags, and photos.
6. Use `Add edge` and click two nodes on the same floor. For a lift, stairs, or other cross-floor connection, select `Connect floors`, click the first point, switch to the destination floor, and click the paired point. Create one connection for each floor transition; in `Select / move`, click a connection badge to change its distance/direction or delete it.
7. Select an edge or floor-connection badge to edit distance, direction, and route flags.
8. Run validation.
9. Export JSON for a local file, or use `Save graph` to write `data/graph.json`.

The save endpoint is deliberately limited to the fixed project data location; it does not accept filesystem paths.

## Navigation UI

- Click a point on the map to open its card with description, tags, and photos. The card's buttons set the point as start or destination.
- The picker above the map shows the chosen start and destination and can activate map picking, clear a slot, or swap points. Both search fields also find points by tag.
- A calculated route is split into per-building-and-floor segments. Route instructions use the traversed edge's stairs/elevator flags, and each step button switches to the correct building/floor and highlights the next route vertex. Floor tabs are labelled by building and floor to disambiguate matching floor numbers in different buildings.
- Inter-floor edges are represented by a labelled endpoint marker at each connected vertex, not by a line between unrelated SVG coordinate systems. The marker tells you which floor/building the connection continues to, and selecting it shows/edits the connection.
- A legend under the map explains the marker colors (street/normal/stairs/elevator/route).

Static assets are served with `Cache-Control: no-store`, so browsers always run the
latest JavaScript (fixes stale-UI issues after updates).

### Route cost and preferences

The router uses Dijkstra's algorithm over graph **edges**; edge distances are the
physical weights. `stairs` and `outdoor` are not hard blocks: when the corresponding
avoid option is on, each such edge receives a large cost penalty, so the router will
choose an alternative when one exists, but can still return the only connected route.
`prefer_elevator` reduces the calculated cost of elevator edges by 20%. The response
keeps physical `distance` separate from preference-adjusted `cost` and returns the
preference flags used for calculation. The navigation UI warns if the selected route
still contains stairs/outdoor edges that were asked to be avoided, or has no elevator
despite the elevator preference.

Map captions are separate from room names and node IDs. Add optional `label` text in
the editor's map caption field to show a brief landmark cue beside the graph point;
it appears on navigation and editor floor plans and is also
searchable. Leave the field blank for an unlabelled point.

## Tests

```bash
uv run pytest -q
node --check static/assets/app.js
node --check static/assets/editor.js
node tests/route-model.test.mjs
node tests/editor-model.test.mjs
node tests/node-display.test.mjs
```

The automated tests cover graph validation/loading, Dijkstra routing and preferences, unavoidable preference violations, cross-building/floor transitions, photo upload validation and persistence, caption search, static assets, editor API behavior, and graph persistence. Node.js tests cover the route model, generated editor-node defaults, captions, and inter-floor edge creation and rendering labels.
