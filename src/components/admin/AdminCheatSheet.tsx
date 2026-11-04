import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BookOpen, CalendarCheck2, CalendarX2, CircleHelp,
  CreditCard, HeartHandshake, PawPrint, MessageSquare, ShieldAlert,
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
    id: "book", title: "Užregistruoti žmogų", icon: UserRoundPlus,
    where: "Grafikas → diena → laikas → Pridėti vartotoją", href: "/grafikas",
    action: "Eiti į grafiką",
    steps: [
      "Pasirink dieną ir treniruotės laiką.",
      "Spausk „Pridėti vartotoją“ ir pasirink žmogų.",
      "Pažiūrėk, ar jo vardas atsirado grafike.",
    ],
    note: "Jei tokio laiko nėra, pirmiausia pasitikrink, ar tikrai reikia kurti naują.",
  },
  {
    id: "cancel", title: "Atšaukti pamoką", icon: CalendarX2,
    where: "Grafikas → žmogaus vardas → Atšaukti", href: "/grafikas",
    action: "Eiti į grafiką",
    steps: [
      "Rask žmogų grafike ir paspausk jo vardą.",
      "Spausk „Atšaukti“ ir patvirtink.",
      "Patikrink, ar žmogaus tame laike nebeliko.",
    ],
    note: "Jei žmogus pateikė atšaukimo prašymą, eik į „Atšaukimai“.",
  },
  {
    id: "cancellations", title: "Atsakyti į atšaukimo prašymą", icon: CalendarCheck2,
    where: "Žirgyno valdymas → Treniruotės → Atšaukimai", href: "/admin?section=cancels",
    action: "Eiti į atšaukimus",
    steps: [
      "Atsidaryk prašymą ir pažiūrėk, kas bei kurią pamoką atšaukia.",
      "Perskaityk priežastį ir, jei reikia, pažymą.",
      "Pasirink, ar pamoka skaičiuojama į abonementą, ir patvirtink arba atmesk.",
    ],
    note: "Jei nežinai, ar reikia nuskaičiuoti pamoką, geriau pirmiau pasiklausk.",
  },
  {
    id: "move", title: "Perkelti žmogų", icon: Clock3,
    where: "Grafikas → žmogaus vardas → Perkelti", href: "/grafikas",
    action: "Eiti į grafiką",
    steps: [
      "Paspausk žmogaus vardą ir rinkis „Perkelti“.",
      "Įvesk naują datą ir laiką. Rašant 1730 gausi 17:30.",
      "Patvirtink. Žmogus turi atsirasti naujame laike ir dingti iš seno.",
    ],
    note: "Jei rodo klaidą, nekurk antros rezervacijos. Pirma išsiaiškink, kas nepavyko.",
  },
  {
    id: "horse", title: "Pakeisti arba nuimti žirgą", icon: PawPrint,
    where: "Grafikas → žmogaus vardas → Pakeisti žirgą", href: "/grafikas",
    action: "Eiti į grafiką",
    steps: [
      "Paspausk žmogaus vardą ir „Pakeisti žirgą“.",
      "Pasirink žirgą ir spausk „Išsaugoti“.",
      "Jei nori tik nuimti žirgą, spausk „Pašalinti žirgą“.",
    ],
    note: "Nuėmus žirgą, pamoka lieka. To paties žirgo tuo pačiu laiku dviem žmonėms skirti negalima.",
  },
  {
    id: "payments", title: "Patvirtinti abonemento pirkimą", icon: CreditCard,
    where: "Žirgyno valdymas → Žmonės → QR užklausos", href: "/admin?section=qrRequests",
    action: "Eiti į QR užklausas",
    steps: [
      "Rask žmogaus prašymą pirkti abonementą.",
      "Patikrink vardą, sumą ir pamokų skaičių.",
      "Jei pavedimas — patikrink banke. Jei grynais — įsitikink, kad pinigus gavai.",
      "Tik tada patvirtink mokėjimą.",
    ],
    note: "Nespausk „Patvirtinti“ vien todėl, kad žmogus parašė „sumokėjau“.",
  },
  {
    id: "subscription", title: "Patikrinti abonementą", icon: Wallet,
    where: "Žirgyno valdymas → Žmonės → Abonimentai", href: "/admin?section=subs",
    action: "Eiti į abonimentus",
    steps: [
      "Susirask žmogų.",
      "Pažiūrėk, ar abonementas apmokėtas, kiek pamokų liko ir iki kada galioja.",
      "Jei mokėjimas tikrai gautas, gali pažymėti abonementą apmokėtu.",
    ],
    note: "Jei abonementas laukia ankstesnio pabaigos, nekeisk jo pradžios datos vien tam, kad dingtų užrašas.",
  },
  {
    id: "permanent", title: "Nuolatiniai laikai", icon: CalendarCheck2,
    where: "Žirgyno valdymas → Treniruotės → Nuolatiniai", href: "/admin?section=permanent",
    action: "Eiti į nuolatinius",
    steps: [
      "Rask žmogaus nuolatinę dieną ir laiką.",
      "Jei reikia pakeisti, patikrink, ar kitame laike yra vietos.",
      "Po pakeitimo pažiūrėk, ar grafike viskas gerai.",
    ],
    note: "Nuolatinis laikas kartojasi kas savaitę. Jei keiti tik vieną pamoką, daryk tai Grafike.",
  },
  {
    id: "messages", title: "Atsakyti į žinutes", icon: MessageSquare,
    where: "Žirgyno valdymas → Daugiau → Žinutės", href: "/admin?section=messages",
    action: "Eiti į žinutes",
    steps: [
      "Pažiūrėk naujas žinutes.",
      "Jei reikia, pasitikrink žmogaus rezervaciją ar abonementą.",
      "Atsakyk trumpai ir aiškiai.",
    ],
  },
  {
    id: "clients", title: "Surasti žmogų", icon: HeartHandshake,
    where: "Žirgyno valdymas → Žmonės → Klientai", href: "/admin?section=users",
    action: "Eiti į klientus",
    steps: [
      "Įvesk žmogaus vardą paieškoje.",
      "Atsidaryk jo informaciją.",
      "Ten gali pasitikrinti jo rezervacijas ir abonementą.",
    ],
    note: "Kitų žmonių asmeninės informacijos niekam neperduok.",
  },
];

