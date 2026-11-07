import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Activity = {
  id: string;
  created_at: string;
  type: "abonementas" | "atšaukimas";
  target_id: string | null;
  actor_id: string | null;
  action: string;
  detail: string;
};

/** Read-only view of existing, server-written audit records; no customer data is changed. */
export function AdminActivityHistory() {
  const [rows, setRows] = useState<Activity[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const [audit, cancellations] = await Promise.all([
      (supabase as any).from("subscription_audit_log")
        .select("id,created_at,target_user_id,actor_user_id,action,subscription_id")
        .order("created_at", { ascending: false }).limit(200),
      (supabase as any).from("booking_cancellations")
        .select("id,created_at,user_id,cancelled_by,cancelled_by_role,slot_date,slot_time,reason")
        .order("created_at", { ascending: false }).limit(200),
    ]);
    if (audit.error || cancellations.error) {
      toast.error("Nepavyko įkelti veiksmų istorijos.");
      setBusy(false);
      return;
    }
    const list: Activity[] = [
      ...(audit.data ?? []).map((x: any) => ({
        id: "subscription-" + x.id, created_at: x.created_at,
        type: "abonementas" as const, target_id: x.target_user_id,
        actor_id: x.actor_user_id, action: String(x.action ?? "Abonemento pakeitimas"),
        detail: x.subscription_id ? "Abonemento įrašas" : "Mokėjimo / abonemento veiksmas",
      })),
      ...(cancellations.data ?? []).map((x: any) => ({
        id: "cancellation-" + x.id, created_at: x.created_at,
        type: "atšaukimas" as const, target_id: x.user_id,
        actor_id: x.cancelled_by, action: "Atšaukta treniruotė",
        detail: [x.slot_date, String(x.slot_time ?? "").slice(0, 5), x.reason].filter(Boolean).join(" · "),
      })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const ids = Array.from(new Set(list.flatMap(r => [r.target_id, r.actor_id]).filter(Boolean))) as string[];
    const { data: people } = ids.length
      ? await supabase.from("profiles").select("id,full_name").in("id", ids)
      : { data: [] };
    setNames(Object.fromEntries((people ?? []).map(p => [p.id, p.full_name ?? "—"])));
    setRows(list);
    setBusy(false);
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter(row => {
    const text = [row.type, row.action, row.detail, names[row.target_id ?? ""], names[row.actor_id ?? ""]]
      .join(" ").toLocaleLowerCase("lt-LT");
    return text.includes(search.trim().toLocaleLowerCase("lt-LT"));
  }), [rows, names, search]);

  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 font-display text-2xl"><History className="h-5 w-5 text-gold" /> Veiksmų istorija</h2>
        <p className="mt-1 text-sm text-muted-foreground">Abonementų veiksmai ir treniruočių atšaukimai. Tik peržiūra; istorija nekeičiama.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
        <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Atnaujinti
      </Button>
    </div>
    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ieškoti pagal raitelį, veiksmą ar datą…" />
    <div className="max-h-[650px] space-y-2 overflow-y-auto">
      {filtered.map(row => <article key={row.id} className="rounded-xl border border-border/70 bg-background/60 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-sm font-medium">{row.action}</p>
            <p className="mt-1 text-xs text-muted-foreground">{row.detail}</p></div>
          <span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString("lt-LT")}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Raitelis: {names[row.target_id ?? ""] ?? "—"} · Atliko: {names[row.actor_id ?? ""] ?? "Sistema / nežinoma"}</p>
      </article>)}
      {!busy && !filtered.length && <p className="rounded-xl border border-border/60 p-5 text-sm text-muted-foreground">Įrašų nerasta.</p>}
    </div>
  </section>;
}
