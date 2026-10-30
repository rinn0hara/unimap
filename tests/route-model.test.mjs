import {
  groupRouteSegments,
  routeEdgeForStep,
  transitionForEdge,
  transitionLabel,
  routePreferenceNotes,
} from "../static/assets/route-model.mjs";
import { nodeCaption } from "../static/assets/node-display.mjs";

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
const storedElevator = { from: "upper", to: "lower", bidirectional: true, elevator: true };
if (routeEdgeForStep([storedElevator], "lower", "upper") !== storedElevator) throw new Error("reverse traversal did not find a bidirectional edge");
if (routeEdgeForStep([{ ...storedElevator, bidirectional: false }], "lower", "upper") !== null) throw new Error("reverse traversal accepted a one-way edge");
if (transitionLabel("elevator") !== "На лифте") throw new Error("elevator instruction label is wrong");
if (transitionLabel("stairs") !== "По лестнице") throw new Error("stairs instruction label is wrong");
if (transitionLabel("passage") !== "Через переход") throw new Error("passage instruction label is wrong");
const unavoidable = routePreferenceNotes([
  { stairs: true, outdoor: true, elevator: false },
], { avoid_stairs: true, avoid_outdoor: true, prefer_elevator: true });
if (unavoidable.length !== 3) throw new Error(`expected 3 route preference notes, got ${unavoidable.length}`);
if (!unavoidable[0].includes("лестниц") || !unavoidable[1].includes("улицы")) throw new Error("unsatisfied avoid preferences were not explained");
if (!unavoidable[2].includes("нет лифта")) throw new Error("elevator preference note is wrong");
const satisfied = routePreferenceNotes([
  { stairs: false, outdoor: false, elevator: true },
], { avoid_stairs: true, avoid_outdoor: true, prefer_elevator: true });
if (satisfied.length !== 0) throw new Error("satisfied preferences should not show warnings");
if (nodeCaption({ label: "Lift lobby" }) !== "Lift lobby") throw new Error("map caption display failed");
if (nodeCaption({ label: " " }) !== null) throw new Error("empty caption should be hidden");
console.log("route-model tests passed");
