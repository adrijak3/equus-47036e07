import {
  CalendarHeart,
  Check,
  Flower2,
  Leaf,
  Loader2,
  Monitor,
  Moon,
  Sparkles,
  Stars,
  Snowflake,
  Sun,
  Waves,
} from "lucide-react";

import {
  useEquusTheme,
  type AppearanceMode,
  type EquusTheme,
} from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

const THEMES: Array<{
  value: EquusTheme;
  label: { lt: string; en: string };
  icon: typeof Sun;
  description: { lt: string; en: string };
  preview: string;
}> = [
  {
    value: "automatic",
    label: { lt: "Automatinė", en: "Automatic" },
    icon: CalendarHeart,
    description: { lt: "Tema keičiasi pagal metų laiką.", en: "Changes with the season." },
    preview: "from-rose-200 via-amber-200 to-slate-800",
  },
  {
    value: "spring",
    label: { lt: "Pavasaris", en: "Spring" },
    icon: Flower2,
    description: { lt: "Rožinė sakurų tema.", en: "Pink sakura theme." },
    preview: "from-[#f6c4d9] via-[#dc87ae] to-[#9f4674]",
  },
  {
    value: "summer",
    label: { lt: "Vasara", en: "Summer" },
    icon: Sun,
    description: { lt: "Geltonas, violetinis ir aqua saulėlydis.", en: "Yellow, violet and aqua sunset." },
    preview: "from-[#f9d75e] via-[#bd83da] to-[#58bfd0]",
  },
  {
    value: "autumn",
    label: { lt: "Ruduo", en: "Autumn" },
    icon: Leaf,
    description: { lt: "Karamelė, varis ir klevo lapai.", en: "Caramel, copper and maple leaves." },
    preview: "from-[#2a1712] via-[#72412a] to-[#d08a4c]",
  },
  {
    value: "winter",
    label: { lt: "Žiema", en: "Winter" },
    icon: Snowflake,
    description: { lt: "Tamsi arktinė Equus tema.", en: "Midnight arctic Equus theme." },
    preview: "from-[#07111f] via-[#102b49] to-[#7cbcff]",
  },
  {
    value: "ocean",
    label: { lt: "Vandenynas", en: "Ocean" },
    icon: Waves,
    description: { lt: "Šviesi turkio ir jūros tema.", en: "Light turquoise sea theme." },
    preview: "from-[#d7eef4] via-[#69c2d4] to-[#1a6f8c]",
  },
  {
    value: "lavender",
    label: { lt: "Levanda", en: "Lavender" },
    icon: Sparkles,
    description: { lt: "Švelni violetinė tema.", en: "Soft violet theme." },
    preview: "from-[#efe6fb] via-[#b28ae0] to-[#6a45a8]",
  },
  {
    value: "midnight",
    label: { lt: "Vidurnaktis", en: "Midnight" },
    icon: Stars,
    description: { lt: "Tamsi mėlyna su auksu.", en: "Deep navy with gold." },
    preview: "from-[#0d1320] via-[#1d2b45] to-[#e2be6a]",
  },
];

const MODES: Array<{
  value: AppearanceMode;
  label: { lt: string; en: string };
  icon: typeof Sun;
}> = [
  { value: "automatic", label: { lt: "Pagal sezoną", en: "Season default" }, icon: Monitor },
  { value: "light", label: { lt: "Šviesi", en: "Light" }, icon: Sun },
  { value: "dark", label: { lt: "Tamsi", en: "Dark" }, icon: Moon },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, appearanceMode, setAppearanceMode, saving } = useEquusTheme();
  const { language } = useLanguage();

  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
        {THEMES.map(({ value, label, icon: Icon, description, preview }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                "rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5",
                active ? "border-gold bg-gold/15 shadow-gold" : "border-border bg-card hover:border-gold/50",
              )}
            >
              {!compact && <div className={cn("mb-3 h-14 rounded-lg bg-gradient-to-br", preview)} />}
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-gold" />
                <span className="font-semibold">{label[language]}</span>
                {active && (saving ? <Loader2 className="ml-auto h-4 w-4 animate-spin" /> : <Check className="ml-auto h-4 w-4 text-gold" />)}
              </div>
              {!compact && <p className="mt-2 text-xs text-muted-foreground">{description[language]}</p>}
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {language === "lt" ? "Šviesumas" : "Brightness"}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map(({ value, label, icon: Icon }) => {
            const active = appearanceMode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setAppearanceMode(value)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-xs transition-all",
                  active ? "border-gold bg-gold/15 text-gold shadow-gold" : "border-border bg-card text-muted-foreground hover:border-gold/50 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label[language]}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {language === "lt"
            ? "Tamsus pavasaris tampa rožiniu vakaru, o tamsi vasara – tropine naktimi."
            : "Dark Spring becomes a pink evening, while Dark Summer becomes a tropical night."}
        </p>
      </div>
    </div>
  );
}
