from __future__ import annotations

import heapq
from dataclasses import dataclass

from app.graph import Edge, GraphData


PREFERENCE_PENALTY = 1_000


class RouteNotFoundError(ValueError):
    """Raised when no path connects the requested graph nodes."""


@dataclass(frozen=True)
class RouteResult:
    route: list[str]
    distance: float
    cost: float


def _edge_cost(
    edge: Edge,
    *,
    avoid_stairs: bool,
    avoid_outdoor: bool,
    prefer_elevator: bool,
) -> float:
    cost = edge.distance
    if edge.stairs and avoid_stairs:
        cost += PREFERENCE_PENALTY
    if edge.outdoor and avoid_outdoor:
        cost += PREFERENCE_PENALTY
    if edge.elevator and prefer_elevator:
        cost *= 0.8
    return cost


def calculate_route(
    graph: GraphData,
    start: str,
    destination: str,
    *,
    avoid_stairs: bool = False,
    avoid_outdoor: bool = False,
    prefer_elevator: bool = False,
) -> RouteResult:
    if start not in graph.nodes_by_id:
        raise KeyError(f"unknown start node: {start}")
    if destination not in graph.nodes_by_id:
        raise KeyError(f"unknown destination node: {destination}")

    adjacency: dict[str, list[tuple[str, Edge]]] = {
        node_id: [] for node_id in graph.nodes_by_id
    }
    for edge in graph.edges:
        adjacency[edge.from_].append((edge.to, edge))
        if edge.bidirectional:
            adjacency[edge.to].append((edge.from_, edge))

    distances = {node_id: float("inf") for node_id in graph.nodes_by_id}
    physical_distances = {node_id: float("inf") for node_id in graph.nodes_by_id}
    previous: dict[str, str | None] = {node_id: None for node_id in graph.nodes_by_id}
    distances[start] = 0
    physical_distances[start] = 0
    queue: list[tuple[float, str]] = [(0, start)]

    while queue:
        current_cost, current = heapq.heappop(queue)
        if current_cost != distances[current]:
            continue
        if current == destination:
            break

        for neighbor, edge in adjacency[current]:
            weight = _edge_cost(
                edge,
                avoid_stairs=avoid_stairs,
                avoid_outdoor=avoid_outdoor,
                prefer_elevator=prefer_elevator,
            )
            candidate_cost = current_cost + weight
            if candidate_cost < distances[neighbor]:
                distances[neighbor] = candidate_cost
                physical_distances[neighbor] = (
                    physical_distances[current] + edge.distance
                )
                previous[neighbor] = current
                heapq.heappush(queue, (candidate_cost, neighbor))

    if distances[destination] == float("inf"):
        raise RouteNotFoundError(f"no route from {start} to {destination}")

    route: list[str] = []
    current: str | None = destination
    while current is not None:
        route.append(current)
        current = previous[current]
    route.reverse()

    return RouteResult(
        route=route,
        distance=physical_distances[destination],
        cost=distances[destination],
    )
