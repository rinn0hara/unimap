from pathlib import Path

import pytest

from app.graph import GraphData, GraphDocument, load_graph, load_graph_document, save_graph
from app.routing import RouteNotFoundError, calculate_route


SAMPLE_GRAPH = GraphData.model_validate(
    {
        "nodes": [
            {"id": "start", "type": "street", "building": 1, "floor": 1, "x": 0, "y": 0},
            {"id": "stairs", "type": "stairs", "building": 1, "floor": 1, "x": 10, "y": 0},
            {"id": "elevator", "type": "elevator", "building": 1, "floor": 1, "x": 0, "y": 10},
            {"id": "destination", "type": "normal", "name": "101", "building": 1, "floor": 1, "x": 20, "y": 0},
        ],
        "edges": [
            {"from": "start", "to": "stairs", "distance": 1, "stairs": True, "bidirectional": True},
            {"from": "stairs", "to": "destination", "distance": 1, "stairs": True, "bidirectional": True},
            {"from": "start", "to": "elevator", "distance": 4, "elevator": True, "bidirectional": True},
            {"from": "elevator", "to": "destination", "distance": 4, "elevator": True, "bidirectional": True},
        ],
    }
)


def test_dijkstra_returns_shortest_physical_route_by_default() -> None:
    result = calculate_route(SAMPLE_GRAPH, "start", "destination")

    assert result.route == ["start", "stairs", "destination"]
    assert result.distance == 2
    assert result.cost == 2


def test_route_result_keeps_the_edges_between_consecutive_nodes() -> None:
    result = calculate_route(SAMPLE_GRAPH, "start", "destination")

    assert [(step.from_node, step.to_node) for step in result.edges] == [
        ("start", "stairs"),
        ("stairs", "destination"),
    ]
    assert all(step.edge.stairs for step in result.edges)


def test_avoid_stairs_selects_longer_route() -> None:
    result = calculate_route(SAMPLE_GRAPH, "start", "destination", avoid_stairs=True)

    assert result.route == ["start", "elevator", "destination"]
    assert result.distance == 8
    assert result.cost == 8


def test_avoid_stairs_is_a_preference_penalty_not_a_hard_block() -> None:
    graph = GraphData.model_validate(
        {
            "nodes": [
                {"id": "a", "type": "normal", "building": 1, "floor": 1},
                {"id": "stairs", "type": "stairs", "building": 1, "floor": 2},
            ],
            "edges": [{"from": "a", "to": "stairs", "distance": 7, "stairs": True}],
        }
    )

    result = calculate_route(graph, "a", "stairs", avoid_stairs=True)

    assert result.route == ["a", "stairs"]
    assert result.distance == 7
    assert result.cost > result.distance


def test_avoid_outdoor_selects_indoor_route() -> None:
    graph = GraphData.model_validate(
        {
            "nodes": [
                {"id": "start", "type": "street", "building": 1, "floor": 1},
                {"id": "outdoor", "type": "normal", "building": 1, "floor": 1},
                {"id": "indoor", "type": "normal", "building": 1, "floor": 1},
                {"id": "destination", "type": "normal", "building": 1, "floor": 1},
            ],
            "edges": [
                {"from": "start", "to": "outdoor", "distance": 1, "outdoor": True},
                {"from": "outdoor", "to": "destination", "distance": 1, "outdoor": True},
                {"from": "start", "to": "indoor", "distance": 8},
                {"from": "indoor", "to": "destination", "distance": 8},
            ],
        }
    )

    result = calculate_route(graph, "start", "destination", avoid_outdoor=True)

    assert result.route == ["start", "indoor", "destination"]
    assert result.distance == 16


def test_prefer_elevator_can_choose_a_longer_elevator_route() -> None:
    graph = GraphData.model_validate(
        {
            "nodes": [
                {"id": "start", "type": "street", "building": 1, "floor": 1, "x": 0, "y": 0},
                {"id": "stairs", "type": "stairs", "building": 1, "floor": 1, "x": 10, "y": 0},
                {"id": "elevator", "type": "elevator", "building": 1, "floor": 1, "x": 0, "y": 10},
                {"id": "destination", "type": "normal", "name": "101", "building": 1, "floor": 1, "x": 20, "y": 0},
            ],
            "edges": [
                {"from": "start", "to": "stairs", "distance": 5},
                {"from": "stairs", "to": "destination", "distance": 5},
                {"from": "start", "to": "elevator", "distance": 5, "elevator": True},
                {"from": "elevator", "to": "destination", "distance": 6, "elevator": True},
            ],
        }
    )

    result = calculate_route(graph, "start", "destination", prefer_elevator=True)

    assert result.route == ["start", "elevator", "destination"]
    assert result.distance == 11
    assert result.cost == 8.8


def test_missing_route_raises_domain_error() -> None:
    graph = GraphData.model_validate(
        {
            "nodes": [
                {"id": "a", "type": "normal", "building": 1, "floor": 1, "x": 0, "y": 0},
                {"id": "b", "type": "normal", "building": 1, "floor": 1, "x": 1, "y": 1},
            ],
            "edges": [],
        }
    )

    with pytest.raises(RouteNotFoundError):
        calculate_route(graph, "a", "b")


