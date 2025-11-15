import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initTimeSync } from "./lib/timeSync";

// Initialize IST time sync on app load
initTimeSync();

createRoot(document.getElementById("root")!).render(<App />);
