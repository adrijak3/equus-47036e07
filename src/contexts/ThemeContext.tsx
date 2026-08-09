import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type EquusTheme =
  | "automatic"
  | "spring"
  | "summer"
  | "autumn"
  | "winter"
  | "ocean"
  | "lavender"
  | "midnight";
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
  return ["spring", "summer", "ocean", "lavender"].includes(theme) ? "light" : "dark";
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
  const resolvedTheme = useMemo<ResolvedTheme>(() => theme === "automatic" ? seasonalTheme() : theme, [theme]);
  const resolvedMode = appearanceMode === "automatic" ? naturalMode(resolvedTheme) : appearanceMode;

  const pulseSaving = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 250);
  };

  const setTheme = (next: EquusTheme) => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    pulseSaving();
  };

  const setAppearanceMode = (next: AppearanceMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
    pulseSaving();
  };

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
