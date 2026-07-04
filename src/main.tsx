import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Secret message shown in browser devtools console (F12)
// eslint-disable-next-line no-console
console.log(
  `%c\n================================================================\nPROJEKTAS: Equus Jojimo Mokykla (2026)\nSVETAINĖS AUTORIUS (dizainas, kodas ir visa kita): Adrija Kalikaitė\nVisos autoriaus teisės saugomos.\n================================================================\n`,
  "color:#8ec5ff;font-family:monospace;font-size:12px;"
);

createRoot(document.getElementById("root")!).render(<App />);