def test_loader_combines_floor_files() -> None:
    graph = load_graph(Path("data"))

    assert "room_101" in graph.nodes_by_id
    assert "room_201" in graph.nodes_by_id
    assert len(graph.nodes) >= 10


def test_duplicate_edges_are_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate edge"):
        GraphData.model_validate(
            {
                "nodes": [
                    {"id": "a", "type": "normal", "building": 1, "floor": 1, "x": 0, "y": 0},
                    {"id": "b", "type": "normal", "building": 1, "floor": 1, "x": 1, "y": 1},
                ],
                "edges": [
                    {"from": "a", "to": "b", "distance": 1},
                    {"from": "a", "to": "b", "distance": 1},
                ],
            }
        )


def test_bidirectional_reverse_edges_are_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate edge"):
        GraphData.model_validate(
            {
                "nodes": [
                    {"id": "a", "type": "normal", "building": 1, "floor": 1, "x": 0, "y": 0},
                    {"id": "b", "type": "normal", "building": 1, "floor": 1, "x": 1, "y": 1},
                ],
                "edges": [
                    {"from": "a", "to": "b", "distance": 1, "bidirectional": True},
                    {"from": "b", "to": "a", "distance": 1, "bidirectional": True},
                ],
            }
        )


@pytest.mark.parametrize(
    "legacy_type",
    ["room", "corridor", "door", "intersection", "entrance", "connection"],
)
def test_legacy_node_types_are_rejected(legacy_type: str) -> None:
    with pytest.raises(ValueError):
        GraphData.model_validate(
            {
                "nodes": [{"id": "a", "type": legacy_type, "building": 1, "floor": 1}],
                "edges": [],
            }
        )


def test_unknown_node_type_is_rejected() -> None:
    with pytest.raises(ValueError):
        GraphData.model_validate(
            {
                "nodes": [{"id": "a", "type": "banana", "building": 1, "floor": 1}],
                "edges": [],
            }
        )


def test_node_photo_is_preserved(tmp_path) -> None:
    document = GraphDocument.model_validate(
        {
            "nodes": [
                {
                    "id": "room_101",
                    "type": "normal",
                    "name": "101",
                    "building": 1,
                    "floor": 1,
                    "x": 10,
                    "y": 20,
                    "photo": "photos/room_101.jpg",
                }
            ],
            "edges": [],
            "floors": [],
        }
    )

    path = save_graph(tmp_path, document)
    loaded = load_graph_document(tmp_path)

    assert path.name == "graph.json"
    assert loaded.nodes[0].photo == "photos/room_101.jpg"


def test_node_map_label_is_preserved(tmp_path) -> None:
    document = GraphDocument.model_validate(
        {
            "nodes": [
                {
                    "id": "lift_lobby",
                    "type": "elevator",
                    "name": "Elevator",
                    "label": "Lift lobby →",
                    "building": 1,
                    "floor": 2,
                    "x": 15,
                    "y": 25,
                }
            ],
            "edges": [],
            "floors": [],
        }
    )

    save_graph(tmp_path, document)
    loaded = load_graph_document(tmp_path)

    assert loaded.nodes[0].label == "Lift lobby →"


def test_node_label_is_optional() -> None:
    node = GraphData.model_validate(
        {
            "nodes": [{"id": "plain", "type": "normal", "building": 1, "floor": 1}],
            "edges": [],
        }
    ).nodes[0]

    assert node.label is None


def test_room_without_name_is_allowed() -> None:
    graph = GraphData.model_validate(
        {
            "nodes": [{"id": "waypoint_1", "type": "normal", "building": 1, "floor": 1}],
            "edges": [],
        }
    )

    assert graph.nodes[0].name is None


def test_saved_document_is_loaded_from_canonical_file(tmp_path) -> None:
    document = GraphDocument.model_validate(
        {
            "nodes": [
                {"id": "room_test", "type": "normal", "name": "Test", "building": 1, "floor": 1, "x": 10, "y": 20}
            ],
            "edges": [],
            "floors": [{"building": 1, "floor": 1, "map": "test.svg"}],
        }
    )

    path = save_graph(tmp_path, document)
    loaded = load_graph_document(tmp_path)

    assert path.name == "graph.json"
    assert loaded == document


def test_edge_preserves_editor_auto_distance_flag() -> None:
    graph = GraphData.model_validate(
        {
            "nodes": [
                {"id": "a", "type": "normal", "building": 1, "floor": 1, "x": 0, "y": 0},
                {"id": "b", "type": "normal", "building": 1, "floor": 1, "x": 3, "y": 4},
            ],
            "edges": [{"from": "a", "to": "b", "distance": 5, "autoDistance": True}],
        }
    )

    assert graph.edges[0].auto_distance is True
    assert graph.model_dump(by_alias=True)["edges"][0]["autoDistance"] is True


def test_invalid_edge_reference_is_rejected() -> None:
    with pytest.raises(ValueError, match="missing node"):
        GraphData.model_validate(
            {
                "nodes": [
                    {"id": "a", "type": "normal", "building": 1, "floor": 1, "x": 0, "y": 0}
                ],
                "edges": [{"from": "a", "to": "missing", "distance": 1}],
            }
        )
