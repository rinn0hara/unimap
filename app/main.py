from __future__ import annotations

import os
import re
import secrets
from io import BytesIO
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

from app.graph import GraphDocument, Node, load_graph_document, save_graph
from app.routing import RouteNotFoundError, calculate_route


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
MAPS_DIR = PROJECT_ROOT / "maps"
STATIC_DIR = PROJECT_ROOT / "static"

ADMIN_PASSWORD_ENV = "UNIMAP_ADMIN_PASSWORD"
# Local-network MVP fallback; set UNIMAP_ADMIN_PASSWORD in production.
DEFAULT_ADMIN_PASSWORD = "admin"
MAX_NODE_PHOTO_BYTES = 8 * 1024 * 1024
MAX_NODE_PHOTO_PIXELS = 40_000_000
PHOTO_FORMATS = {
    "image/jpeg": ("jpg", "JPEG"),
    "image/png": ("png", "PNG"),
    "image/webp": ("webp", "WEBP"),
}

app = FastAPI(title="Indoor University Navigation System")
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")
app.mount("/maps", StaticFiles(directory=MAPS_DIR), name="maps")


@app.middleware("http")
async def disable_client_cache(request: Request, call_next):
    """Always serve fresh pages and assets so browsers never run stale JS."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


def get_admin_password() -> str:
    return os.environ.get(ADMIN_PASSWORD_ENV, DEFAULT_ADMIN_PASSWORD)


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Allow graph modification only for clients that know the admin password."""
    expected = get_admin_password()
    provided = x_admin_token or ""
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="invalid admin password")


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
        "label": node.label,
        "building": node.building,
        "floor": node.floor,
        "x": node.x,
        "y": node.y,
        "photo": node.photo,
        "photos": node.photos,
        "description": node.description,
        "tags": node.tags,
    }


@app.get("/", response_class=FileResponse)
def frontend() -> Path:
    return STATIC_DIR / "index.html"


@app.get("/favicon.ico", response_class=FileResponse)
def favicon() -> Path:
    return STATIC_DIR / "favicon.ico"


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


@app.post("/api/graph", dependencies=[Depends(require_admin)])
def save_graph_document(document: GraphDocument) -> dict[str, str]:
    path = save_graph(DATA_DIR, document)
    persisted = load_graph_document(DATA_DIR)
    if persisted != document:
        raise HTTPException(status_code=500, detail="saved graph did not match readback")
    return {"status": "saved", "file": path.name}


@app.post("/api/admin/verify")
def verify_admin_password(x_admin_token: str | None = Header(default=None)) -> dict[str, str]:
    """Check the admin password so the editor can unlock saving up front."""
    require_admin(x_admin_token)
    return {"status": "ok"}


@app.get("/api/search")
@app.get("/search")
def search_rooms(q: str = Query(min_length=1)) -> list[dict[str, object]]:
    query = q.strip().casefold()
    if not query:
        return []

    graph = get_graph()
    matches = [
        node_response(node)
        for node in graph.nodes
        if query in node.id.casefold()
        or query in (node.name or "").casefold()
        or query in (node.label or "").casefold()
        or any(query in tag.casefold() for tag in node.tags)
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
        "edges": [
            {
                "from": step.from_node,
                "to": step.to_node,
                "distance": step.edge.distance,
                "stairs": step.edge.stairs,
                "elevator": step.edge.elevator,
                "outdoor": step.edge.outdoor,
            }
            for step in result.edges
        ],
        "distance": result.distance,
        "cost": result.cost,
        "preferences": {
            "avoid_stairs": request.avoid_stairs,
            "avoid_outdoor": request.avoid_outdoor,
            "prefer_elevator": request.prefer_elevator,
        },
        "nodes": [node_response(node) for node in route_nodes],
    }


@app.post("/api/photos", dependencies=[Depends(require_admin)])
async def upload_photo(request: Request) -> dict[str, str]:
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    photo_format = PHOTO_FORMATS.get(media_type)
    if photo_format is None:
        raise HTTPException(status_code=415, detail="photo must be JPEG, PNG, or WebP")

    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_NODE_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="photo exceeds the 8 MB limit")

    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_NODE_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail="photo exceeds the 8 MB limit")

    extension, expected_format = photo_format
    try:
        with Image.open(BytesIO(content)) as image:
            if image.format != expected_format:
                raise ValueError("image format does not match Content-Type")
            if image.width * image.height > MAX_NODE_PHOTO_PIXELS:
                raise HTTPException(status_code=413, detail="photo dimensions exceed the 40 MP limit")
            image.verify()
    except HTTPException:
        raise
    except Image.DecompressionBombError as exc:
        raise HTTPException(status_code=413, detail="photo dimensions exceed the 40 MP limit") from exc
    except (OSError, SyntaxError, ValueError):
        raise HTTPException(status_code=415, detail="file contents do not match an image")

    filename = f"{secrets.token_hex(16)}.{extension}"
    photos_dir = DATA_DIR / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    photo_path = photos_dir / filename
    photo_url = f"/uploads/{filename}"
    try:
        photo_path.write_bytes(content)
        if photo_path.read_bytes() != content:
            photo_path.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail="uploaded photo did not match readback")
    except HTTPException:
        raise
    except OSError as exc:
        photo_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="could not save photo") from exc
    return {"photo": photo_url}


@app.get("/uploads/{filename}")
def uploaded_photo(filename: str) -> FileResponse:
    if not re.fullmatch(r"[0-9a-f]{32}\.(?:jpg|png|webp)", filename):
        raise HTTPException(status_code=404, detail="photo not found")
    path = DATA_DIR / "photos" / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="photo not found")
    return FileResponse(path)