const QUICK_ACTIONS = [
  { id: "book", title: "Registruoti", subtitle: "Pridėti žmogų", icon: UserRoundPlus },
  { id: "cancel", title: "Atšaukti", subtitle: "Nuimti pamoką", icon: CalendarX2 },
  { id: "move", title: "Perkelti", subtitle: "Pakeisti laiką", icon: Clock3 },
  { id: "payments", title: "Abonementai", subtitle: "Patvirtinti mokėjimą", icon: CreditCard },
];

const DAILY_CHECKS = [
  "Patikrink šiandienos grafiką.",
  "Pažiūrėk, ar yra atšaukimo prašymų.",
  "Patikrink QR mokėjimų užklausas.",
  "Perskaityk naujas žinutes.",
];

export function AdminCheatSheet() {
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<string[]>(["book"]);
  const shown = TASKS.filter((task) =>
    [task.title, task.where, ...task.steps, task.note ?? ""]
      .join(" ").toLocaleLowerCase("lt")
      .includes(search.trim().toLocaleLowerCase("lt")),
  );

  const openTask = (id: string) => {
    setSearch("");
    setOpened([id]);
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggle = (id: string) =>
    setOpened((old) => old.includes(id) ? old.filter((v) => v !== id) : [...old, id]);

  return (
    <div className="min-w-0 space-y-5">
      <header className="rounded-2xl border border-gold/25 bg-gradient-card p-4 sm:p-5">
        <div className="flex items-center gap-2 text-gold">
          <BookOpen className="h-5 w-5 shrink-0" />
          <span className="text-sm font-semibold">Administratoriaus atmintinė</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Nežinai, kur ką spausti? Pasirink veiksmą ir viską rasi čia :)
        </p>
      </header>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Ką nori padaryti?</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {QUICK_ACTIONS.map(({ id, title, subtitle, icon: Icon }) => (
            <button key={id} type="button" onClick={() => openTask(id)}
              className="flex min-w-0 flex-col items-start gap-2 rounded-2xl border border-gold/25 bg-gradient-card p-3 text-left transition-colors hover:border-gold/60 hover:bg-gold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">
                <Icon className="h-5 w-5" />
              </span>
              <span className="w-full text-sm font-semibold leading-tight">{title}</span>
              <span className="w-full text-xs leading-4 text-muted-foreground">{subtitle}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border/70 p-4">
        <h3 className="font-semibold">Kasdien greitai patikrink</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {DAILY_CHECKS.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-gold">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <div>
        <label htmlFor="admin-cheatsheet-search" className="mb-2 block text-sm font-medium">Ieškai ko nors kito?</label>
        <input id="admin-cheatsheet-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Pvz.: žirgas, atšaukimas, abonementas"
          className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-gold/60" />
      </div>

      <div className="space-y-3">
        {shown.map((task) => {
          const Icon = task.icon;
          const open = opened.includes(task.id) || !!search.trim();
          return (
            <section id={`guide-${task.id}`} key={task.id}
              className="scroll-mt-5 min-w-0 overflow-hidden rounded-xl border border-border/75 bg-background/40">
              <button type="button" onClick={() => toggle(task.id)} aria-expanded={open}
                className="flex min-h-14 w-full min-w-0 items-center gap-3 p-4 text-left hover:bg-gold/5">
                <Icon className="h-5 w-5 shrink-0 text-gold" />
                <span className="min-w-0 flex-1 text-sm font-semibold leading-5">{task.title}</span>
                <span className="shrink-0 text-lg text-muted-foreground">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="min-w-0 space-y-3 border-t border-border/70 px-4 pb-4 pt-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    <strong className="text-foreground">Kur spausti:</strong> {task.where}
                  </p>
                  <p className="text-sm font-semibold">Ką daryti:</p>
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6">
                    {task.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  {task.note && (
                    <p className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs leading-5 text-muted-foreground">
                      <strong className="text-foreground">Svarbu:</strong> {task.note}
                    </p>
                  )}
                  <Link to={task.href}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gold/30 px-3 text-sm font-medium text-gold hover:bg-gold/10">
                    {task.action}<ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </section>
          );
        })}
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nieko neradau. Pabandyk kitą žodį :)</p>
        )}
      </div>

      <div className="rounded-xl border border-border/70 p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4 text-gold" /> Jei kažkas neveikia
        </div>
        <p className="mt-2 leading-6 text-muted-foreground">
          Nedaryk to paties kelis kartus ir netrink nieko bandydamas sutaisyti. Geriau patikrink, kas įvyko, ir pasiklausk.
        </p>
        <Link to="/admin?section=health"
          className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-gold underline underline-offset-4">
          <CircleHelp className="h-4 w-4" /> Patikrinti rezervacijų būklę
        </Link>
      </div>
    </div>
  );
}
