import { nodeCaption, nodeDetails } from "../static/assets/node-display.mjs";

if (nodeCaption({ label: " Main entrance " }) !== "Main entrance") throw new Error("caption should be trimmed before display");
if (nodeCaption({ label: "  " }) !== null) throw new Error("blank caption should not render");
if (nodeCaption({ name: "Room 101" }) !== null) throw new Error("room name is not a separate map caption");
const details = nodeDetails({ label: "Near the blue door", photo: "/uploads/door.jpg" });
if (details.caption !== "Near the blue door" || details.photo !== "/uploads/door.jpg") throw new Error("side-panel details were not returned");
const gallery = nodeDetails({ photo: "/old.jpg", photos: ["/old.jpg", " /new.jpg ", ""], description: "  Описание\nточки  ", tags: ["книги"] });
if (JSON.stringify(gallery.photos) !== JSON.stringify(["/old.jpg", "/new.jpg"])) throw new Error("legacy and multiple photos should be merged without duplicates");
if (gallery.description !== "Описание\nточки" || gallery.tags[0] !== "книги") throw new Error("description or tags missing");
if (nodeDetails(null).photos.length !== 0) throw new Error("empty node should have an empty gallery");
console.log("node-display tests passed");
