import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerEquusServiceWorker } from "./lib/pwa";
import { initInstallCapture } from "./lib/install";

// Secret message shown in browser devtools console (F12)
// eslint-disable-next-line no-console
console.log(
  `%c\n================================================================\nPROJEKTAS: Equus Jojimo Mokykla (2026)\nSVETAINĖS AUTORIUS (dizainas, kodas ir visa kita): Adrija Kalikaitė\nVisos autoriaus teisės saugomos.\n================================================================\n`,
  "color:#8ec5ff;font-family:monospace;font-size:12px;"
);

initInstallCapture();

createRoot(document.getElementById("root")!).render(<App />);

registerEquusServiceWorker();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Service Worker registration failed:', error);
    });
  });
}
