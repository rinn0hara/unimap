import struct
import zlib

from fastapi.testclient import TestClient

from app import main as main_module
from app.graph import GraphDocument, save_graph
from app.main import app
from main import app as root_app


client = TestClient(app)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def sample_png() -> bytes:
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\x00\xff\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", pixels)
        + png_chunk(b"IEND", b"")
    )


def test_root_module_exports_fastapi_app() -> None:
    assert root_app is app


def test_health_endpoint_reports_ready() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_room_search_returns_matching_rooms() -> None:
    response = client.get("/api/search", params={"q": "101"})

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert {
        key: response.json()[0][key]
        for key in ("id", "name", "building", "floor", "type")
    } == {
        "id": "room_101",
        "name": "101",
        "building": 1,
        "floor": 1,
        "type": "normal",
    }
    assert response.json()[0]["photo"] is None or isinstance(response.json()[0]["photo"], str)


def test_room_search_alias_matches_api_search() -> None:
    response = client.get("/search", params={"q": "101"})

    assert response.status_code == 200
    assert response.json()[0]["id"] == "room_101"


    response = client.get("/api/search", params={"q": "main"})

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert {
        key: response.json()[0][key]
        for key in ("id", "name", "building", "floor", "type")
    } == {
        "id": "main_entrance",
        "name": "Main entrance",
        "building": 1,
        "floor": 1,
        "type": "street",
    }
    assert response.json()[0]["photo"] is None or isinstance(response.json()[0]["photo"], str)


def test_nodes_endpoint_lists_start_points() -> None:
    response = client.get("/api/nodes")

    assert response.status_code == 200
    node_ids = {node["id"] for node in response.json()}
    assert {"main_entrance", "room_101", "room_201"} <= node_ids


def test_frontend_and_sample_map_are_served() -> None:
    page = client.get("/")
    floor_map = client.get("/maps/building1_floor1.svg")

    assert page.status_code == 200
    assert '<html lang="ru">' in page.text
    assert "unimap" in page.text
    assert floor_map.status_code == 200
    assert "viewBox=\"0 0 620 450\"" in floor_map.text
    assert 'id="point-list"' not in page.text
    assert 'id="menu-toggle"' in page.text
    assert 'id="admin-login"' in page.text
    assert 'id="point-photo-details"' in page.text
    assert client.get("/assets/route-model.mjs").status_code == 200
    assert client.get("/assets/editor-model.mjs").status_code == 200
    assert client.get("/assets/node-display.mjs").status_code == 200
    assert "map-node-caption" in client.get("/assets/app.js").text
    assert ".editor-node-caption" in client.get("/assets/styles.css").text
    assert 'id="route-preference-note"' in page.text
    assert "routePreferenceNotes(payload.edges" in client.get("/assets/app.js").text


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
    assert len(payload["edges"]) == len(payload["route"]) - 1
    vertical_edge = next(
        edge for edge in payload["edges"] if edge["from"] == "elevator_1"
    )
    assert vertical_edge["to"] == "elevator_2"
    assert vertical_edge["elevator"] is True
    assert payload["preferences"] == {
        "avoid_stairs": True,
        "avoid_outdoor": False,
        "prefer_elevator": True,
    }


