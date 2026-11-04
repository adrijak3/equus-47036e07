import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, CalendarCheck2, CalendarX2, CircleHelp,
  CreditCard, HeartHandshake, Horse, MessageSquare, ShieldAlert,
  UserRoundPlus, Wallet, Clock3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type GuideItem = {
  id: string;
  title: string;
  icon: LucideIcon;
  where: string;
  href: string;
  action: string;
  steps: string[];
  note?: string;
};

const TASKS: GuideItem[] = [
  {
    id: "book", title: "Užregistruoti raitelį", icon: UserRoundPlus,
    where: "Grafikas → diena → laikas → Pridėti vartotoją", href: "/grafikas",
    action: "Atidaryti grafiką",
    steps: [
      "Atidarykite reikiamą dieną ir treniruotės laiką.",
      "Pasirinkite „Pridėti vartotoją“, suraskite klientą ir patvirtinkite.",
      "Patikrinkite, ar raitelis tikrai matomas pasirinktame laike.",
    ],
    note: "Jei reikiamo laiko nėra, administratorius gali jį pridėti grafike per „Naujas laikas“. Prieš tai įsitikinkite, kad tai tikrai suderinta treniruotė.",
  },
  {
    id: "cancel", title: "Atšaukti rezervaciją", icon: CalendarX2,
    where: "Grafikas → raitelio vardas → Atšaukti", href: "/grafikas",
    action: "Atidaryti grafiką",
    steps: [
      "Grafike raskite tinkamą dieną, laiką ir raitelį.",
      "Paspauskite raitelio įrašą, pasirinkite „Atšaukti“ ir patvirtinkite.",
      "Atnaujintame grafike patikrinkite, kad raitelio prie to laiko nebėra.",
    ],
    note: "Jeigu klientas jau pateikė atšaukimo prašymą, jį reikia tvarkyti per „Atšaukimai“ (žemiau), ne aklai trinti kitą registraciją.",
  },
  {
    id: "cancellations", title: "Patvirtinti atšaukimo prašymą", icon: CalendarCheck2,
    where: "Žirgyno valdymas → Treniruotės → Atšaukimai", href: "/admin?section=cancels",
    action: "Atidaryti atšaukimus",
    steps: [
      "Atidarykite laukiančius atšaukimo prašymus.",
      "Patikrinkite datą, raitelį, priežastį ir, jei reikia, pateiktą pažymą.",
      "Nuspręskite, ar pamoka turi būti įskaityta į abonementą, ir patvirtinkite arba atmeskite prašymą.",
    ],
    note: "Sergant ar prašant išimties, nespauskite patvirtinimo neįsitikinę, kuri apskaitos taisyklė turi būti taikoma.",
  },
  {
    id: "move", title: "Perkelti raitelį", icon: Clock3,
    where: "Grafikas → raitelio vardas → Perkelti", href: "/grafikas",
    action: "Atidaryti grafiką",
    steps: [
      "Paspauskite raitelio rezervaciją ir pasirinkite „Perkelti“.",
      "Nurodykite naują datą ir laiką. Galite tiesiog įvesti 1730 — sistema įrašys 17:30.",
      "Patvirtinkite ir patikrinkite abi vietas: naujame laike raitelis turi atsirasti, sename — dingti.",
    ],
    note: "Jeigu sistema rodo, kad vieta pilna arba žirgas užimtas, pirma išspręskite konfliktą. Nepridėkite antros rezervacijos vietoj perkėlimo.",
  },
  {
    id: "horse", title: "Paskirti, pakeisti arba pašalinti žirgą", icon: Horse,
    where: "Grafikas → raitelio vardas → Pakeisti žirgą", href: "/grafikas",
    action: "Atidaryti grafiką",
    steps: [
      "Pasirinkite raitelį ir atidarykite „Pakeisti žirgą“.",
      "Pasirinkite galimą žirgą ir spauskite „Išsaugoti“.",
      "Norėdami tik nuimti žirgą, naudokite „Pašalinti žirgą“. Tai neatšaukia pamokos.",
    ],
    note: "Jeigu žirgas tame pačiame laike jau užimtas arba pasiekė dienos limitą, jo pasirinkti negalima.",
  },
  {
    id: "payments", title: "Patvirtinti abonemento įsigijimą", icon: CreditCard,
    where: "Žirgyno valdymas → Žmonės → QR užklausos", href: "/admin?section=qrRequests",
    action: "Atidaryti QR užklausas",
    steps: [
      "Suraskite kliento abonemento įsigijimo / mokėjimo prašymą.",
      "Palyginkite klientą, pamokų kiekį, kainą ir mokėjimo būdą.",
      "Bankinį pavedimą pirmiausia patikrinkite banke; mokant grynaisiais — tik gavę pinigus — spauskite mokėjimo patvirtinimą.",
      "Įsitikinkite, kad užklausa pažymėta patvirtinta ir abonementas sukurtas.",
    ],
    note: "Nežymėkite „Apmokėta“ vien pagal kliento žinutę ar ekrano nuotrauką. Jei abonementas laukia ankstesnio pabaigos, nebandykite rankiniu būdu pakeisti jo pradžios be susitarimo.",
  },
  {
    id: "subscription", title: "Patikrinti ar aktyvus abonementas", icon: Wallet,
    where: "Žirgyno valdymas → Žmonės → Abonimentai", href: "/admin?section=subs",
    action: "Atidaryti abonimentus",
    steps: [
      "Suraskite raitelį paieškoje.",
      "Peržiūrėkite, ar abonementas apmokėtas, kiek pamokų likę ir jo galiojimą.",
      "Jei turite patvirtintą informaciją apie įmoką, galite naudoti abonemento apmokėjimo žymėjimą.",
    ],
    note: "Netrinkite ir nekeiskite jau naudoto abonemento, jei nesate tikri — tai gali paveikti treniruočių apskaitą.",
  },
  {
    id: "permanent", title: "Nuolatiniai laikai ir laukiamieji", icon: CalendarCheck2,
    where: "Žirgyno valdymas → Treniruotės → Nuolatiniai", href: "/admin?section=permanent",
    action: "Atidaryti nuolatinius",
    steps: [
      "Patikrinkite raiteliui priskirtą savaitės dieną ir laiką.",
      "Prieš keičiant nuolatinį laiką patikrinkite, ar jis nesikerta su kitų raitelių rezervacijomis.",
      "Po pakeitimo patikrinkite grafiką ir ar naujoje vietoje raitelis matomas.",
    ],
    note: "Nuolatinio laiko pakeitimas gali paveikti ateities savaites. Jei reikia tik vienos pamokos, tvarkykite tą konkrečią rezervaciją Grafike.",
  },
  {
    id: "messages", title: "Atsakyti klientams", icon: MessageSquare,
    where: "Žirgyno valdymas → Daugiau → Žinutės", href: "/admin?section=messages",
    action: "Atidaryti žinutes",
    steps: [
      "Peržiūrėkite neatsakytas žinutes ir patikrinkite raitelio paskyrą.",
      "Atsakykite aiškiai, ypač jei klausimas susijęs su atšaukimu, apmokėjimu ar vietų skaičiumi.",
      "Jei problema techniška ar neaiški, nesiimkite rizikingų pakeitimų duomenų bazėje.",
    ],
  },
  {
    id: "clients", title: "Rasti kliento informaciją", icon: HeartHandshake,
    where: "Žirgyno valdymas → Žmonės → Klientai", href: "/admin?section=users",
    action: "Atidaryti klientus",
    steps: [
      "Suraskite klientą pagal vardą.",
      "Peržiūrėkite jo treniruočių, abonemento ir paskyros informaciją.",
      "Kliento asmens duomenis naudokite tik tiek, kiek būtina jo klausimui išspręsti.",
    ],
  },
];

