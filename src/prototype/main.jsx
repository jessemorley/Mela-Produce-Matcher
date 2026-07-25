// PROTOTYPE — entry for prototype.html. Delete with src/prototype/.
import { createRoot } from "react-dom/client";
import Prototype from "./Prototype.jsx";
import "../index.css";

// The variants are dark; index.css declares color-scheme: light for the real
// app, so override it here rather than touching the shared stylesheet.
document.documentElement.style.colorScheme = "dark";

createRoot(document.getElementById("root")).render(<Prototype />);
