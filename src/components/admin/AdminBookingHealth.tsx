import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, SearchCheck, Info } from "lucide-react";
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

type Check = {
  key: keyof HealthReport;
  title: string;
  explanation: string;
  advice: string;
  category: "attention" | "review" | "task";
};

type SubscriptionIssue = { id: string; user_id: string; reason: string; purchase_date: string };

function SubscriptionLifecycleHealth() {
  const [issues, setIssues] = useState<SubscriptionIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const check = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("subscriptions")
      .select("id,user_id,lessons_total,lessons_used,purchase_date,start_from_date,expires_at,start_pending,paid,cancelled_at")
      .is("cancelled_at", null)
      .order("purchase_date", { ascending: false });
    setLoading(false);
    if (error) { toast.error("Nepavyko patikrinti abonementų."); return; }
    const flagged: SubscriptionIssue[] = [];
    for (const s of data ?? []) {
      const reasons: string[] = [];
      if (Number(s.lessons_used) < 0 || Number(s.lessons_used) > Number(s.lessons_total)) reasons.push("Neteisingas panaudotų pamokų skaičius");
      if (s.start_pending && (s.start_from_date || s.expires_at)) reasons.push("Laukiantis abonementas jau turi galiojimo datas");
      if (s.paid && !s.start_pending && !s.start_from_date) reasons.push("Trūksta pradžios datos");
      if (s.paid && !s.start_pending && s.start_from_date && s.expires_at) {
        const expected = new Date(s.start_from_date + "T12:00:00");
        expected.setDate(expected.getDate() + 30);
        if (expected.toISOString().slice(0, 10) !== s.expires_at) reasons.push("Galiojimo data neatitinka 30 dienų");
      }
      if (reasons.length) flagged.push({ id: s.id, user_id: s.user_id, purchase_date: s.purchase_date, reason: reasons.join(" · ") });
    }
    setIssues(flagged);
    setChecked(true);
  };
  useEffect(() => { void check(); }, []);
  return <section className="rounded-xl border border-border/70 bg-background/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">Abonementų būklės patikra</h3><p className="mt-1 text-xs text-muted-foreground">Tikrinamos datos ir pamokų likučiai. Jokie duomenys nekeičiami.</p></div>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => void check()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Patikrinti</Button>
    </div>
    {checked && <p className="mt-4 text-sm">{issues.length ? `Verta peržiūrėti: ${issues.length}` : "Akivaizdžių abonementų neatitikimų nerasta."}</p>}
    {issues.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm text-muted-foreground">Rodyti galimus neatitikimus</summary>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">{issues.map(item => <li key={item.id} className="rounded-lg border border-border/50 px-3 py-2 text-xs"><span className="font-medium">{item.purchase_date} · {item.user_id}</span><p className="mt-1 text-muted-foreground">{item.reason}</p></li>)}</ul>
    </details>}
  </section>;
}

const checks: Check[] = [
  {
    key: "duplicate_active_rider_slots",
    title: "Tas pats raitelis užrašytas į tą pačią pamoką kelis kartus",
    explanation: "Vienam raiteliui tuo pačiu metu yra daugiau nei viena galiojanti rezervacija.",
    advice: "Patikrinkite šias registracijas grafike, kad nebūtų užimtos papildomos vietos.",
    category: "attention",
  },
  {
    key: "slots_over_capacity",
    title: "Į pamoką užrašyta daugiau raitelių, nei yra vietų",
    explanation: "Bent vienoje pamokoje raitelių skaičius viršija administracijos nustatytą vietų skaičių.",
    advice: "Palyginkite grafiko registracijas su tai dienai nustatytu vietų limitu.",
    category: "attention",
  },
  {
    key: "active_bookings_without_active_slot",
    title: "Raitelis užrašytas į laiką, kurio grafike nebėra",
    explanation: "Rezervacija vis dar galioja, tačiau toks pamokos laikas nėra pažymėtas kaip aktyvus.",
    advice: "Patikrinkite, ar laikas buvo pakeistas arba pamoka perkelta.",
    category: "attention",
  },
  {
    key: "horse_double_assignments",
    title: "Tas pats žirgas priskirtas keliems raiteliams tuo pačiu metu",
    explanation: "Vienam žirgui tuo pačiu pamokos laiku yra keli paskyrimai.",
    advice: "Peržiūrėkite žirgų paskyrimus ir išspręskite laiko sutapimus.",
    category: "attention",
  },
  {
    key: "horse_unavailable_day_assignments",
    title: "Žirgas paskirtas dieną, kai jis neturėtų dirbti",
    explanation: "Žirgo paskyrimas nesutampa su jam nustatytomis savaitės dienomis.",
    advice: "Patikrinkite žirgo darbo dienas ir konkrečią treniruotę.",
    category: "attention",
  },
  {
    key: "invalid_subscription_balances",
    title: "Kai kurių abonementų treniruočių skaičius nesutampa",
    explanation: "Pavyzdžiui, abonemente nurodyta daugiau panaudotų treniruočių, nei jų buvo suteikta.",
    advice: "Patikrinkite abonemento istoriją prieš koreguodami likutį.",
    category: "attention",
  },
  {
    key: "cancelled_recurring_without_exception",
    title: "Kai kurios atšauktos nuolatinės pamokos gali vėl atsirasti",
    explanation: "Rasta atšauktų pamokų, kurių atšaukimas nėra atskirai pažymėtas nuolatiniame grafike. Tai gali būti ir seni, jau pakeisti įrašai.",
    advice: "Peržiūrėkite šių pamokų istoriją; netrinkite jų automatiškai.",
    category: "review",
  },
  {
    key: "cancelled_and_active_same_rider_slot",
    title: "Tam pačiam laikui yra ir atšaukta, ir galiojanti rezervacija",
    explanation: "Tai nebūtinai klaida: raitelis galėjo atšaukti pamoką ir vėliau užsirašyti iš naujo.",
    advice: "Tikrinti reikia tik tada, jei raitelis sako, kad pamoka neturėtų būti grafike.",
    category: "review",
  },
  {
    key: "pending_cancellation_requests",
    title: "Laukia raitelių atšaukimo prašymai",
    explanation: "Raiteliai pateikė prašymus, dėl kurių dar reikia administracijos sprendimo.",
    advice: "Atidarykite „Atšaukimai“ ir peržiūrėkite laukiančius prašymus.",
    category: "task",
  },
];

