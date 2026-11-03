import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type HealthReport = {
  checked_at: string;
  period_start: string;
  period_end: string;
  duplicate_active_rider_slots: number;
  active_bookings_without_active_slot: number;
  slots_over_capacity: number;
  cancelled_recurring_without_exception: number;
  cancelled_and_active_same_rider_slot: number;
  horse_double_assignments: number;
  horse_unavailable_day_assignments: number;
  invalid_subscription_balances: number;
  pending_cancellation_requests: number;
};
const checks: { key: keyof HealthReport; title: string; note: string; critical?: boolean }[] = [
  { key: "duplicate_active_rider_slots", title: "Dvigubos aktyvios rezervacijos", note: "Tas pats raitelis tuo pačiu laiku", critical: true },
  { key: "slots_over_capacity", title: "Perpildyti užsiėmimai", note: "Daugiau aktyvių vietų nei leidžia nustatytas limitas", critical: true },
  { key: "active_bookings_without_active_slot", title: "Pamokos be galiojančio grafiko laiko", note: "Galimi seni ar netiksliai perkelti užsiėmimai", critical: true },
  { key: "horse_double_assignments", title: "Žirgas priskirtas du kartus", note: "Tas pats žirgas ir tas pats laikas", critical: true },
  { key: "horse_unavailable_day_assignments", title: "Žirgai neleistinomis dienomis", note: "Prieštarauja žirgų savaitės nustatymams", critical: true },
  { key: "invalid_subscription_balances", title: "Neteisingi abonementų likučiai", note: "Panaudota daugiau treniruočių nei suteikta", critical: true },
  { key: "cancelled_recurring_without_exception", title: "Atšaukti nuolatiniai be išimties", note: "Istoriniai įrašai; ne visi būtinai yra klaidos" },
  { key: "cancelled_and_active_same_rider_slot", title: "Atšaukta ir aktyvi tuo pačiu laiku", note: "Gali būti teisėtas atnaujinimas — reikia peržiūros" },
  { key: "pending_cancellation_requests", title: "Laukiantys atšaukimo prašymai", note: "Administracijos darbų sąrašas" },
];

export default function AdminBookingHealth() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("admin_booking_health_check");
    setBusy(false);
    if (error) { toast.error("Patikros klaida: " + error.message); return; }
    setReport(data as HealthReport);
  };
  useEffect(() => { void load(); }, []);
  const criticalIssues = report ? checks.filter(c => c.critical && Number(report[c.key]) > 0).length : 0;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-muted-foreground"><Activity className="h-4 w-4" /> Vidinė patikra</div>
          <h2 className="font-display text-2xl text-foreground">Rezervacijų būklė</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">Patikra tik skaito duomenis: nešalina pamokų ir nekeičia abonementų ar žirgų priskyrimų.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />{busy ? "Tikrinama…" : "Patikrinti"}</Button>
      </div>
      {!report ? <div className="rounded-xl border border-border/60 p-6 text-sm text-muted-foreground">{busy ? "Tikrinama rezervacijų būklė…" : "Patikra dar neatlikta."}</div> : (
        <>
          <div className="rounded-xl border border-border/60 bg-background/50 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {criticalIssues ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-gold" />}
              {criticalIssues ? `${criticalIssues} svarbūs rodikliai reikalauja dėmesio` : "Svarbiausi rezervacijų vientisumo rodikliai tvarkingi"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Laikotarpis: {report.period_start} – {report.period_end}. Tikrinta: {new Date(report.checked_at).toLocaleString("lt-LT")}.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {checks.map(c => {
              const count = Number(report[c.key]) || 0;
              return <article key={c.key} className="rounded-xl border border-border/60 bg-background/40 p-4">
                <div className="flex items-start justify-between gap-4"><h3 className="text-sm font-semibold text-foreground">{c.title}</h3>{count === 0 ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : c.critical ? <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" /> : <Activity className="h-5 w-5 shrink-0 text-gold" />}</div>
                <div className="mt-3 text-3xl font-semibold tabular-nums text-foreground">{count}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{c.note}</p>
              </article>;
            })}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Pastaba: atšauktų ir aktyvių įrašų sutapimai nėra automatiškai klaidos. Niekada netrinkite istorinių rezervacijų vien pagal šiuos skaičius.</p>
        </>
      )}
    </section>
  );
}
