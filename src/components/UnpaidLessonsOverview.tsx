import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarDays, ChevronRight, ReceiptText } from "lucide-react";
import { formatTime } from "@/lib/equus";

const MONTHS = ["Sausis", "Vasaris", "Kovas", "Balandis", "Gegužė", "Birželis", "Liepa", "Rugpjūtis", "Rugsėjis", "Spalis", "Lapkritis", "Gruodis"];

type Row = { id: string; user_id: string; slot_date: string; slot_time: string; status: string; subscription_id: string | null; counts_in_subscription: boolean };
type Profile = { id: string; full_name: string };

function monthKeys() {
  const now = new Date();
  return [2, 1, 0].map((offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()] };
  });
}

export function UnpaidLessonsOverview({ userId, staff = false }: { userId?: string | null; staff?: boolean }) {
  const months = useMemo(monthKeys, []);
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<{ title: string; rows: Row[] } | null>(null);

  useEffect(() => {
    (async () => {
      const start = `${months[0].key}-01`;
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1, 0);
      const end = endDate.toISOString().slice(0, 10);
      let q = supabase.from("bookings").select("id,user_id,slot_date,slot_time,status,subscription_id,counts_in_subscription")
        .gte("slot_date", start).lte("slot_date", end)
        .in("status", ["active", "completed"])
        .is("subscription_id", null)
        .eq("counts_in_subscription", true)
        .order("slot_date", { ascending: false });
      if (userId) q = q.eq("user_id", userId);
      const { data } = await q;
      const list = (data ?? []) as Row[];
      setRows(list);
      if (staff) {
        const ids = Array.from(new Set(list.map((x) => x.user_id)));
        if (ids.length) {
          const { data: ps } = await supabase.from("profiles").select("id,full_name").in("id", ids);
          setProfiles((ps ?? []) as Profile[]);
        }
      }
    })();
  }, [userId, staff]);

  if (staff) {
    const grouped = profiles.map((p) => ({
      profile: p,
      months: months.map((m) => ({ ...m, rows: rows.filter((r) => r.user_id === p.id && r.slot_date.startsWith(m.key)) })),
    })).filter((x) => x.months.some((m) => m.rows.length));
    return (
      <div className="space-y-3">
        {grouped.length === 0 ? <p className="text-sm italic text-muted-foreground">Nepriskirtų treniruočių per paskutinius 3 mėnesius nėra.</p> : grouped.map(({ profile, months: ms }) => (
          <div key={profile.id} className="rounded-lg border border-gold/15 bg-gradient-card p-4">
            <div className="font-medium mb-3">{profile.full_name}</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {ms.map((m) => <MonthButton key={m.key} label={m.label} rows={m.rows} onOpen={() => setSelected({ title: `${profile.full_name} · ${m.label}`, rows: m.rows })} />)}
            </div>
          </div>
        ))}
        <DetailsDialog selected={selected} onClose={() => setSelected(null)} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gold/15 bg-gradient-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1"><ReceiptText className="w-4 h-4 text-gold" /><h3 className="font-display text-xl text-gradient-gold">Nepriskirtos treniruotės</h3></div>
      <p className="text-xs text-muted-foreground mb-4">Rodomos tik įvykusios treniruotės, kurios dar nepriskirtos jokiam abonementui.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        {months.map((m) => { const mr = rows.filter((r) => r.slot_date.startsWith(m.key)); return <MonthButton key={m.key} label={m.label} rows={mr} onOpen={() => setSelected({ title: m.label, rows: mr })} />; })}
      </div>
      <DetailsDialog selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function MonthButton({ label, rows, onOpen }: { label: string; rows: Row[]; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="flex items-center justify-between rounded-md border border-gold/15 bg-background/35 px-3 py-3 text-left hover:border-gold/40 transition-colors">
    <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "treniruotė" : "treniruotės"}</span></span>
    <ChevronRight className="w-4 h-4 text-gold/60" />
  </button>;
}

function DetailsDialog({ selected, onClose }: { selected: { title: string; rows: Row[] } | null; onClose: () => void }) {
  return <Dialog open={!!selected} onOpenChange={(o) => !o && onClose()}><DialogContent className="bg-gradient-card border-gold/20"><DialogHeader><DialogTitle className="font-display text-2xl text-gradient-gold">{selected?.title}</DialogTitle></DialogHeader>
    {!selected?.rows.length ? <p className="text-sm italic text-muted-foreground py-3">Šį mėnesį nepriskirtų treniruočių nėra.</p> : <ul className="space-y-2 max-h-80 overflow-auto">{selected.rows.map((r) => <li key={r.id} className="flex items-center gap-3 rounded-md border border-gold/10 bg-background/30 px-3 py-2.5"><CalendarDays className="w-4 h-4 text-gold"/><span className="text-sm">{new Date(`${r.slot_date}T12:00:00`).toLocaleDateString("lt-LT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span><span className="ml-auto tabular-nums text-sm text-muted-foreground">{formatTime(r.slot_time)}</span></li>)}</ul>}
  </DialogContent></Dialog>;
}
