import { createRoot } from "react-dom/client";
import "./index.css";

/**
 * Make preview startup failures visible instead of leaving an empty theme
 * background. This does not expose credentials or error stack traces.
 */
const rootElement = document.getElementById("root");

function showStartupFailure(reason: string) {
  if (!rootElement) return;
  const wrapper = document.createElement("main");
  wrapper.style.cssText =
    "min-height:100vh;display:grid;place-items:center;padding:24px;background:#211912;color:#f7f2ed;font-family:system-ui,sans-serif;";
  const card = document.createElement("section");
  card.style.cssText =
    "width:100%;max-width:560px;border:1px solid #8d786a;border-radius:12px;padding:28px;line-height:1.6;";
  const title = document.createElement("h1");
  title.textContent = "Equus peržiūra nepasileido";
  title.style.cssText = "font-size:24px;font-weight:600;margin:0 0 12px;";
  const description = document.createElement("p");
  description.textContent =
    "Nepavyko įkelti programos. Šiame bandomajame puslapyje rodomas diagnostinis pranešimas vietoje tuščio ekrano.";
  const detail = document.createElement("p");
  detail.textContent = reason;
  detail.style.cssText =
    "padding:12px;background:#30251f;border-radius:8px;overflow-wrap:anywhere;font-size:14px;";
  const action = document.createElement("button");
  action.type = "button";
  action.textContent = "Bandyti dar kartą";
  action.style.cssText =
    "background:#e8ded4;color:#211912;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;";
  action.addEventListener("click", () => window.location.reload());
  card.append(title, description, detail, action);
  wrapper.append(card);
  rootElement.replaceChildren(wrapper);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/supabaseUrl is required|Invalid supabaseUrl/i.test(message)) {
    return "Trūksta arba neteisingas VITE_SUPABASE_URL Preview aplinkoje.";
  }
  if (/supabaseKey is required|Invalid API key/i.test(message)) {
    return "Trūksta arba neteisingas VITE_SUPABASE_PUBLISHABLE_KEY Preview aplinkoje.";
  }
  if (/failed to fetch dynamically imported module|loading chunk|importing a module script failed/i.test(message)) {
    return "Nepavyko įkelti JavaScript failo. Patikrinkite Preview diegimo failus arba išvalykite puslapio talpyklą.";
  }
  // Avoid exposing full URLs, tokens or runtime stack traces in a public preview.
  return "JavaScript paleidimo klaida. Atidarykite naršyklės Console, jei reikia daugiau informacijos.";
}

async function start() {
  try {
    const [{ default: App }, { initInstallCapture }, { registerEquusServiceWorker }] =
      await Promise.all([
        import("./App.tsx"),
        import("./lib/install"),
        import("./lib/pwa"),
      ]);
    initInstallCapture();
    if (!rootElement) throw new Error("Root element missing");
    createRoot(rootElement).render(<App />);
    try {
      registerEquusServiceWorker();
    } catch (error) {
      console.error("Equus service worker registration failed:", error);
    }
  } catch (error) {
    console.error("Equus preview startup failed:", error);
    showStartupFailure(friendlyError(error));
  }
}

void start();
