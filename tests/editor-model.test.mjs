import {
  createGraphNode,
  nodeCaption,
  createInterFloorEdge,
  canAutoCalculateDistance,
  hasExistingEdge,
  interFloorEdgeLabel,
  interFloorBadgePosition,
  interFloorEndpointsForFloor,
  describeInterFloorEndpoint,
} from "../static/assets/editor-model.mjs";

const existing = [{ id: "node_b2_f3_2" }];
const node = createGraphNode(existing, {
  building: 2,
  floor: 3,
  x: 45,
  y: 67,
  type: "stairs",
  name: "  North stairwell  ",
  label: "  Lift lobby  ",
});
if (node.id !== "node_b2_f3_3") throw new Error(`wrong generated ID: ${node.id}`);
if (node.building !== 2 || node.floor !== 3) throw new Error("node is assigned to wrong floor");
if (node.x !== 45 || node.y !== 67) throw new Error("node coordinates were not retained");
if (node.type !== "stairs" || node.name !== "North stairwell") throw new Error("new node defaults were not normalized");
if (node.label !== "Lift lobby") throw new Error("map caption was not normalized");
if (nodeCaption(node) !== "Lift lobby") throw new Error("map caption was not rendered as expected");
const unnamedCaptionNode = createGraphNode([], { building: 1, floor: 1, x: 1, y: 2 });
if (unnamedCaptionNode.label !== undefined) throw new Error("empty map caption should be omitted");

const upper = { id: "lift_b2_f2", building: 2, floor: 2, type: "elevator" };
const lower = { id: "lift_b2_f1", building: 2, floor: 1, type: "elevator" };
const elevatorEdge = createInterFloorEdge(upper, lower, {
  kind: "elevator",
  distance: 6,
  bidirectional: true,
});
if (elevatorEdge.from !== upper.id || elevatorEdge.to !== lower.id) throw new Error("inter-floor edge endpoints are wrong");
if (!elevatorEdge.elevator || elevatorEdge.stairs || elevatorEdge.autoDistance) throw new Error("elevator flags or manual distance are wrong");
if (describeInterFloorEndpoint(elevatorEdge, upper, lower) !== "↕ Лифт ↔ эт. 1") throw new Error("elevator endpoint label is wrong");
if (interFloorEdgeLabel(elevatorEdge, upper, lower) !== "↕ Лифт ↔ эт. 1") throw new Error("elevator drawing label is wrong");

const upperStairs = { ...upper, id: "stairs_b2_f2", type: "stairs" };
const lowerStairs = { ...lower, id: "stairs_b2_f1", type: "stairs" };
const stairEdge = createInterFloorEdge(upperStairs, lowerStairs, { kind: "stairs", distance: 8 });
if (!stairEdge.stairs || stairEdge.elevator) throw new Error("stair edge flags are wrong");
if (describeInterFloorEndpoint(stairEdge, lowerStairs, upperStairs) !== "⇅ Лестница ↔ эт. 2") throw new Error("reverse stair endpoint label is wrong");
const otherBuildingNode = { id: "lift_b3_f1", building: 3, floor: 1, type: "elevator" };
if (interFloorEdgeLabel(createInterFloorEdge(lower, otherBuildingNode, { kind: "elevator" }), lower, otherBuildingNode) !== "↕ Лифт ↔ корп. 3 · эт. 1") throw new Error("cross-building endpoint label is wrong");

let badDistanceRejected = false;
try {
  createInterFloorEdge(upper, lower, { kind: "stairs", distance: -1 });
} catch {
  badDistanceRejected = true;
}
if (!badDistanceRejected) throw new Error("negative inter-floor distance should be rejected");

let sameFloorRejected = false;
try {
  createInterFloorEdge(upper, { ...lower, floor: 2 }, { kind: "elevator" });
} catch {
  sameFloorRejected = true;
}
if (!sameFloorRejected) throw new Error("same-floor connection should be rejected by inter-floor flow");

let mismatchedTypeRejected = false;
try {
  createInterFloorEdge(upper, { ...lower, type: "normal" }, { kind: "elevator" });
} catch {
  mismatchedTypeRejected = true;
}
if (!mismatchedTypeRejected) throw new Error("elevator connections should join elevator points");

const oneWay = createInterFloorEdge(upper, lower, { kind: "elevator", bidirectional: false });
if (describeInterFloorEndpoint(oneWay, upper, lower) !== "↕ Лифт → эт. 1") throw new Error("one-way edge should show outgoing direction at source");
if (describeInterFloorEndpoint(oneWay, lower, upper) !== "↕ Лифт ← эт. 2") throw new Error("one-way edge should show incoming direction at target");

const sameFloorNode = { id: "corridor_b2_f2", building: 2, floor: 2 };
const edgeFixtures = [
  elevatorEdge,
  createInterFloorEdge(upper, otherBuildingNode, { kind: "elevator" }),
  { from: upper.id, to: sameFloorNode.id, distance: 1, bidirectional: true },
];
const nodeIndex = new Map([upper, lower, sameFloorNode, otherBuildingNode].map((item) => [item.id, item]));
if (canAutoCalculateDistance(edgeFixtures[2], nodeIndex) !== true) throw new Error("same-floor edge should support automatic distance");
if (canAutoCalculateDistance(elevatorEdge, nodeIndex) !== false) throw new Error("inter-floor edge should not use SVG coordinate distance");
if (!hasExistingEdge(edgeFixtures, upper.id, lower.id)) throw new Error("existing connection was not detected");
if (!hasExistingEdge(edgeFixtures, lower.id, upper.id)) throw new Error("reverse direction of bidirectional connection was not detected");
if (hasExistingEdge(edgeFixtures, lower.id, sameFloorNode.id)) throw new Error("unconnected points were reported as connected");
const shownOnFloor2 = interFloorEndpointsForFloor(
  edgeFixtures,
  [upper, lower, sameFloorNode, otherBuildingNode],
  2,
  2,
);
if (shownOnFloor2.length !== 2) throw new Error(`expected two inter-floor markers on B2 F2, got ${shownOnFloor2.length}`);
if (shownOnFloor2.some(({ endpoint }) => endpoint.building !== 2 || endpoint.floor !== 2)) throw new Error("an inter-floor marker was placed on the wrong map");
if (shownOnFloor2.some(({ other }) => other.floor === 2 && other.building === 2)) throw new Error("a same-floor edge was presented as inter-floor");
const firstBadge = interFloorBadgePosition(upper, 0, 120, { x: 0, y: 0, width: 620, height: 450 });
const secondBadge = interFloorBadgePosition(upper, 1, 120, { x: 0, y: 0, width: 620, height: 450 });
if (firstBadge.y === secondBadge.y) throw new Error("multiple floor transition labels should not overlap");
const leftEdgeBadge = interFloorBadgePosition({ ...upper, x: 2, y: 220 }, 1, 110, { x: 0, y: 0, width: 620, height: 450 });
if (leftEdgeBadge.x < 0) throw new Error("transition label should stay inside the floor plan");
const rightEdgeBadge = interFloorBadgePosition({ ...upper, x: 615, y: 220 }, 1, 110, { x: 0, y: 0, width: 620, height: 450 });
if (rightEdgeBadge.x + 110 > 620) throw new Error("transition label should stay inside right floor plan edge");
console.log("editor-model tests passed");
