import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Palmtree, CalendarDays, Info } from "lucide-react";
import { toast } from "sonner";
import { formatDateISO } from "@/lib/equus";

export interface Vacation {
  id: string;
  user_id: string;
  starts_on: string;
  ends_on: string;
  note: string | null;
}

interface Props {
  userId: string | null;
  compact?: boolean;
}

export function VacationsPanel({ userId, compact }: Props) {
  const [items, setItems] = useState<Vacation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState(formatDateISO(new Date()));
  const [to, setTo] = useState(formatDateISO(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [affectedByVacation, setAffectedByVacation] = useState<Record<string, number>>({});

  const today = formatDateISO(new Date());

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("vacations")
      .select("id, user_id, starts_on, ends_on, note")
      .eq("user_id", userId)
      .order("starts_on", { ascending: true });
    if (error) toast.error(error.message);
    setItems((data ?? []) as Vacation[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

  const formatDate = (value: string) => new Intl.DateTimeFormat("lt-LT", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value + "T12:00:00"));
  const getDays = (start: string, end: string) => Math.round((new Date(end + "T12:00:00").getTime() - new Date(start + "T12:00:00").getTime()) / 86400000) + 1;

  useEffect(() => {
    if (!userId || items.length === 0) { setAffectedByVacation({}); return; }
    (async () => {
      const { data } = await (supabase as any).from("bookings").select("slot_date, status").eq("user_id", userId);
      const counts: Record<string, number> = {};
      for (const vacation of items) {
        counts[vacation.id] = (data ?? []).filter((b: any) => b.slot_date >= vacation.starts_on && b.slot_date <= vacation.ends_on && !["cancelled", "canceled"].includes(String(b.status).toLowerCase())).length;
      }
      setAffectedByVacation(counts);
    })();
  }, [userId, items]);

  const add = async () => {
    if (!userId) return;
    if (to < from) { toast.error("Pabaigos data turi būti po pradžios"); return; }
    if (!confirm(`Užregistruoti atostogas ${from} – ${to}? Visos aktyvios treniruotės šiame laikotarpyje bus atšauktos ir, jei priskirtos abonementui, grąžintos.`)) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("add_vacation_and_cancel", {
      _user_id: userId,
      _starts_on: from,
      _ends_on: to,
      _note: note.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const cancelled = (data as any)?.cancelled_bookings ?? 0;
    toast.success(
      cancelled > 0
        ? `Atostogos pridėtos — atšaukta ${cancelled} treniruočių`
        : "Atostogos pridėtos",
    );
    setAdding(false); setNote("");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("vacations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta");
    load();
  };

  const upcoming = items.filter((v) => v.ends_on >= today);
  const past = items.filter((v) => v.ends_on < today);

  return (
    <div className={compact ? "" : "px-5 py-4"}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-gold/70 flex items-center gap-1.5">
          <Palmtree className="w-3.5 h-3.5" /> Užregistruotos atostogos
        </div>
        {!adding && (
          <Button size="sm" variant="outlineGold" onClick={() => setAdding(true)} disabled={!userId}>
            <Plus className="w-3.5 h-3.5" /> Pridėti
          </Button>
        )}
      </div>

      {adding && (
        <div className="mb-3 p-3 rounded-md border border-gold/20 bg-gold/5 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <Label htmlFor="vp-from" className="text-xs">Nuo</Label>
              <Input id="vp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="vp-to" className="text-xs">Iki</Label>
              <Input id="vp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <Input placeholder="Pastaba (nebūtina)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Atgal</Button>
            <Button size="sm" variant="gold" onClick={add} disabled={busy}>Išsaugoti</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground italic">Kraunama…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gold/20 bg-gold/5 p-5 text-center">
          <Palmtree className="mx-auto h-8 w-8 text-gold/60" />
          <p className="mt-2 text-sm font-medium">Atostogų dar neužregistruota</p>
          <p className="mt-1 text-xs text-muted-foreground">Praneškite apie laikotarpį, kuriuo nedalyvausite, ir sistema pasirūpins susijusiomis pamokomis.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {upcoming.map((v) => {
            const active = v.starts_on <= today && v.ends_on >= today;
            const days = getDays(v.starts_on, v.ends_on);
            const affected = affectedByVacation[v.id] ?? 0;
            return (
              <div key={v.id} className={`rounded-2xl border p-4 ${active ? "border-gold/50 bg-gold/10" : "border-gold/20 bg-background/40"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Palmtree className="h-4 w-4 shrink-0 text-gold" />
                      <span className="font-medium">{active ? "Atostogos vyksta" : "Planuojamos atostogos"}</span>
                      {active && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold">Dabar</span>}
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-foreground/85">
                      <CalendarDays className="h-3.5 w-3.5 text-gold/70" />
                      {formatDate(v.starts_on)} – {formatDate(v.ends_on)}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{days} {days === 1 ? "diena" : days < 10 ? "dienos" : "dienų"}</span>
                      <span>{affected} {affected === 1 ? "pamoka" : affected < 10 ? "pamokos" : "pamokų"} laikotarpyje</span>
                    </p>
                    {v.note && <p className="mt-2 rounded-lg bg-background/40 px-3 py-2 text-xs text-muted-foreground">{v.note}</p>}
                  </div>
                  <Button size="sm" variant="ghost" aria-label="Pašalinti atostogas" onClick={() => remove(v.id)} className="shrink-0 text-destructive hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
          {past.length > 0 && (
            <details className="pt-2">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-muted-foreground hover:text-gold">Praeitos atostogos ({past.length})</summary>
              <div className="mt-2 space-y-2">
                {past.map((v) => (
                  <div key={v.id} className="rounded-xl border border-muted/20 bg-background/20 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-2">
                      <span>{formatDate(v.starts_on)} – {formatDate(v.ends_on)}</span>
                      <Button size="sm" variant="ghost" aria-label="Pašalinti atostogas" onClick={() => remove(v.id)} className="h-7 w-7 p-0 text-destructive hover:text-destructive"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="flex gap-2 rounded-xl border border-gold/10 bg-gold/5 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold/70" />
            <span>Aktyvios pamokos atostogų laikotarpiu atšaukiamos automatiškai, o abonementinės pamokos grąžinamos pagal atostogų taisykles.</span>
          </div>
        </div>
      )}}
    </div>
  );
}

/** Small banner shown to end-users on Grafikas/Paskyra when they have an active/upcoming vacation. */
export function VacationBanner({ userId }: { userId: string | null }) {
  const [items, setItems] = useState<Vacation[]>([]);
  useEffect(() => {
    if (!userId) { setItems([]); return; }
    const today = formatDateISO(new Date());
    (supabase as any).from("vacations")
      .select("id, user_id, starts_on, ends_on, note")
      .eq("user_id", userId)
      .gte("ends_on", today)
      .order("starts_on", { ascending: true })
      .limit(3)
      .then(({ data }: any) => setItems((data ?? []) as Vacation[]));
  }, [userId]);
  if (items.length === 0) return null;
  const today = formatDateISO(new Date());
  return (
    <div className="mb-4 rounded-md border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm flex items-center gap-2">
      <Palmtree className="w-4 h-4 text-gold shrink-0" />
      <div className="text-foreground/85">
        {items.map((v, i) => (
          <span key={v.id}>
            {i > 0 && <span className="mx-2 text-gold/40">·</span>}
            <span className={v.starts_on <= today ? "font-medium text-gold" : ""}>
              Atostogos {v.starts_on} → {v.ends_on}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}