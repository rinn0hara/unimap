export function nodeCaption(node) {
  const label = typeof node?.label === "string" ? node.label.trim() : "";
  return label || null;
}

export function nodeDetails(node) {
  const photos = [...new Set([node?.photo, ...(Array.isArray(node?.photos) ? node.photos : [])]
    .filter((photo) => typeof photo === "string" && photo.trim())
    .map((photo) => photo.trim()))];
  return {
    caption: nodeCaption(node),
    photo: photos[0] || null,
    photos,
    description: typeof node?.description === "string" ? node.description.trim() : "",
    tags: Array.isArray(node?.tags) ? node.tags : [],
  };
}
