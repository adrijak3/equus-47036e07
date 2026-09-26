import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerEquusServiceWorker } from "./lib/pwa";
import { initInstallCapture } from "./lib/install";

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
