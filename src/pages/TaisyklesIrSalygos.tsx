import { Building2, CalendarClock, Wallet, ShieldAlert, Scale, RotateCcw } from "lucide-react";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gold/20 bg-gradient-card shadow-elegant overflow-hidden">
      <div className="px-6 py-5 border-b border-gold/10 flex items-start gap-3">
        <Icon className="w-5 h-5 text-gold mt-0.5 shrink-0" />
        <h2 className="text-xl font-display text-gold">{title}</h2>
      </div>
      <div className="px-6 py-5 space-y-3 text-sm md:text-base leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  );
}

export default function TaisyklesIrSalygos() {
  return (
    <div className="container py-10 md:py-14 max-w-4xl space-y-8">
      <header className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">
          Paslaugų teikimo taisyklės ir sąlygos
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
          Paskutinį kartą atnaujinta 2026-09-08. Šios sąlygos taikomos visiems,
          kurie registruojasi į Equus jojimo treniruotes.
        </p>
      </header>

      <Section icon={Building2} title="Paslaugų teikėjas">
        <p>
          Paslaugas teikia <strong className="text-foreground">VšĮ Jojimo mokykla „Equus"</strong>,
          įmonės kodas 302754824, adresas Pakamšės g. 7, Daučionys, 14245
          Vilniaus r. sav. Kontaktai: Laura,{" "}
          <a href="tel:+37065822872" className="text-gold underline underline-offset-4">
            +370 658 22872
          </a>
          ,{" "}
          <a href="mailto:jojimomokykla@gmail.com" className="text-gold underline underline-offset-4">
            jojimomokykla@gmail.com
          </a>.
        </p>
      </Section>

      <Section icon={CalendarClock} title="Registracija ir sutartis">
        <p>
          Registracija į treniruotę vykdoma per svetainės registracijos
          formą arba susitarimu (žodiniu arba elektroniniu būdu). Registracija tampa galutinė, kai administracija ją
          patvirtina. Prieš pirmąją treniruotę privaloma pasirašyti jojimo
          paslaugų sutartį – be pasirašytos sutarties treniruotė nevyks.
          Sutartį galite peržiūrėti{" "}
          <a href="/informacija" className="text-gold underline underline-offset-4">
            Informacijos puslapyje
          </a>.
        </p>
      </Section>

      <Section icon={Wallet} title="Kainos ir apmokėjimas">
        <p>Aktualios kainos skelbiamos skiltyje „Kainos". Atsiskaityti galima:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">grynaisiais</strong> (pageidaujamas būdas), arba
          </li>
          <li>
            <strong className="text-foreground">banko pavedimu</strong> pagal
            sąskaitą, kurią parengia buhalterija ir atsiunčia paštu (el. paštu).
          </li>
        </ul>
        <p>Kortelės ar kitų internetinių mokėjimų svetainėje nepriimame.</p>
      </Section>

      <Section icon={RotateCcw} title="Atšaukimo ir grąžinimo sąlygos">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            Treniruotę galima atšaukti nemokamai, jei apie tai pranešama ne
            vėliau kaip <strong className="text-foreground">24 valandos</strong> prieš
            jos pradžią.
          </li>
          <li>
            Vėliau nei prieš 24 val. atšaukta arba be pranešimo praleista
            treniruotė laikoma panaudota ir nekompensuojama, <strong className="text-foreground">
            išskyrus ligos ar force majeure atvejus</strong>, kuriuos aptariame
            individualiai.
          </li>
          <li>
            Abonementas galioja <strong className="text-foreground">30 dienų nuo jo įsigijimo
            datos</strong>. Per šį laikotarpį nepanaudotos treniruotės po
            galiojimo pabaigos negrąžinamos ir nekompensuojamos, išskyrus
            ligos ar force majeure atvejus.
          </li>
        </ul>
      </Section>

      <Section icon={ShieldAlert} title="Atsakomybė ir saugumas">
        <p>
          Jojimas yra fizinio aktyvumo veikla, susijusi su tam tikra rizika.
          Dalyviai privalo laikytis trenerio nurodymų, žirgyno taisyklių ir
          dėvėti tinkamą aprangą bei avalynę. Už nepilnamečius dalyvius
          atsako juos registravęs tėvas ar globėjas. Apie sveikatos būklę ar
          kitą svarbią informaciją, galinčią turėti įtakos saugumui,
          prašome pranešti treneriui iš anksto, žodžiu.
        </p>
      </Section>

      <Section icon={Scale} title="Ginčų sprendimas">
        <p>
          Kilus nesutarimams, pirmiausia kreipkitės į mus tiesiogiai
          aukščiau nurodytais kontaktais – stengsimės klausimą išspręsti
          geranoriškai. Jei susitarti nepavyksta, ginčai sprendžiami Lietuvos
          Respublikos teisės aktų nustatyta tvarka, įskaitant galimybę
          kreiptis į Valstybinę vartotojų teisių apsaugos tarnybą arba teismą.
        </p>
      </Section>

      <Section icon={Building2} title="Sąlygų pakeitimai">
        <p>
          Pasiliekame teisę atnaujinti šias taisykles. Aktuali versija visada
          skelbiama šiame puslapyje.
        </p>
      </Section>
    </div>
  );
}
