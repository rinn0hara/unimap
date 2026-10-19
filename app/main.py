from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.graph import GraphDocument, Node, load_graph_document, save_graph
from app.routing import RouteNotFoundError, calculate_route


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MAPS_DIR = PROJECT_ROOT / "maps"
STATIC_DIR = PROJECT_ROOT / "static"

app = FastAPI(title="Indoor University Navigation System")
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
app.mount("/maps", StaticFiles(directory=MAPS_DIR), name="maps")


def get_graph() -> GraphDocument:
    return load_graph_document(DATA_DIR)


class RouteRequest(BaseModel):
    from_: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)
    avoid_stairs: bool = False
    avoid_outdoor: bool = False
    prefer_elevator: bool = False

    model_config = {"populate_by_name": True}


def node_response(node: Node) -> dict[str, object]:
    return {
        "id": node.id,
        "type": node.type,
        "name": node.name,
        "building": node.building,
        "floor": node.floor,
        "x": node.x,
        "y": node.y,
    }


@app.get("/", response_class=FileResponse)
def frontend() -> Path:
    return STATIC_DIR / "index.html"


@app.get("/editor", response_class=FileResponse)
def editor() -> Path:
    return STATIC_DIR / "editor.html"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/nodes")
def nodes() -> list[dict[str, object]]:
    return [node_response(node) for node in get_graph().nodes]


@app.get("/api/graph")
def graph_document() -> dict[str, object]:
    return get_graph().model_dump(by_alias=True, exclude_none=True)


@app.post("/api/graph")
def save_graph_document(document: GraphDocument) -> dict[str, str]:
    path = save_graph(DATA_DIR, document)
    persisted = load_graph_document(DATA_DIR)
    if persisted != document:
        raise HTTPException(status_code=500, detail="saved graph did not match readback")
    return {"status": "saved", "file": path.name}


@app.get("/api/search")
@app.get("/search")
def search_rooms(q: str = Query(min_length=1)) -> list[dict[str, object]]:
    query = q.strip().casefold()
    if not query:
        return []

    graph = get_graph()
    matches = [
        {
            "id": node.id,
            "name": node.name,
            "building": node.building,
            "floor": node.floor,
            "type": node.type,
        }
        for node in graph.nodes
        if query in node.id.casefold() or query in (node.name or "").casefold()
    ]
    return sorted(matches, key=lambda result: str(result["name"]))


@app.post("/api/route")
def route(request: RouteRequest) -> dict[str, object]:
    graph = get_graph()
    try:
        result = calculate_route(
            graph,
            request.from_,
            request.to,
            avoid_stairs=request.avoid_stairs,
            avoid_outdoor=request.avoid_outdoor,
            prefer_elevator=request.prefer_elevator,
        )
    except (KeyError, RouteNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    route_nodes = [graph.nodes_by_id[node_id] for node_id in result.route]
    return {
        "route": result.route,
        "distance": result.distance,
        "cost": result.cost,
        "nodes": [node_response(node) for node in route_nodes],
    }
