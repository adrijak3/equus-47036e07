import { ShieldCheck, Database, Clock, UserCheck, Baby, Cookie, Mail } from "lucide-react";

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

export default function PrivatumoPolitika() {
  return (
    <div className="container py-10 md:py-14 max-w-4xl space-y-8">
      <header className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">
          Privatumo politika
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
          Paskutinį kartą atnaujinta 2026-09-08. Ši politika paaiškina, kokius
          asmens duomenis renkame ir kaip juos naudojame.
        </p>
      </header>

      <Section icon={ShieldCheck} title="Duomenų valdytojas">
        <p>
          Jūsų asmens duomenis valdo <strong className="text-foreground">VšĮ Jojimo mokykla „Equus"</strong>,
          įmonės kodas 302754824, adresas Pakamšės g. 7, Daučionys, 14245 Vilniaus r. sav.
        </p>
        <p>
          Kontaktai duomenų apsaugos klausimais: telefonu{" "}
          <a href="tel:+37065822872" className="text-gold underline underline-offset-4">
            +370 658 22872
          </a>{" "}
          arba el. paštu{" "}
          <a href="mailto:jojimomokykla@gmail.com" className="text-gold underline underline-offset-4">
            jojimomokykla@gmail.com
          </a>.
        </p>
      </Section>

      <Section icon={Database} title="Kokius duomenis renkame">
        <p>Registruojantis treniruotei ar sukuriant paskyrą renkame:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>vardą, pavardę, telefono numerį, el. paštą;</li>
          <li>amžių (reikalingas užsiėmimo tipui parinkti);</li>
          <li>skubios pagalbos kontaktą;</li>
          <li>papildomą informaciją apie jojimo patirtį, jei ją pateikiate;</li>
          <li>Facebook vardą ir pavardę, jei nurodote (neprivaloma);</li>
          <li>
            jei paliekate atsiliepimą – įvertinimą, teksto turinį ir, jei
            pasirenkate, savo vardą.
          </li>
        </ul>
        <p>
          Prašome laukelyje „Papildomai apie jojimo patirtį" nenurodyti
          sveikatos duomenų (diagnozių, ligų ar panašios informacijos) –
          tokia informacija apie sveikatos būklę turi būti pranešama
          treneriui tiesiogiai, žodžiu, o ne per registracijos formą.
        </p>
      </Section>

      <Section icon={Baby} title="Nepilnamečiai dalyviai">
        <p>
          Kai treniruotėse dalyvauja nepilnametis, registracijos formą už jį
          pildo ir duomenų teisingumą patvirtina tėvas ar globėjas. Tėvas ar
          globėjas atsako už pateiktų duomenų tikslumą ir yra laikomas
          duomenų subjekto atstovu šios politikos tikslais.
        </p>
      </Section>

      <Section icon={UserCheck} title="Kodėl renkame duomenis ir kokiu pagrindu">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Sutarties vykdymui</strong> –
            kad galėtume priimti registraciją, suplanuoti treniruotę ir
            suteikti paslaugą.
          </li>
          <li>
            <strong className="text-foreground">Komunikacijai</strong> – kad
            galėtume patvirtinti registraciją, priminti apie treniruotę ar
            susisiekti dėl pakeitimų.
          </li>
          <li>
            <strong className="text-foreground">Teisėtam interesui</strong> –
            paslaugų kokybei užtikrinti ir saugumui treniruočių metu.
          </li>
          <li>
            <strong className="text-foreground">Sutikimui</strong> – kai
            paliekate viešą atsiliepimą su savo vardu.
          </li>
        </ul>
      </Section>

      <Section icon={Database} title="Kam perduodame duomenis">
        <p>Duomenis tvarkyti mums padeda šie paslaugų teikėjai (duomenų tvarkytojai):</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Supabase</strong> – naudojama
            kaip duomenų bazė ir paskyrų prisijungimo sistema;
          </li>
          <li>
            <strong className="text-foreground">EmailJS</strong> – naudojama
            registracijos patvirtinimo el. laiškams siųsti;
          </li>
          <li>
            <strong className="text-foreground">buhalterinės apskaitos paslaugų teikėjas</strong> –
            gauna duomenis, būtinus sąskaitoms už paslaugas parengti.
          </li>
        </ul>
        <p>
          Duomenų neparduodame ir neperduodame rinkodaros tikslais jokioms
          trečiosioms šalims.
        </p>
      </Section>

      <Section icon={Clock} title="Kiek laiko saugome duomenis">
        <p>
          Duomenis saugome tol, kol esate aktyvus klientas. Nutraukus
          bendradarbiavimą, jūsų duomenis ištriname jums paprašius, o jei
          prašymo negauname – saugome protingą laikotarpį, kiek tai būtina
          galimiems buhalteriniams ar teisiniams reikalavimams įvykdyti.
        </p>
      </Section>

      <Section icon={ShieldCheck} title="Jūsų teisės">
        <p>Turite teisę:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>sužinoti, kokius jūsų duomenis tvarkome;</li>
          <li>prašyti juos ištaisyti, jei jie neteisingi;</li>
          <li>prašyti juos ištrinti;</li>
          <li>apriboti ar nesutikti su duomenų tvarkymu;</li>
          <li>
            pateikti skundą Valstybinei duomenų apsaugos inspekcijai
            (vdai.lrv.lt), jei manote, kad jūsų teisės pažeidžiamos.
          </li>
        </ul>
        <p>
          Norėdami pasinaudoti šiomis teisėmis, susisiekite aukščiau
          nurodytais kontaktais.
        </p>
      </Section>

      <Section icon={Cookie} title="Slapukai">
        <p>
          Informacija apie svetainėje naudojamą techninę atmintį pateikta{" "}
          <a href="/slapuku-politika" className="text-gold underline underline-offset-4">
            Slapukų politikoje
          </a>.
        </p>
      </Section>

      <Section icon={Mail} title="Politikos pakeitimai">
        <p>
          Ši politika gali būti atnaujinama. Reikšmingų pakeitimų atveju apie
          tai informuosime svetainėje.
        </p>
      </Section>
    </div>
  );
}
