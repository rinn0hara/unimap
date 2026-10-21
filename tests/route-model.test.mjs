import {
  groupRouteSegments,
  transitionForEdge,
  transitionLabel,
} from "../static/assets/route-model.mjs";

const route = [
  { id: "a", building: 1, floor: 1 },
  { id: "b", building: 1, floor: 1 },
  { id: "c", building: 2, floor: 1 },
  { id: "d", building: 2, floor: 2 },
];

const segments = groupRouteSegments(route);
if (segments.length !== 3) throw new Error(`expected 3 segments, got ${segments.length}`);
if (segments[0].nodes.map((node) => node.id).join(",") !== "a,b") throw new Error("same-floor nodes did not group");
if (segments[1].building !== 2 || segments[1].floor !== 1) throw new Error("same floor number in a different building was merged");
if (transitionForEdge({ elevator: true, stairs: false }) !== "elevator") throw new Error("elevator transition was not used");
if (transitionForEdge({ elevator: false, stairs: true }) !== "stairs") throw new Error("stairs transition was not used");
if (transitionForEdge({ elevator: false, stairs: false }) !== "passage") throw new Error("passage transition was not used");
if (transitionLabel("elevator") !== "the elevator") throw new Error("elevator instruction label is wrong");
if (transitionLabel("stairs") !== "the stairs") throw new Error("stairs instruction label is wrong");
if (transitionLabel("passage") !== "the passage") throw new Error("passage instruction label is wrong");
console.log("route-model tests passed");
