import { useEffect, useRef } from "react";

// Public sitekey is set at Cloudflare Pages build time.
// Secret key must only be configured in Supabase Auth (never VITE_*).
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";

type TurnstileAPI = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
    theme: "auto";
  }) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileAPI }
}

let turnstileScript: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScript) {
    turnstileScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        turnstileScript = null;
        reject(new Error("Turnstile nepavyko įkelti"));
      };
      document.head.appendChild(script);
    });
  }
  return turnstileScript;
}

export function TurnstileCaptcha({ onToken }: { onToken: (value: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let disposed = false;
    let widgetId: string | null = null;
    void loadTurnstile().then(() => {
      if (disposed || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current(""),
        theme: "auto",
      });
    }).catch(() => onTokenRef.current(""));

    return () => {
      disposed = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div className="my-3 min-h-16" ref={container} aria-label="Apsauga nuo automatinių registracijų" />;
}
