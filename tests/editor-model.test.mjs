import { createGraphNode } from "../static/assets/editor-model.mjs";

const existing = [{ id: "node_b2_f3_2" }];
const node = createGraphNode(existing, {
  building: 2,
  floor: 3,
  x: 45,
  y: 67,
  type: "stairs",
  name: "  North stairwell  ",
});
if (node.id !== "node_b2_f3_3") throw new Error(`wrong generated ID: ${node.id}`);
if (node.building !== 2 || node.floor !== 3) throw new Error("node is assigned to wrong floor");
if (node.x !== 45 || node.y !== 67) throw new Error("node coordinates were not retained");
if (node.type !== "stairs" || node.name !== "North stairwell") throw new Error("new node defaults were not normalized");
console.log("editor-model tests passed");
