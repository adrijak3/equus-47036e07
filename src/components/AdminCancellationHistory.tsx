import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/equus";
import { History, RotateCcw } from "lucide-react";

interface Row {
  id: string;
  booking_id: string | null;
  user_id: string;
  slot_date: string;
  slot_time: string;
  guest_name: string | null;
  cancelled_by_role: string;
  reason: string | null;
  restored_at: string | null;
  created_at: string;
  name?: string;
}

const ROLE_LABEL: Record<string, string> = {
  client: "klientas",
  admin: "administracija",
  trainer: "trenerė",
  system: "sistema",
};

const ROLE_CLS: Record<string, string> = {
  client: "border-gold/30 bg-gold/10 text-gold",
  admin: "border-blush/30 bg-blush/10 text-blush",
  trainer: "border-avail-free/40 bg-avail-free/10 text-avail-free",
  system: "border-border bg-muted text-muted-foreground",
};

export function AdminCancellationHistory({ initialQuery = "" }: { initialQuery?: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(initialQuery);
  const [role, setRole] = useState<string>("all");

  useEffect(() => { setQ(initialQuery); }, [initialQuery]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("booking_cancellations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(400);
      const list = ((data ?? []) as Row[]);
      const ids = [...new Set(list.map((r) => r.user_id))];
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as any[] };
      const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      setRows(list.map((r) => ({ ...r, name: r.guest_name ?? map.get(r.user_id) ?? "—" })));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (role === "all" || r.cancelled_by_role === role) &&
        (!term || (r.name ?? "").toLowerCase().includes(term)),
    );
  }, [rows, q, role]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ieškoti pagal vardą..."
          className="max-w-xs"
        />
        {["all", "client", "admin", "trainer", "system"].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              role === r ? "border-gold bg-gold/15 text-gold" : "border-gold/20 text-muted-foreground hover:border-gold/40",
            )}
          >
            {r === "all" ? "Visi" : ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      <p className="text-[11px] italic text-muted-foreground">
        Atšaukimų istorija saugoma visam laikui — įrašai netrinami.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full bg-gold/10" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gold/20 px-4 py-8 text-center text-sm text-muted-foreground">
          <History className="mx-auto mb-2 h-5 w-5 text-gold/60" /> Atšaukimų nerasta.
        </div>
      ) : (
        <ul className="divide-y divide-gold/5 overflow-hidden rounded-lg border border-gold/15 bg-gradient-card">
          {filtered.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-foreground">{r.name}</span>
              <span className="tabular-nums text-gold">{formatTime(r.slot_time)}</span>
              <span className="tabular-nums text-muted-foreground">{r.slot_date}</span>
              <span className="text-xs text-muted-foreground">
                Atšaukė: {new Date(r.created_at).toLocaleString("lt-LT")}
              </span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ROLE_CLS[r.cancelled_by_role] ?? ROLE_CLS.system)}>
                Atšaukė: {ROLE_LABEL[r.cancelled_by_role] ?? r.cancelled_by_role}
              </span>
              {r.restored_at && (
                <span className="inline-flex items-center gap-1 rounded-full border border-avail-free/40 bg-avail-free/10 px-2 py-0.5 text-[11px] text-avail-free">
                  <RotateCcw className="h-3 w-3" /> grąžinta
                </span>
              )}
              {r.reason && <span className="w-full text-xs italic text-muted-foreground">„{r.reason}“</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}