const DAILY_CHECKS = [
  "Patikrinti šiandienos ir rytdienos Grafiką.",
  "Peržiūrėti Atšaukimus ir naujus klientų prašymus.",
  "Patikrinti QR mokėjimo užklausas (patvirtinti tik realius mokėjimus).",
  "Perskaityti naujas Žinutes.",
  "Jeigu kas nors keista — patikrinti Rezervacijų būklę, o ne bandyti taisyti atsitiktinai.",
];

export function AdminCheatSheet() {
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<string[]>(["book"]);
  const shown = TASKS.filter((task) =>
    [task.title, task.where, ...task.steps, task.note ?? ""]
      .join(" ").toLocaleLowerCase("lt")
      .includes(search.trim().toLocaleLowerCase("lt")),
  );
  const toggle = (id: string) =>
    setOpened((old) => old.includes(id) ? old.filter((v) => v !== id) : [...old, id]);

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-gold/25 bg-gradient-card p-5">
        <div className="flex items-center gap-2 text-gold">
          <BookOpen className="h-5 w-5" />
          <span className="text-sm font-semibold">Greita pagalba pavaduojančiam administratoriui</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Viskas svarbiausia vienoje vietoje: ką spausti, kur ieškoti ir ką patikrinti prieš patvirtinant.
          Išsirinkite veiksmą, peržiūrėkite žingsnius ir atsidarykite reikiamą skiltį.
        </p>
      </header>

      <section className="rounded-2xl border border-border/70 p-4">
        <h3 className="font-semibold">Kasdienė 5 minučių patikra</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {DAILY_CHECKS.map((item) => <li key={item} className="flex items-start gap-2"><span className="text-gold">✓</span><span>{item}</span></li>)}
        </ul>
      </section>

      <div>
        <label htmlFor="admin-cheatsheet-search" className="mb-2 block text-sm font-medium">Ko ieškote?</label>
        <input id="admin-cheatsheet-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Pvz.: žirgas, atšaukimas, abonementas"
          className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-gold/60" />
      </div>

      <div className="space-y-3">
        {shown.map((task) => {
          const Icon = task.icon;
          const open = opened.includes(task.id) || !!search.trim();
          return (
            <section key={task.id} className="overflow-hidden rounded-xl border border-border/75 bg-background/40">
              <button type="button" onClick={() => toggle(task.id)} aria-expanded={open}
                className="flex min-h-14 w-full items-center gap-3 p-4 text-left hover:bg-gold/5">
                <Icon className="h-5 w-5 shrink-0 text-gold" />
                <span className="flex-1 text-sm font-semibold">{task.title}</span>
                <span className="text-lg text-muted-foreground">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="space-y-3 border-t border-border/70 px-4 pb-4 pt-3">
                  <p className="text-xs text-muted-foreground"><strong className="text-foreground">Kur rasti:</strong> {task.where}</p>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6">
                    {task.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  {task.note && <p className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs leading-5 text-muted-foreground">{task.note}</p>}
                  <Link to={task.href} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gold/30 px-3 text-sm font-medium text-gold hover:bg-gold/10">
                    {task.action}<ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </section>
          );
        })}
        {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nieko nerasta. Pabandykite kitą žodį.</p>}
      </div>

      <div className="rounded-xl border border-border/70 p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4 text-gold" /> Jei nesate tikri</div>
        <p className="mt-2 leading-6 text-muted-foreground">Nekeiskite klientų teisių, nešalinkite abonementų ir nedarykite kelių rezervacijų bandydami ištaisyti vieną klaidą. Pirmiausia patikrinkite įrašą ir susisiekite su atsakingu žmogumi.</p>
        <Link to="/admin?section=health" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-gold underline underline-offset-4">
          <CircleHelp className="h-4 w-4" /> Patikrinti rezervacijų būklę
        </Link>
      </div>
    </div>
  );
}
