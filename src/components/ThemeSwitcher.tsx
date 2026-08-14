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
  TreePine,
  Crown,
  Sprout,
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
  swatches: string[];
}> = [
  {
    value: "automatic",
    label: { lt: "Automatinė", en: "Automatic" },
    icon: CalendarHeart,
    description: { lt: "Tema keičiasi pagal metų laiką.", en: "Changes with the season." },
    preview: "from-rose-200 via-amber-200 to-slate-800",
    swatches: ["#f6c4d9", "#f9d75e", "#72412a", "#102b49"],
  },
  {
    value: "spring",
    label: { lt: "Pavasaris", en: "Spring" },
    icon: Flower2,
    description: { lt: "Rožinė sakurų tema.", en: "Pink sakura theme." },
    preview: "from-[#f6c4d9] via-[#dc87ae] to-[#9f4674]",
    swatches: ["#fdeef4", "#f6c4d9", "#dc87ae", "#9f4674"],
  },
  {
    value: "summer",
    label: { lt: "Vasara", en: "Summer" },
    icon: Sun,
    description: { lt: "Geltonas, violetinis ir aqua saulėlydis.", en: "Yellow, violet and aqua sunset." },
    preview: "from-[#f9d75e] via-[#bd83da] to-[#58bfd0]",
    swatches: ["#fff6d6", "#f9d75e", "#bd83da", "#58bfd0"],
  },
  {
    value: "autumn",
    label: { lt: "Ruduo", en: "Autumn" },
    icon: Leaf,
    description: { lt: "Karamelė, varis ir klevo lapai.", en: "Caramel, copper and maple leaves." },
    preview: "from-[#2a1712] via-[#72412a] to-[#d08a4c]",
    swatches: ["#2a1712", "#72412a", "#d08a4c", "#f0d9b5"],
  },
  {
    value: "winter",
    label: { lt: "Žiema", en: "Winter" },
    icon: Snowflake,
    description: { lt: "Tamsi arktinė Equus tema.", en: "Midnight arctic Equus theme." },
    preview: "from-[#07111f] via-[#102b49] to-[#7cbcff]",
    swatches: ["#07111f", "#102b49", "#7cbcff", "#e4f1ff"],
  },
  {
    value: "ocean",
    label: { lt: "Vandenynas", en: "Ocean" },
    icon: Waves,
    description: { lt: "Šviesi turkio ir jūros tema.", en: "Light turquoise sea theme." },
    preview: "from-[#d7eef4] via-[#69c2d4] to-[#1a6f8c]",
    swatches: ["#eaf7fa", "#a7dde8", "#69c2d4", "#1a6f8c"],
  },
  {
    value: "lavender",
    label: { lt: "Levanda", en: "Lavender" },
    icon: Sparkles,
    description: { lt: "Švelni violetinė tema.", en: "Soft violet theme." },
    preview: "from-[#efe6fb] via-[#b28ae0] to-[#6a45a8]",
    swatches: ["#efe6fb", "#cdb2ee", "#b28ae0", "#6a45a8"],
  },
  {
    value: "midnight",
    label: { lt: "Vidurnaktis", en: "Midnight" },
    icon: Stars,
    description: { lt: "Tamsi mėlyna su auksu.", en: "Deep navy with gold." },
    preview: "from-[#0d1320] via-[#1d2b45] to-[#e2be6a]",
    swatches: ["#0d1320", "#1d2b45", "#e2be6a", "#f6e8c4"],
  },
  {
    value: "forest",
    label: { lt: "Miškas", en: "Forest" },
    icon: TreePine,
    description: { lt: "Rami tamsiai žalia su šalavijo atspalviais.", en: "Calm dark green with sage accents." },
    preview: "from-[#1F3328] via-[#435E48] to-[#A5AF79]",
    swatches: ["#1F3328", "#435E48", "#A5AF79", "#F2E8D5"],
  },
  {
    value: "goldleaf",
    label: { lt: "Auksas", en: "Gold" },
    icon: Crown,
    description: { lt: "Elegantiška ruda su šampano auksu.", en: "Elegant brown with champagne gold." },
    preview: "from-[#2B2118] via-[#665238] to-[#B99A5E]",
    swatches: ["#2B2118", "#665238", "#B99A5E", "#F2E2BC"],
  },
  {
    value: "sage",
    label: { lt: "Švelni žalia", en: "Soft sage" },
    icon: Sprout,
    description: { lt: "Šviesi šalavijo ir smėlio tema.", en: "Light sage and sand theme." },
    preview: "from-[#E9E5D6] via-[#A5AF79] to-[#4E5944]",
    swatches: ["#E9E5D6", "#A5AF79", "#75825E", "#4E5944"],
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
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {THEMES.map(({ value, label, icon: Icon, swatches }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={active}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                active ? "border-gold bg-gold/15" : "border-border bg-card hover:border-gold/50",
              )}
            >
              <span className="flex shrink-0 -space-x-1.5">
                {swatches.map((c) => (
                  <span
                    key={c}
                    className="h-4 w-4 rounded-full border border-border/60"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <Icon className="h-3.5 w-3.5 shrink-0 text-gold" />
              <span className="truncate text-sm font-medium">{label[language]}</span>
              {active &&
                (saving ? (
                  <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-gold" />
                ))}
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
