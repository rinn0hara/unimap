from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


NodeType = Literal[
    "room",
    "door",
    "corridor",
    "intersection",
    "stairs",
    "elevator",
    "entrance",
    "connection",
]


class Node(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    type: NodeType
    building: int = Field(ge=1)
    floor: int = Field(ge=0)
    name: str | None = None
    x: float | None = None
    y: float | None = None


class Edge(BaseModel):
    model_config = ConfigDict(extra="ignore")

    from_: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)
    distance: float = Field(ge=0)
    stairs: bool = False
    elevator: bool = False
    outdoor: bool = False
    bidirectional: bool = True
    auto_distance: bool = Field(default=True, alias="autoDistance")

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class GraphData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    nodes: list[Node]
    edges: list[Edge]

    @model_validator(mode="after")
    def validate_references(self) -> GraphData:
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("duplicate node ID")

        known_ids = set(node_ids)
        seen_edges: set[tuple[str, str]] = set()
        seen_bidirectional_edges: set[frozenset[str]] = set()
        for edge in self.edges:
            edge_key = (edge.from_, edge.to)
            if edge_key in seen_edges:
                raise ValueError(f"duplicate edge: {edge.from_} -> {edge.to}")
            seen_edges.add(edge_key)
            if edge.bidirectional:
                undirected_key = frozenset((edge.from_, edge.to))
                if undirected_key in seen_bidirectional_edges:
                    raise ValueError(f"duplicate edge: {edge.from_} -> {edge.to}")
                seen_bidirectional_edges.add(undirected_key)
            if edge.from_ not in known_ids or edge.to not in known_ids:
                raise ValueError(
                    f"edge references missing node: {edge.from_} -> {edge.to}"
                )

        for node in self.nodes:
            if node.type == "room" and not (node.name or "").strip():
                raise ValueError(f"room {node.id} must have a name")

        return self

    @property
    def nodes_by_id(self) -> dict[str, Node]:
        return {node.id: node for node in self.nodes}


class FloorMap(BaseModel):
    building: int = Field(ge=1)
    floor: int = Field(ge=0)
    map: str = Field(min_length=1)


class GraphDocument(GraphData):
    floors: list[FloorMap] = Field(default_factory=list)


def load_graph_document(data_dir: Path) -> GraphDocument:
    """Load the canonical graph or combine the initial per-floor files."""
    canonical = data_dir / "graph.json"
    if canonical.exists():
        return GraphDocument.model_validate(
            json.loads(canonical.read_text(encoding="utf-8"))
        )

    raw_nodes: list[dict] = []
    raw_edges: list[dict] = []
    floors: list[dict] = []
    files = sorted(data_dir.glob("*.json"))
    if not files:
        raise FileNotFoundError(f"no graph JSON files found in {data_dir}")

    for path in files:
        payload = json.loads(path.read_text(encoding="utf-8"))
        raw_nodes.extend(payload.get("nodes", []))
        raw_edges.extend(payload.get("edges", []))
        if "building" in payload and "floor" in payload:
            floors.append(
                {
                    "building": payload["building"],
                    "floor": payload["floor"],
                    "map": payload.get(
                        "map",
                        f"building{payload['building']}_floor{payload['floor']}.svg",
                    ),
                }
            )

    return GraphDocument.model_validate(
        {"nodes": raw_nodes, "edges": raw_edges, "floors": floors}
    )


def save_graph(data_dir: Path, document: GraphDocument) -> Path:
    """Atomically save a validated graph document to the project data directory."""
    validated = GraphDocument.model_validate(document)
    data_dir.mkdir(parents=True, exist_ok=True)
    target = data_dir / "graph.json"
    payload = json.dumps(
        validated.model_dump(by_alias=True, exclude_none=True),
        indent=2,
        ensure_ascii=False,
    )
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=data_dir,
            prefix=".graph-",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(payload)
            temporary.write("\n")
            temporary_path = temporary.name
        os.replace(temporary_path, target)
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
    return target


def load_graph(data_dir: Path) -> GraphData:
    return load_graph_document(data_dir)
