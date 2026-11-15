import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// Equus currently uses essential authentication storage and user-selected
// appearance settings, but no analytics or advertising trackers.
const KEY = "equus_cookie_notice_v1";

export function CookieNotice() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(KEY) === null; } catch { return true; }
  });
  const acknowledge = (choice: "necessary" | "accepted") => {
    try { localStorage.setItem(KEY, choice); } catch { /* Private mode */ }
    setVisible(false);
  };
  if (!visible) return null;
  return (
    <aside role="dialog" aria-label="Slapukų informacija"
      className="fixed bottom-3 left-3 right-3 z-[120] mx-auto max-w-lg rounded-xl border border-border bg-card p-4 shadow-xl sm:bottom-6">
      <p className="font-semibold text-sm">Slapukai ir svetainės nustatymai</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Naudojame prisijungimui būtiną naršyklės saugyklą ir Jūsų pasirinktus
        svetainės nustatymus. Šiuo metu nenaudojame reklamos ar analitikos sekimo slapukų.
        Daugiau informacijos – <Link to="/slapuku-politika" className="underline text-gold">slapukų politikoje</Link>.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => acknowledge("necessary")}>
          Tik būtini
        </Button>
        <Button size="sm" onClick={() => acknowledge("accepted")}>
          Supratau
        </Button>
      </div>
    </aside>
  );
}
