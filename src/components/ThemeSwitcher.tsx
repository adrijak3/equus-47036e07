import { Check, Gem, Loader2, Moon, Palette, Trees } from "lucide-react";
import { useEquusTheme, type EquusTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const THEMES: {
  value: EquusTheme;
  label: string;
  shortLabel: string;
  icon: typeof Moon;
  description: string;
  previewClass: string;
  accentClass: string;
}[] = [
  {
    value: "ocean",
    label: "Equus Ocean",
    shortLabel: "Ocean",
    icon: Palette,
    description: "Firminė tamsiai mėlyna tema su stiklo efektu ir mėlynu švytėjimu.",
    previewClass: "bg-[linear-gradient(145deg,#081425,#102b49)] border-[#7cbcff]",
    accentClass: "bg-[#7cbcff]",
  },
  {
    value: "midnight",
    label: "Equus Midnight",
    shortLabel: "Midnight",
    icon: Moon,
    description: "Grafito ir sidabro tema – rami, neutrali ir tinkama vakarui.",
    previewClass: "bg-[linear-gradient(145deg,#111318,#20242b)] border-[#d4dae4]",
    accentClass: "bg-[#d4dae4]",
  },
  {
    value: "pearl",
    label: "Equus Pearl",
    shortLabel: "Pearl",
    icon: Gem,
    description: "Švari šviesi tema su perlo baltumo kortelėmis ir mėlynais akcentais.",
    previewClass: "bg-[linear-gradient(145deg,#ffffff,#eaf4ff)] border-[#3f8fca]",
    accentClass: "bg-[#3f8fca]",
  },
  {
    value: "stable",
    label: "Equus Stable",
    shortLabel: "Stable",
    icon: Trees,
    description: "Šilta medžio, odos ir kreminių atspalvių tema jaukiai žirgyno atmosferai.",
    previewClass: "bg-[linear-gradient(145deg,#241a15,#5a3d2a)] border-[#d7b184]",
    accentClass: "bg-[#d7b184]",
  },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, saving } = useEquusTheme();

  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
      {THEMES.map(({ value, label, shortLabel, icon: Icon, description, previewClass, accentClass }) => {
        const active = value === theme;

        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            className={cn(
              "group relative overflow-hidden rounded-xl border text-left transition-all duration-200",
              compact ? "flex items-center gap-2 px-3 py-2.5" : "p-3.5",
              active
                ? "border-gold/70 bg-gold/10 text-gold shadow-gold"
                : "border-gold/15 bg-background/40 text-foreground/75 hover:-translate-y-0.5 hover:border-gold/40 hover:text-gold",
            )}
            title={description}
          >
            {!compact && (
              <div className={cn("relative mb-3 h-14 overflow-hidden rounded-lg border-2 p-2", previewClass)}>
                <div className="absolute inset-0 bg-white/5 backdrop-blur-sm" />
                <div className="relative h-2 w-12 rounded-full bg-current opacity-80" />
                <div className="relative mt-2 h-1.5 w-20 rounded-full bg-current opacity-25" />
                <div className={cn("absolute bottom-2 right-2 h-5 w-5 rounded-full shadow-lg", accentClass)} />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-xs font-semibold">
                {compact ? shortLabel : label}
              </span>
              {active && (
                saving
                  ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />
                  : <Check className="ml-auto h-3.5 w-3.5" />
              )}
            </div>

            {!compact && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
