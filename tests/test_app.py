from fastapi.testclient import TestClient

from app import main as main_module
from app.main import app
from main import app as root_app


client = TestClient(app)


def test_root_module_exports_fastapi_app() -> None:
    assert root_app is app


def test_health_endpoint_reports_ready() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_room_search_returns_matching_rooms() -> None:
    response = client.get("/api/search", params={"q": "101"})

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "room_101",
            "name": "101",
            "building": 1,
            "floor": 1,
            "type": "room",
        }
    ]


def test_room_search_alias_matches_api_search() -> None:
    response = client.get("/search", params={"q": "101"})

    assert response.status_code == 200
    assert response.json()[0]["id"] == "room_101"


    response = client.get("/api/search", params={"q": "main"})

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": "main_entrance",
            "name": "Main entrance",
            "building": 1,
            "floor": 1,
            "type": "entrance",
        }
    ]


def test_nodes_endpoint_lists_start_points() -> None:
    response = client.get("/api/nodes")

    assert response.status_code == 200
    node_ids = {node["id"] for node in response.json()}
    assert {"main_entrance", "room_101", "room_201"} <= node_ids


def test_frontend_and_sample_map_are_served() -> None:
    page = client.get("/")
    floor_map = client.get("/maps/building1_floor1.svg")

    assert page.status_code == 200
    assert "Indoor University Navigation" in page.text
    assert floor_map.status_code == 200
    assert "viewBox=\"0 0 620 450\"" in floor_map.text


def test_route_endpoint_returns_route_and_coordinates() -> None:
    response = client.post(
        "/api/route",
        json={
            "from": "main_entrance",
            "to": "room_201",
            "avoid_stairs": True,
            "prefer_elevator": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["route"][0] == "main_entrance"
    assert payload["route"][-1] == "room_201"
    assert payload["distance"] > 0
    assert payload["cost"] > 0
    assert {node["id"] for node in payload["nodes"]} == set(payload["route"])


def test_route_endpoint_rejects_unknown_node() -> None:
    response = client.post(
        "/api/route",
        json={"from": "missing", "to": "room_101"},
    )

    assert response.status_code == 404


def test_graph_endpoint_returns_editor_data() -> None:
    response = client.get("/api/graph")

    assert response.status_code == 200
    payload = response.json()
    assert {"nodes", "edges", "floors"} <= payload.keys()
    assert "room_101" in {node["id"] for node in payload["nodes"]}
    assert {"from", "to", "distance", "bidirectional"} <= payload["edges"][0].keys()


def test_editor_page_is_served() -> None:
    response = client.get("/editor")

    assert response.status_code == 200
    assert "Graph Editor" in response.text
    assert "Save graph" in response.text
    assert "validateGraph();" in response.text or "validateGraph();" in client.get("/assets/editor.js").text


def test_graph_save_endpoint_writes_validated_graph(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    payload = {
        "nodes": [
            {
                "id": "room_test",
                "type": "room",
                "name": "Test room",
                "building": 1,
                "floor": 1,
                "x": 10,
                "y": 20,
            }
        ],
        "edges": [],
        "floors": [{"building": 1, "floor": 1, "map": "test.svg"}],
    }

    response = client.post("/api/graph", json=payload)

    assert response.status_code == 200
    assert response.json() == {"status": "saved", "file": "graph.json"}
    saved = (tmp_path / "graph.json").read_text(encoding="utf-8")
    assert '"room_test"' in saved



