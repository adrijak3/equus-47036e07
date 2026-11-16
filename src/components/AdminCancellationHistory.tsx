import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/equus";
import { History, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";

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
  accidental?: boolean | null;
  name?: string;
  cancelled_by_name?: string | null;
  fromRequest?: boolean;
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
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { setQ(initialQuery); }, [initialQuery]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("booking_cancellations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(400);
      const auditRows = ((data ?? []) as Row[]);
      // The old weekly cleanup deleted historical audit rows. Reconstruct the
      // request history from durable cancellation_requests without pretending
      // these reconstructed records are original audit log entries.
      const { data: requests, error: requestError } = await (supabase as any)
        .from("cancellation_requests")
        .select("id,booking_id,user_id,reason,created_at,status")
        .order("created_at", { ascending: false })
        .limit(600);
      if (requestError) console.error("Cancellation request history error:", requestError);
      const historicalRequests = (requests ?? []) as Array<{
        id:string;booking_id:string;user_id:string;reason:string|null;
        created_at:string;status:string;
      }>;
      const bookingIds = [...new Set(historicalRequests.map((r) => r.booking_id).filter(Boolean))];
      const { data: bookingInfo } = bookingIds.length
        ? await supabase.from("bookings").select("id,slot_date,slot_time").in("id", bookingIds)
        : { data: [] as Array<{id:string;slot_date:string;slot_time:string}> };
      const bookingMap = new Map((bookingInfo ?? []).map((b) => [b.id,b]));
      const loggedBookings = new Set(auditRows.map(r => r.booking_id).filter(Boolean));
      const reconstructed: Row[] = historicalRequests
        .filter(r => !loggedBookings.has(r.booking_id))
        .map(r => ({
          id: "request:" + r.id,
          booking_id: r.booking_id,
          user_id: r.user_id,
          slot_date: bookingMap.get(r.booking_id)?.slot_date ?? "",
          slot_time: bookingMap.get(r.booking_id)?.slot_time ?? "00:00",
          guest_name: null,
          cancelled_by_role: "client",
          reason: r.reason,
          restored_at: null,
          created_at: r.created_at,
          fromRequest: true,
        }));
      const list = [...auditRows,...reconstructed].sort(
        (a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()
      );
      const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))] as string[];
      const actorIds = [...new Set(list.map((r: any) => r.cancelled_by).filter(Boolean))] as string[];
      const guestIds = [
        ...new Set(list.map((r: any) => r.guest_rider_id).filter(Boolean)),
      ] as string[];

      const [{ data: profs }, { data: actors }, { data: guests }] = await Promise.all([
        ids.length
          ? supabase.from("profiles").select("id, full_name").in("id", ids)
          : Promise.resolve({ data: [] as any[] } as any),
        actorIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", actorIds)
          : Promise.resolve({ data: [] as any[] } as any),
        guestIds.length
          ? (supabase as any)
              .from("guest_riders")
              .select("id, first_name, last_name")
              .in("id", guestIds)
          : Promise.resolve({ data: [] as any[] } as any),
      ]);

      const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      const actorMap = new Map((actors ?? []).map((p: any) => [p.id, p.full_name]));
      const guestMap = new Map(
        (guests ?? []).map((g: any) => [g.id, `${g.first_name} ${g.last_name}`.trim()]),
      );

      setRows(
        list.map((r: any) => ({
          ...r,
          name:
            (r.user_id ? map.get(r.user_id) : null) ??
            r.guest_name ??
            (r.guest_rider_id ? guestMap.get(r.guest_rider_id) : null) ??
            "—",
          cancelled_by_name: r.cancelled_by ? (actorMap.get(r.cancelled_by) ?? null) : null,
        })),
      );
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

  const grouped = useMemo(() => {
    const result: Array<{ kind: "single" | "group"; key: string; rows: Row[] }> = [];
    const used = new Set<string>();
    for (const row of filtered) {
      if (used.has(row.id)) continue;
      const created = new Date(row.created_at).getTime();
      const sameBatch = filtered.filter((candidate) => {
        if (used.has(candidate.id)) return false;
        if (candidate.user_id !== row.user_id) return false;
        if (candidate.cancelled_by_role !== row.cancelled_by_role) return false;
        if ((candidate.reason ?? "") !== (row.reason ?? "")) return false;
        if (candidate.slot_time !== row.slot_time) return false;
        return Math.abs(new Date(candidate.created_at).getTime() - created) <= 5000;
      });
      if (sameBatch.length >= 3) {
        sameBatch.forEach((x) => used.add(x.id));
        result.push({ kind: "group", key: row.id, rows: sameBatch.sort((a, b) => a.slot_date.localeCompare(b.slot_date)) });
      } else {
        used.add(row.id);
        result.push({ kind: "single", key: row.id, rows: [row] });
      }
    }
    return result;
  }, [filtered]);

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
        Istorija saugoma. Anksčiau ištrinti audito įrašai, kai įmanoma, rodomi pagal išlikusius atšaukimo prašymus.
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
          {grouped.map((group) => {
            const r = group.rows[0];
            const isOpen = expanded === group.key;
            if (group.kind === "group") {
              const dates = group.rows.map((x) => x.slot_date);
              return (
                <li key={group.key} className="px-4 py-3 text-sm">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : group.key)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left">
                    <span className="font-medium text-foreground">{r.name}</span>
                    <span className="tabular-nums text-gold">{formatTime(r.slot_time)}</span>
                    <span className="text-muted-foreground">Kelios pamokos · {group.rows.length}</span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ROLE_CLS[r.cancelled_by_role] ?? ROLE_CLS.system)}>
                      Atšaukė: {r.cancelled_by_name ?? ROLE_LABEL[r.cancelled_by_role] ?? r.cancelled_by_role}
                    </span>
                    {isOpen ? <ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" /> : <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />}
                  </button>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {dates[0]}{dates.length > 1 ? ` → ${dates[dates.length - 1]}` : ""}
                  </div>
                  {isOpen && (
                    <div className="mt-3 rounded-md border border-gold/10 bg-background/30 p-3 space-y-1">
                      {group.rows.map((x) => (
                        <div key={x.id} className="flex items-center justify-between gap-3 text-xs">
                          <span>{x.slot_date}</span>
                          <span className="text-muted-foreground">{x.reason ? `„${x.reason}“` : "Atšaukta"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            }
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="font-medium text-foreground">{r.name}</span>
                <span className="tabular-nums text-gold">{formatTime(r.slot_time)}</span>
                <span className="tabular-nums text-muted-foreground">{r.slot_date}</span>
                <span className="text-xs text-muted-foreground">{r.fromRequest ? "Prašymas: " : "Atšaukta: "}{new Date(r.created_at).toLocaleString("lt-LT")}</span>
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ROLE_CLS[r.cancelled_by_role] ?? ROLE_CLS.system)}>Atšaukė: {ROLE_LABEL[r.cancelled_by_role] ?? r.cancelled_by_role}</span>
                {r.fromRequest && <span className="text-xs text-muted-foreground">atkurta iš prašymo</span>}
                {r.accidental && <span className="rounded-full border border-blush/40 bg-blush/10 px-2 py-0.5 text-[11px] text-blush">per klaidą</span>}
                {r.restored_at && <span className="inline-flex items-center gap-1 rounded-full border border-avail-free/40 bg-avail-free/10 text-avail-free"><RotateCcw className="h-3 w-3" /> grąžinta</span>}
                {r.reason && <span className="w-full text-xs italic text-muted-foreground">„{r.reason}“</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}