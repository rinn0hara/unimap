export function createGraphNode(existingNodes, {
  building,
  floor,
  x,
  y,
  type = "normal",
  name = "",
}) {
  const base = `node_b${building}_f${floor}_`;
  const used = new Set(existingNodes.map((node) => node.id));
  let suffix = existingNodes.length + 1;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  const trimmedName = name.trim();
  return {
    id: `${base}${suffix}`,
    type,
    name: trimmedName,
    building: Number(building),
    floor: Number(floor),
    x: Number(x),
    y: Number(y),
  };
}