def test_route_endpoint_keeps_building_and_floor_transitions_distinct(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    document = GraphDocument.model_validate(
        {
            "nodes": [
                {"id": "a", "type": "normal", "building": 1, "floor": 1, "x": 0, "y": 0},
                {"id": "b", "type": "elevator", "building": 1, "floor": 1, "x": 1, "y": 0},
                {"id": "c", "type": "elevator", "building": 2, "floor": 1, "x": 1, "y": 0},
                {"id": "d", "type": "normal", "building": 2, "floor": 1, "x": 2, "y": 0},
            ],
            "edges": [
                {"from": "a", "to": "b", "distance": 1},
                {"from": "b", "to": "c", "distance": 1, "elevator": True},
                {"from": "c", "to": "d", "distance": 1},
            ],
            "floors": [
                {"building": 1, "floor": 1, "map": "b1.svg"},
                {"building": 2, "floor": 1, "map": "b2.svg"},
            ],
        }
    )
    save_graph(tmp_path, document)

    response = client.post("/api/route", json={"from": "a", "to": "d"})

    assert response.status_code == 200
    payload = response.json()
    assert [(node["building"], node["floor"]) for node in payload["nodes"]] == [
        (1, 1),
        (1, 1),
        (2, 1),
        (2, 1),
    ]
    assert payload["edges"][1] == {
        "from": "b",
        "to": "c",
        "distance": 1,
        "stairs": False,
        "elevator": True,
        "outdoor": False,
    }


def test_node_map_label_is_returned_by_nodes_search_and_route(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    save_graph(
        tmp_path,
        GraphDocument.model_validate(
            {
                "nodes": [
                    {"id": "start_label_test", "type": "normal", "building": 1, "floor": 1},
                    {"id": "room_label_test", "type": "normal", "name": "Room 101", "label": "Blue door", "building": 1, "floor": 1},
                ],
                "edges": [{"from": "start_label_test", "to": "room_label_test", "distance": 1}],
                "floors": [],
            }
        ),
    )

    nodes = {node["id"]: node for node in client.get("/api/nodes").json()}
    search = client.get("/api/search", params={"q": "Room 101"}).json()
    route = client.post(
        "/api/route",
        json={"from": "start_label_test", "to": "room_label_test"},
    ).json()

    assert nodes["room_label_test"]["label"] == "Blue door"
    assert search[0]["label"] == "Blue door"
    assert route["nodes"][-1]["label"] == "Blue door"
    assert client.get("/assets/node-display.mjs").status_code == 200
    assert "nodeCaption(node)" in client.get("/assets/app.js").text


def test_node_map_label_is_searchable(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    save_graph(
        tmp_path,
        GraphDocument.model_validate(
            {
                "nodes": [
                    {"id": "caption_search_test", "type": "normal", "name": "Room 101", "label": "Blue door by the lift", "building": 1, "floor": 1}
                ],
                "edges": [],
                "floors": [],
            }
        ),
    )

    response = client.get("/api/search", params={"q": "Blue door"})

    assert response.status_code == 200
    assert [node["id"] for node in response.json()] == ["caption_search_test"]


def test_route_endpoint_reports_preferences_used_to_calculate_route() -> None:
    response = client.post(
        "/api/route",
        json={
            "from": "main_entrance",
            "to": "room_201",
            "avoid_stairs": True,
            "avoid_outdoor": True,
            "prefer_elevator": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["preferences"] == {
        "avoid_stairs": True,
        "avoid_outdoor": True,
        "prefer_elevator": True,
    }


def test_route_endpoint_returns_only_path_and_marks_unavoidable_avoided_edge(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    save_graph(
        tmp_path,
        GraphDocument.model_validate(
            {
                "nodes": [
                    {"id": "start_pref", "type": "normal", "building": 1, "floor": 1},
                    {"id": "stairs_pref", "type": "stairs", "building": 1, "floor": 2},
                ],
                "edges": [
                    {"from": "start_pref", "to": "stairs_pref", "distance": 7, "stairs": True}
                ],
                "floors": [],
            }
        ),
    )

    response = client.post(
        "/api/route",
        json={"from": "start_pref", "to": "stairs_pref", "avoid_stairs": True},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["route"] == ["start_pref", "stairs_pref"]
    assert payload["edges"][0]["stairs"] is True
    assert payload["distance"] == 7
    assert payload["cost"] > payload["distance"]
    assert payload["preferences"]["avoid_stairs"] is True


def test_photo_upload_saves_file_and_serves_image(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")
    image = sample_png()

    response = client.post(
        "/api/photos",
        content=image,
        headers={"Content-Type": "image/png", "X-Admin-Token": "secret"},
    )

    assert response.status_code == 200
    photo_url = response.json()["photo"]
    assert photo_url.startswith("/uploads/")
    assert (tmp_path / "photos" / photo_url.removeprefix("/uploads/")).read_bytes() == image
    served = client.get(photo_url)
    assert served.status_code == 200
    assert served.content == image
    assert served.headers["content-type"] == "image/png"


def test_uploaded_photo_reference_survives_graph_save_and_route(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")
    uploaded = client.post(
        "/api/photos",
        content=sample_png(),
        headers={"Content-Type": "image/png", "X-Admin-Token": "secret"},
    )
    photo_url = uploaded.json()["photo"]
    document = GraphDocument.model_validate(
        {
            "nodes": [
                {"id": "start", "type": "normal", "building": 1, "floor": 1},
                {"id": "destination", "type": "normal", "building": 1, "floor": 1, "photo": photo_url},
            ],
            "edges": [{"from": "start", "to": "destination", "distance": 1}],
            "floors": [],
        }
    )

    saved = client.post(
        "/api/graph",
        json=document.model_dump(by_alias=True, exclude_none=True),
        headers={"X-Admin-Token": "secret"},
    )
    routed = client.post("/api/route", json={"from": "start", "to": "destination"})

    assert saved.status_code == 200
    assert routed.status_code == 200
    assert routed.json()["nodes"][-1]["photo"] == photo_url


def test_photo_upload_requires_image_type_and_admin_password(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")

    unauthorized = client.post(
        "/api/photos",
        content=b"not an image",
        headers={"Content-Type": "image/png"},
    )
    unsupported = client.post(
        "/api/photos",
        content=b"<svg></svg>",
        headers={"Content-Type": "image/svg+xml", "X-Admin-Token": "secret"},
    )

    assert unauthorized.status_code == 401
    assert unsupported.status_code == 415
    assert not (tmp_path / "photos").exists()


def test_photo_upload_rejects_invalid_image_payload(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")

    response = client.post(
        "/api/photos",
        content=b"\x89PNG\r\n\x1a\nnot a real PNG",
        headers={"Content-Type": "image/png", "X-Admin-Token": "secret"},
    )

    assert response.status_code == 415
    assert not (tmp_path / "photos").exists()


def test_photo_upload_rejects_oversized_body(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")

    response = client.post(
        "/api/photos",
        content=b"x" * (main_module.MAX_NODE_PHOTO_BYTES + 1),
        headers={"Content-Type": "image/png", "X-Admin-Token": "secret"},
    )

    assert response.status_code == 413
    assert not (tmp_path / "photos").exists()


def test_photo_upload_rejects_excessive_image_dimensions(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")
    huge_dimensions = struct.pack(">IIBBBBB", 7_000, 6_000, 8, 2, 0, 0, 0)
    image_header = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", huge_dimensions) + png_chunk(b"IEND", b"")

    response = client.post(
        "/api/photos",
        content=image_header,
        headers={"Content-Type": "image/png", "X-Admin-Token": "secret"},
    )

    assert response.status_code == 413
    assert not (tmp_path / "photos").exists()


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
    assert "Редактор графа" in response.text
    assert "Сохранить граф" in response.text
    assert 'id="new-node-type"' in response.text
    assert 'id="new-node-name"' in response.text
    assert 'data-tool="connector"' in response.text
    assert 'id="interfloor-kind"' in response.text
    assert 'id="interfloor-distance"' in response.text
    assert 'id="cancel-connector"' in response.text
    assert "переключите этаж" in response.text
    editor_script = client.get("/assets/editor.js").text
    assert "connectAcrossFloors(node)" in editor_script
    assert "interFloorEndpointsForFloor(" in editor_script
    assert "interFloorBadgePosition(endpoint, labelIndex, badgeWidth, viewBox)" in editor_script
    assert "interFloorEdgeLabel(edge, endpoint, other)" in editor_script
    assert "group.setAttribute(\"tabindex\", \"0\")" in editor_script
    assert client.get("/assets/editor-model.mjs").status_code == 200
    assert "validateGraph();" in response.text or "validateGraph();" in client.get("/assets/editor.js").text


def test_node_details_and_tags_survive_save_search_and_route(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")
    payload = {
        "nodes": [
            {"id": "start", "type": "normal", "building": 1, "floor": 1},
            {"id": "library", "type": "normal", "name": "Библиотека", "building": 1,
             "floor": 1, "photo": "/uploads/old.jpg", "photos": ["/uploads/a.jpg", "/uploads/b.jpg"],
             "description": "Книги и читальный зал\nВход справа", "tags": ["Книги", "читальный зал"]},
        ],
        "edges": [{"from": "start", "to": "library", "distance": 2}],
        "floors": [],
    }
    saved = client.post("/api/graph", json=payload, headers={"X-Admin-Token": "secret"})
    assert saved.status_code == 200
    node = client.get("/api/graph").json()["nodes"][1]
    assert node["description"] == payload["nodes"][1]["description"]
    assert node["photos"] == ["/uploads/a.jpg", "/uploads/b.jpg"]
    assert node["photo"] == "/uploads/old.jpg"
    assert node["tags"] == ["Книги", "читальный зал"]
    for query in ("КНИГ", "ЧИТАЛЬНЫЙ"):
        matches = client.get("/api/search", params={"q": query}).json()
        assert [match["id"] for match in matches] == ["library"]
        assert matches[0]["photos"] == node["photos"]
        assert matches[0]["description"] == node["description"]
    assert client.get("/api/nodes").json()[1]["tags"] == node["tags"]
    assert client.post("/api/route", json={"from": "start", "to": "library"}).json()["nodes"][-1]["photos"] == node["photos"]


def test_legacy_node_without_details_remains_readable(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    save_graph(tmp_path, GraphDocument.model_validate({
        "nodes": [{"id": "legacy", "type": "normal", "building": 1, "floor": 1, "photo": "/uploads/old.jpg"}],
        "edges": [], "floors": [],
    }))
    node = client.get("/api/nodes").json()[0]
    assert node["photo"] == "/uploads/old.jpg"
    assert node["photos"] == []
    assert node["tags"] == []
    assert node["description"] is None


def test_editor_model_creates_paired_floor_edges_and_endpoint_labels() -> None:
    response = client.get("/assets/editor-model.mjs")

    assert response.status_code == 200
    assert "export function createInterFloorEdge" in response.text
    assert "export function interFloorEndpointsForFloor" in response.text
    assert "export function interFloorEdgeLabel" in response.text


def test_graph_save_requires_admin_password(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")
    payload = {
        "nodes": [
            {
                "id": "point_test",
                "type": "normal",
                "name": "Test point",
                "building": 1,
                "floor": 1,
                "x": 10,
                "y": 20,
            }
        ],
        "edges": [],
        "floors": [{"building": 1, "floor": 1, "map": "test.svg"}],
    }

    unauthorized = client.post("/api/graph", json=payload)
    wrong_password = client.post(
        "/api/graph",
        json=payload,
        headers={"X-Admin-Token": "wrong"},
    )

    assert unauthorized.status_code == 401
    assert wrong_password.status_code == 401
    assert not (tmp_path / "graph.json").exists()


def test_graph_save_endpoint_writes_validated_graph(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main_module, "DATA_DIR", tmp_path)
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")
    payload = {
        "nodes": [
            {
                "id": "point_test",
                "type": "normal",
                "name": "Test point",
                "building": 1,
                "floor": 1,
                "x": 10,
                "y": 20,
                "photo": "/maps/photos/test.jpg",
            }
        ],
        "edges": [],
        "floors": [{"building": 1, "floor": 1, "map": "test.svg"}],
    }

    response = client.post(
        "/api/graph",
        json=payload,
        headers={"X-Admin-Token": "secret"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "saved", "file": "graph.json"}
    saved = (tmp_path / "graph.json").read_text(encoding="utf-8")
    assert '"point_test"' in saved
    assert "/maps/photos/test.jpg" in saved


def test_admin_verify_endpoint_checks_password(monkeypatch) -> None:
    monkeypatch.setenv("UNIMAP_ADMIN_PASSWORD", "secret")

    wrong = client.post("/api/admin/verify", headers={"X-Admin-Token": "nope"})
    correct = client.post("/api/admin/verify", headers={"X-Admin-Token": "secret"})

    assert wrong.status_code == 401
    assert correct.status_code == 200
    assert correct.json() == {"status": "ok"}