export default function AdminBookingHealth() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("admin_booking_health_check");
    setBusy(false);
    if (error) {
      toast.error("Nepavyko patikrinti rezervacijų. Pabandykite dar kartą.");
      return;
    }
    setReport(data as HealthReport);
  };
  useEffect(() => { void load(); }, []);

  const immediate = report ? checks.filter(c => c.category === "attention" && Number(report[c.key]) > 0) : [];
  const historical = report ? checks.filter(c => c.category === "review" && Number(report[c.key]) > 0) : [];
  const tasks = report ? checks.filter(c => c.category === "task" && Number(report[c.key]) > 0) : [];

  const renderCheck = (c: Check) => {
    const count = Number(report?.[c.key]) || 0;
    return (
      <article key={c.key} className="rounded-xl border border-border/70 bg-background/60 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold leading-6 text-foreground">{c.title}</h3>
            <p className="text-sm leading-6 text-muted-foreground">{c.explanation}</p>
          </div>
          <span className={`shrink-0 rounded-lg px-3 py-1 text-lg font-semibold tabular-nums ${count > 0 && c.category === "attention" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"}`}>
            {count}
          </span>
        </div>
        {count > 0 && <p className="mt-3 border-t border-border/60 pt-3 text-sm leading-6 text-foreground/85"><strong>Ką daryti:</strong> {c.advice}</p>}
        {count === 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Šios problemos neaptikta</p>}
      </article>
    );
  };

  return (
    <section className="space-y-6">
      <SubscriptionLifecycleHealth />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-display text-2xl text-foreground"><SearchCheck className="h-5 w-5 text-muted-foreground" /> Ar rezervacijos tvarkingos?</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Ši patikra parodo, ar grafike nėra galimų nesutapimų. Tai tik informacija – ji nieko neištrina ir nekeičia.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={busy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Tikrinama…" : "Patikrinti iš naujo"}
        </Button>
      </div>
      {!report ? (
        <div className="rounded-xl border border-border/70 p-6 text-sm text-muted-foreground">{busy ? "Tikrinamos rezervacijos…" : "Patikros rezultatų dar nėra."}</div>
      ) : (
        <>
          <div className="rounded-xl border border-border/70 bg-background/60 p-5">
            <div className="flex items-center gap-2 font-medium text-foreground">
              {immediate.length > 0 ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              {immediate.length > 0 ? "Yra dalykų, kuriuos verta patikrinti" : "Svarbių rezervacijų nesutapimų neaptikta"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Tikrintos pamokos nuo {report.period_start} iki {report.period_end}. Patikros laikas: {new Date(report.checked_at).toLocaleString("lt-LT")}.
            </p>
            <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Skaičiai rodo galimus sutapimus ar neatitikimus, o ne būtinai tikras klaidas. Kai kuriuos įrašus galima paaiškinti ankstesniais pakeitimais.</p>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground">Svarbu patikrinti</h3>
            <p className="text-sm text-muted-foreground">Šie neatitikimai gali paveikti realias treniruotes.</p>
            {immediate.length ? immediate.map(renderCheck) : <p className="rounded-xl border border-border/70 p-4 text-sm text-muted-foreground">Šiuo metu svarbių neatitikimų nerasta.</p>}
          </div>

          {(tasks.length > 0 || historical.length > 0) && <div className="space-y-4">
            {tasks.length > 0 && <div className="space-y-3"><h3 className="text-base font-semibold text-foreground">Reikia administracijos sprendimo</h3>{tasks.map(renderCheck)}</div>}
            {historical.length > 0 && <div className="space-y-3"><h3 className="text-base font-semibold text-foreground">Verta peržiūrėti, bet nebūtinai klaida</h3>{historical.map(renderCheck)}</div>}
          </div>}

          <details className="rounded-xl border border-border/70 bg-background/40 p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Rodyti visus patikros rezultatus, įskaitant tuos, kuriuose problemų nėra</summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {checks.filter(c => Number(report[c.key]) === 0).map(renderCheck)}
              {checks.every(c => Number(report[c.key]) > 0) && <p className="text-sm text-muted-foreground">Visi rodikliai jau pateikti aukščiau.</p>}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
