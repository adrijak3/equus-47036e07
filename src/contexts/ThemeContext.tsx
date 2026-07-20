import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type EquusTheme = "automatic" | "spring" | "summer" | "autumn" | "winter";
export type ResolvedTheme = Exclude<EquusTheme, "automatic">;

interface ThemeContextValue {
  theme: EquusTheme;
  resolvedTheme: ResolvedTheme;
  saving: boolean;
  setTheme: (theme: EquusTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "equus_seasonal_theme";

const validThemes: EquusTheme[] = ["automatic", "spring", "summer", "autumn", "winter"];

function seasonalTheme(month = new Date().getMonth()): ResolvedTheme {
  if ([2, 3, 4].includes(month)) return "spring";
  if ([5, 6, 7].includes(month)) return "summer";
  if ([8, 9, 10].includes(month)) return "autumn";
  return "winter";
}

function initialTheme(): EquusTheme {
  const saved = localStorage.getItem(STORAGE_KEY) as EquusTheme | null;
  return saved && validThemes.includes(saved) ? saved : "automatic";
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "winter" || theme === "autumn");
  document.documentElement.style.colorScheme = theme === "spring" || theme === "summer" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<EquusTheme>(initialTheme);
  const [saving, setSaving] = useState(false);
  const resolvedTheme = useMemo<ResolvedTheme>(() => theme === "automatic" ? seasonalTheme() : theme, [theme]);

  const setTheme = (next: EquusTheme) => {
    setSaving(true);
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    window.setTimeout(() => setSaving(false), 250);
  };

  useEffect(() => {
    applyTheme(resolvedTheme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, saving, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useEquusTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useEquusTheme turi būti naudojamas ThemeProvider viduje");
  return value;
}
