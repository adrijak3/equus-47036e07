import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type EquusTheme =
  | "ocean"
  | "midnight"
  | "pearl"
  | "stable";

interface ThemeContextValue {
  theme: EquusTheme;
  setTheme: (theme: EquusTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

const STORAGE_KEY = "equus_theme";

const isTheme = (value: string | null): value is EquusTheme =>
  value === "ocean" ||
  value === "midnight" ||
  value === "pearl" ||
  value === "stable";

const getInitialTheme = (): EquusTheme => {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (saved === "blue") return "ocean";
  if (saved === "dark") return "midnight";
  if (saved === "light") return "pearl";

  return isTheme(saved) ? saved : "ocean";
};

const applyTheme = (theme: EquusTheme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle(
    "dark",
    theme !== "pearl",
  );
  document.documentElement.style.colorScheme =
    theme === "pearl" ? "light" : "dark";
};

export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [theme, setThemeState] =
    useState<EquusTheme>(getInitialTheme);

  const setTheme = (newTheme: EquusTheme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
    applyTheme(newTheme);
  };

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useEquusTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error(
      "useEquusTheme turi būti naudojamas ThemeProvider viduje",
    );
  }

  return context;
}
