import { useEffect, useMemo, useState } from "react";
import { CreditCard, Search, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Row = {
  id: string;
  user_id: string;
  lessons_total: number;
  lessons_used: number;
  price: number;
  purchase_date: string;
  expires_at: string | null;
  paid: boolean;
  package_type?: string | null;
  horse_type?: string | null;
  purchase_method?: string | null;
  start_from_date?: string | null;
  start_pending?: boolean;
  full_name?: string;
  email?: string;
};

const packageLabel = (v?: string | null) => v === "po2" ? "Po 2" : v === "group" ? "Grupinė" : "—";
const horseLabel = (v?: string | null) => v === "own" ? "Privatus žirgas" : v === "school" ? "Mokyklos žirgas" : "—";

export default function HalfAdminSubscriptions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("subscriptions")
      .select("id,user_id,lessons_total,lessons_used,price,purchase_date,expires_at,paid,package_type,horse_type,purchase_method,start_from_date")
      .order("purchase_date", { ascending: false })
      .limit(500);

    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    const userIds = Array.from(new Set((data ?? []).map((s: any) => s.user_id)));
    let profiles: any[] = [];
    if (userIds.length) {
      const { data: p } = await supabase.from("profiles").select("id,full_name").in("id", userIds);
      profiles = p ?? [];
    }
    const names = Object.fromEntries(profiles.map((p) => [p.id, p.full_name]));
    const emailMap: Record<string, string> = {};

    // Email is intentionally not read from auth.users here; the page only needs
    // profile/subscription data and RLS already protects subscriptions.
    setRows((data ?? []).map((s: any) => ({
      ...s,
      full_name: names[s.user_id] ?? "Nežinomas klientas",
      email: emailMap[s.user_id],
    })));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) =>
      (s.full_name ?? "").toLowerCase().includes(q)
      || s.user_id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70">Pusiau admino sritis</p>
        <h1 className="mt-2 text-4xl font-display text-gradient-gold">Abonementai</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tik peržiūra. Abonementų čia keisti ar trinti negalima.
        </p>
      </header>

      <div className="mb-5 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ieškoti pagal kliento vardą…"
        />
      </div>

      {loading ? (
        <p className="py-12 text-center text-muted-foreground">Kraunama…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-gold/15 bg-gradient-card p-10 text-center">
          <CreditCard className="mx-auto h-8 w-8 text-gold/50" />
          <p className="mt-3 font-display text-lg">Abonementų nerasta</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const remaining = Math.max(0, Number(s.lessons_total) - Number(s.lessons_used));
            return (
              <div key={s.id} className="rounded-2xl border border-gold/15 bg-gradient-card p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/20 bg-gold/10">
                      <UserRound className="h-5 w-5 text-gold" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-lg text-gold truncate">{s.full_name}</p>
                      <p className="text-xs text-muted-foreground">{packageLabel(s.package_type)} · {horseLabel(s.horse_type)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:min-w-[520px]">
                    <div className="rounded-xl bg-background/40 p-2.5">
                      <p className="text-[10px] uppercase text-muted-foreground">Liko</p>
                      <p className="font-semibold">{remaining} / {s.lessons_total}</p>
                    </div>
                    <div className="rounded-xl bg-background/40 p-2.5">
                      <p className="text-[10px] uppercase text-muted-foreground">Kaina</p>
                      <p className="font-semibold">{Number(s.price).toFixed(2)} €</p>
                    </div>
                    <div className="rounded-xl bg-background/40 p-2.5">
                      <p className="text-[10px] uppercase text-muted-foreground">Galioja iki</p>
                      <p className="font-semibold">{s.start_pending ? "Po pirmos treniruotės" : s.expires_at ? new Date(s.expires_at + "T12:00:00").toLocaleDateString("lt-LT") : "—"}</p>
                    </div>
                    <div className="rounded-xl bg-background/40 p-2.5">
                      <p className="text-[10px] uppercase text-muted-foreground">Mokėjimas</p>
                      <p className="font-semibold">{s.paid ? "Apmokėta" : "Neapmokėta"}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
