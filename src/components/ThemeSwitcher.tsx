import { CalendarHeart, Check, Flower2, Leaf, Loader2, Snowflake, Sun } from "lucide-react";
import { useEquusTheme, type EquusTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const THEMES: Array<{
  value: EquusTheme;
  label: string;
  icon: typeof Sun;
  description: string;
  preview: string;
}> = [
  { value: "automatic", label: "Automatinė", icon: CalendarHeart, description: "Tema keičiasi pagal metų laiką.", preview: "from-rose-100 via-amber-100 to-slate-800" },
  { value: "spring", label: "Pavasaris", icon: Flower2, description: "Ivory, švelni sakura ir aiškus tamsus tekstas.", preview: "from-[#fffaf3] via-[#f9dce6] to-[#b85f7d]" },
  { value: "summer", label: "Vasara", icon: Sun, description: "Šiltas kremas, dangaus mėlyna ir auksiniai akcentai.", preview: "from-[#fff7dd] via-[#dff3ff] to-[#dfad55]" },
  { value: "autumn", label: "Ruduo", icon: Leaf, description: "Karamelė, varis ir klevo lapų atspalviai.", preview: "from-[#2a1712] via-[#72412a] to-[#d08a4c]" },
  { value: "winter", label: "Žiema", icon: Snowflake, description: "Dabartinė prabangi tamsiai mėlyna Equus tema.", preview: "from-[#07111f] via-[#102b49] to-[#7cbcff]" },
];

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, saving } = useEquusTheme();
  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
      {THEMES.map(({ value, label, icon: Icon, description, preview }) => {
        const active = theme === value;
        return (
          <button key={value} type="button" onClick={() => setTheme(value)}
            className={cn("rounded-xl border p-3 text-left transition-all", active ? "border-gold bg-gold/10 shadow-gold" : "border-border bg-card/70 hover:-translate-y-0.5 hover:border-gold/50")}
            aria-pressed={active}>
            {!compact && <div className={cn("mb-3 h-14 rounded-lg bg-gradient-to-br", preview)} />}
            <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-gold"/><span className="font-semibold">{label}</span>{active && (saving ? <Loader2 className="ml-auto h-4 w-4 animate-spin"/> : <Check className="ml-auto h-4 w-4 text-gold"/>)}</div>
            {!compact && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
          </button>
        );
      })}
    </div>
  );
}
