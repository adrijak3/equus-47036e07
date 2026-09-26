import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

type PossibleDuplicate = { suspect_booking_id: string; slot_date: string; suspect_time: string; permanent_time: string; proper_booking_id: string; };

function shortTime(value: string) { return String(value).slice(0, 5); }

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("lt-LT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function UserDuplicateBookings({ userId }: { userId: string }) {
  const [rows, setRows] = useState<PossibleDuplicate[]>([]);
  const [chosen, setChosen] = useState<PossibleDuplicate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("get_possible_duplicate_bookings", { _user_id: userId });
    if (error) { console.error("Duplicate booking check failed:", error); toast.error("Nepavyko patikrinti galimų dublikatų."); setRows([]); }
    else setRows((data ?? []) as PossibleDuplicate[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, PossibleDuplicate[]>();
    for (const row of rows) { const list = map.get(row.slot_date) ?? []; list.push(row); map.set(row.slot_date, list); }
    return Array.from(map.entries());
  }, [rows]);

  const cancelOne = async (row: PossibleDuplicate) => {
    setBusyId(row.suspect_booking_id);
    const { data, error } = await (supabase as any).rpc("cancel_possible_duplicate_booking", { _booking_id: row.suspect_booking_id });
    if (error || data?.ok === false) toast.error(error?.message || data?.message || "Nepavyko pašalinti rezervacijos.");
    else { toast.success(`${shortTime(row.suspect_time)} rezervacija pašalinta.`); setChosen(null); await load(); }
    setBusyId(null);
  };

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-500/10 p-2"><AlertTriangle className="h-5 w-5 text-amber-500" /></div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-foreground">Galimi dublikatai</h3>
          <p className="mt-1 text-sm text-muted-foreground">Rodome tik galimas laiko poras. Nieko nešaliname automatiškai.</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/30 px-4 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Tikrinama…</div>
      ) : rows.length === 0 ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
          <div><p className="font-medium text-foreground">Dublikatų nerasta</p><p className="mt-1 text-sm text-muted-foreground">Šiuo metu būsimi laikai atrodo tvarkingi.</p></div>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {grouped.map(([date, dateRows]) => (
            <article key={date} className="rounded-xl border border-border bg-background/40 p-4">
              <div className="font-medium capitalize text-foreground">{formatDate(date)}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {dateRows.map((row) => (
                  <button key={row.suspect_booking_id} type="button" onClick={() => setChosen(row)} className="inline-flex items-center gap-2 rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-sm hover:border-gold/50 hover:bg-gold/10">
                    <Clock className="h-3.5 w-3.5 text-gold" /><span className="font-medium">{shortTime(row.suspect_time)}</span><span className="text-muted-foreground">→</span><span>{shortTime(row.permanent_time)}</span>
                  </button>
                ))}
              </div>
            </article>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">Spustelėk laiko porą, jei nori ją patikrinti.</p>
        </div>
      )}

      <Dialog open={!!chosen} onOpenChange={(open) => !open && setChosen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Galimas dublikatas</DialogTitle><DialogDescription>Patikrink šį vieną atvejį. Nieko nekeisime, kol nepasirinksi pašalinti rezervacijos.</DialogDescription></DialogHeader>
          {chosen && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="font-medium capitalize text-foreground">{formatDate(chosen.slot_date)}</p>
                <div className="mt-4 flex items-center justify-center gap-3 text-base"><span className="rounded-lg bg-amber-500/10 px-3 py-2 font-semibold">{shortTime(chosen.suspect_time)}</span><span className="text-muted-foreground">→</span><span className="rounded-lg bg-gold/10 px-3 py-2 font-semibold">{shortTime(chosen.permanent_time)}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Kairėje – galimas senas laikas. Dešinėje – dabartinis nuolatinis laikas.</p>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setChosen(null)}>Palikti abu</Button>
              <Button variant="destructive" className="w-full" disabled={busyId === chosen.suspect_booking_id} onClick={() => void cancelOne(chosen)}>
                {busyId === chosen.suspect_booking_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Pašalinti seną {shortTime(chosen.suspect_time)} rezervaciją
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
