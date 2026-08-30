import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type EquusTheme =
  | "automatic"
  | "spring"
  | "summer"
  | "autumn"
  | "winter"
  | "ocean"
  | "lavender"
  | "midnight"
  | "forest"
  | "goldleaf"
  | "sage";
export type ResolvedTheme = Exclude<EquusTheme, "automatic">;
export type AppearanceMode = "automatic" | "light" | "dark";

interface ThemeContextValue {
  theme: EquusTheme;
  resolvedTheme: ResolvedTheme;
  appearanceMode: AppearanceMode;
  resolvedMode: "light" | "dark";
  saving: boolean;
  setTheme: (theme: EquusTheme) => void;
  setAppearanceMode: (mode: AppearanceMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const THEME_KEY = "equus_seasonal_theme";
const MODE_KEY = "equus_appearance_mode";
const validThemes: EquusTheme[] = [
  "automatic",
  "spring",
  "summer",
  "autumn",
  "winter",
  "ocean",
  "lavender",
  "midnight",
  "forest",
  "goldleaf",
  "sage",
];
const validModes: AppearanceMode[] = ["automatic", "light", "dark"];

function seasonalTheme(month = new Date().getMonth()): ResolvedTheme {
  if ([2, 3, 4].includes(month)) return "spring";
  if ([5, 6, 7].includes(month)) return "summer";
  if ([8, 9, 10].includes(month)) return "autumn";
  return "winter";
}

function initialTheme(): EquusTheme {
  const saved = localStorage.getItem(THEME_KEY) as EquusTheme | null;
  return saved && validThemes.includes(saved) ? saved : "automatic";
}

function initialMode(): AppearanceMode {
  const saved = localStorage.getItem(MODE_KEY) as AppearanceMode | null;
  return saved && validModes.includes(saved) ? saved : "automatic";
}

function naturalMode(theme: ResolvedTheme): "light" | "dark" {
  return ["spring", "summer", "ocean", "lavender", "sage"].includes(theme) ? "light" : "dark";
}

function applyTheme(theme: ResolvedTheme, mode: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.mode = mode;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<EquusTheme>(initialTheme);
  const [appearanceMode, setModeState] = useState<AppearanceMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const userIdRef = useRef<string | null>(null);
  /** Skip the first remote write right after we hydrate from the account. */
  const hydratedRef = useRef(false);
  const resolvedTheme = useMemo<ResolvedTheme>(() => theme === "automatic" ? seasonalTheme() : theme, [theme]);
  const resolvedMode = appearanceMode === "automatic" ? naturalMode(resolvedTheme) : appearanceMode;

  const pulseSaving = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 250);
  };

  /** Persist the preference on the signed-in profile so it follows the rider across devices. */
  const persistRemote = async (next: { theme?: EquusTheme; appearanceMode?: AppearanceMode }) => {
    const uid = userIdRef.current;
    if (!uid) return;
    const payload: { theme?: string; appearance_mode?: string } = {};
    if (next.theme) payload.theme = next.theme;
    if (next.appearanceMode) payload.appearance_mode = next.appearanceMode;
    if (!Object.keys(payload).length) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update(payload).eq("id", uid);
    setSaving(false);
    if (error) {
      // If this silently fails, the next hydrate() will pull the old
      // remote value back down and undo the change on refresh — so
      // surface it instead of swallowing it.
      console.error("Nepavyko išsaugoti temos pasirinkimo:", error);
      toast.error("Nepavyko išsaugoti temos pasirinkimo. Pabandykite dar kartą.");
    }
  };

  const setTheme = (next: EquusTheme) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    pulseSaving();
    void persistRemote({ theme: next });
  };

  const setAppearanceMode = (next: AppearanceMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
    pulseSaving();
    void persistRemote({ appearanceMode: next });
  };

  useEffect(() => {
    const hydrate = async (uid: string) => {
      userIdRef.current = uid;
      const { data } = await supabase
        .from("profiles")
        .select("theme, appearance_mode")
        .eq("id", uid)
        .maybeSingle();
      if (!data) return;
      const remoteTheme = data.theme as EquusTheme | null;
      const remoteMode = (data as { appearance_mode?: string | null }).appearance_mode as AppearanceMode | null;
      if (remoteTheme && validThemes.includes(remoteTheme)) {
        setThemeState(remoteTheme);
        localStorage.setItem(THEME_KEY, remoteTheme);
      }
      if (remoteMode && validModes.includes(remoteMode)) {
        setModeState(remoteMode);
        localStorage.setItem(MODE_KEY, remoteMode);
      }
      hydratedRef.current = true;
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;
      if (uid) {
        // Defer: never call other Supabase APIs inside the auth callback.
        setTimeout(() => void hydrate(uid), 0);
      } else {
        hydratedRef.current = false;
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      if (uid) void hydrate(uid);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme, resolvedMode);
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(MODE_KEY, appearanceMode);
  }, [theme, appearanceMode, resolvedTheme, resolvedMode]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, appearanceMode, resolvedMode, saving, setTheme, setAppearanceMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useEquusTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useEquusTheme turi būti naudojamas ThemeProvider viduje");
  return value;
}
