import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Palmtree } from "lucide-react";
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

  const add = async () => {
    if (!userId) return;
    if (to < from) { toast.error("Pabaigos data turi būti po pradžios"); return; }
    setBusy(true);
    const { error } = await (supabase as any).from("vacations").insert({
      user_id: userId, starts_on: from, ends_on: to, note: note.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Atostogos pridėtos");
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
        <p className="text-xs text-muted-foreground italic">Nėra užregistruotų atostogų.</p>
      ) : (
        <div className="space-y-1.5">
          {upcoming.map((v) => {
            const active = v.starts_on <= today && v.ends_on >= today;
            return (
              <div key={v.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded border text-sm ${active ? "border-gold/50 bg-gold/10" : "border-gold/20 bg-background/40"}`}>
                <div>
                  <div className="tabular-nums font-medium">
                    {v.starts_on} → {v.ends_on}
                    {active && <span className="ml-2 text-[10px] uppercase tracking-wider text-gold">Vyksta</span>}
                  </div>
                  {v.note && <div className="text-xs text-muted-foreground mt-0.5">{v.note}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(v.id)} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
          {past.length > 0 && (
            <details className="pt-2">
              <summary className="text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-gold">
                Praeitos ({past.length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {past.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border border-muted/20 bg-background/20 text-xs text-muted-foreground">
                    <span className="tabular-nums">{v.starts_on} → {v.ends_on}</span>
                    <Button size="sm" variant="ghost" onClick={() => remove(v.id)} className="text-destructive hover:text-destructive h-6 w-6 p-0">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
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