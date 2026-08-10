import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatTime, WEEKDAYS_LT } from "@/lib/equus";
import { Search, IdCard, Star, CalendarDays, Wallet, ClipboardPenLine, History } from "lucide-react";

interface Profile { id: string; full_name: string; phone: string | null; }

interface Summary {
  permanents: { day_of_week: number; slot_time: string }[];
  upcoming: { slot_date: string; slot_time: string }[];
  sub: { lessons_total: number; lessons_used: number; expires_at: string; paid: boolean } | null;
  registrations: number;
  cancellations: number;
}

export function AdminGlobalSearch({ onGo }: { onGo: (section: string, query: string) => void }) {
  const [q, setQ] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, phone").order("full_name");
      setProfiles((data ?? []) as Profile[]);
    })();
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    return profiles
      .filter((p) => p.full_name.toLowerCase().includes(term) || (p.phone ?? "").includes(term))
      .slice(0, 6);
  }, [q, profiles]);

  useEffect(() => {
    if (!selected) { setSummary(null); return; }
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [perm, upcoming, subs, regs, cancels] = await Promise.all([
        supabase.from("permanent_slots").select("day_of_week, slot_time").eq("user_id", selected.id),
        supabase.from("bookings").select("slot_date, slot_time").eq("user_id", selected.id).eq("status", "active").gte("slot_date", today).order("slot_date").limit(5),
        supabase.from("subscriptions").select("lessons_total, lessons_used, expires_at, paid").eq("user_id", selected.id).order("purchase_date", { ascending: false }).limit(1),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("user_id", selected.id),
        (supabase as any).from("booking_cancellations").select("id", { count: "exact", head: true }).eq("user_id", selected.id),
      ]);
      setSummary({
        permanents: (perm.data ?? []) as any,
        upcoming: (upcoming.data ?? []) as any,
        sub: ((subs.data ?? [])[0] as any) ?? null,
        registrations: (regs as any).count ?? 0,
        cancellations: (cancels as any).count ?? 0,
      });
    })();
  }, [selected]);

  const row = (icon: any, label: string, value: string, section: string) => {
    const Icon = icon;
    return (
      <button
        type="button"
        onClick={() => onGo(section, selected?.full_name ?? "")}
        className="flex w-full items-center gap-3 rounded-md border border-gold/15 px-3 py-2 text-left text-sm transition-colors hover:border-gold/40 hover:bg-gold/5"
      >
        <Icon className="h-4 w-4 shrink-0 text-gold/70" />
        <span className="w-36 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-foreground/85">{value}</span>
      </button>
    );
  };

  return (
    <div className="mb-5 rounded-lg border border-gold/15 bg-gradient-card p-3 shadow-elegant">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold/60" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSelected(null); }}
          placeholder="Ieškoti vartotojo..."
          className="pl-9"
          aria-label="Ieškoti vartotojo"
        />
      </div>

      {!selected && results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelected(p)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gold/5"
              >
                <span className="truncate">{p.full_name}</span>
                <span className="text-xs text-muted-foreground">{p.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="font-display text-lg text-gradient-gold">{selected.full_name}</div>
            <button type="button" className="text-xs text-muted-foreground hover:text-gold" onClick={() => setSelected(null)}>
              Išvalyti
            </button>
          </div>
          {row(IdCard, "Profilis", selected.phone ?? "Telefonas nenurodytas", "users")}
          {row(
            Star,
            "Nuolatiniai laikai",
            summary?.permanents.length
              ? summary.permanents.map((p) => `${WEEKDAYS_LT[p.day_of_week - 1]?.slice(0, 3)} ${formatTime(p.slot_time)}`).join(", ")
              : "Nėra",
            "permanent",
          )}
          {row(
            CalendarDays,
            "Būsimos treniruotės",
            summary?.upcoming.length
              ? summary.upcoming.map((b) => `${b.slot_date} ${formatTime(b.slot_time)}`).join(", ")
              : "Nėra",
            "schedule",
          )}
          {row(
            Wallet,
            "Abonementas",
            summary?.sub
              ? `${summary.sub.lessons_used}/${summary.sub.lessons_total} · iki ${summary.sub.expires_at}${summary.sub.paid ? "" : " · neapmokėta"}`
              : "Nėra",
            "subs",
          )}
          {row(ClipboardPenLine, "Registracijų istorija", `${summary?.registrations ?? 0} įrašai`, "registrations")}
          {row(History, "Atšaukimų istorija", `${summary?.cancellations ?? 0} atšaukimai`, "cancels")}
        </div>
      )}

      {q.trim().length >= 2 && !selected && results.length === 0 && (
        <p className={cn("mt-2 px-1 text-xs text-muted-foreground")}>Vartotojų nerasta.</p>
      )}
    </div>
  );
}