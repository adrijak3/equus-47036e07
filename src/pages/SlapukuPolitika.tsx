import { Cookie, CheckCircle2, Settings2 } from "lucide-react";

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

export default function SlapukuPolitika() {
  return (
    <div className="container py-10 md:py-14 max-w-4xl space-y-8">
      <header className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">
          Slapukų politika
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
          Paskutinį kartą atnaujinta 2026-09-08.
        </p>
      </header>

      <Section icon={Cookie} title="Ką naudojame">
        <p>
          Ši svetainė <strong className="text-foreground">nenaudoja jokių
          stebėjimo, analitikos ar rinkodaros slapukų</strong>. Nėra nei
          Google Analytics, nei Meta/Facebook Pixel, nei kitų panašių įrankių.
        </p>
        <p>
          Naršyklės atmintyje (localStorage) laikome tik techninę
          informaciją, būtiną svetainės veikimui:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>pasirinktą svetainės temą (spalvas, šviesumą);</li>
          <li>prisijungimo sesijos informaciją (kad nereikėtų prisijungti pakartotinai);</li>
          <li>pažangą supažindinimo (onboarding) ekranuose.</li>
        </ul>
      </Section>

      <Section icon={CheckCircle2} title="Kodėl sutikimo nereikia">
        <p>
          Šie duomenys yra būtini, kad svetainė tinkamai veiktų, ir nėra
          naudojami jūsų sekimui internete ar rinkodarai, todėl pagal
          ePrivacy/GDPR reikalavimus atskiro sutikimo dėl jų nereikalaujama.
        </p>
      </Section>

      <Section icon={Settings2} title="Kaip valdyti">
        <p>
          Bet kada galite išvalyti naršyklės saugomus duomenis per naršyklės
          nustatymus – tai atstatys temos pasirinkimą ir atjungs jūsų
          sesiją, bet nepaveiks svetainės veikimo.
        </p>
        <p>
          Daugiau apie tai, kokius asmens duomenis renkame per registracijos
          formas, rasite{" "}
          <a href="/privatumo-politika" className="text-gold underline underline-offset-4">
            Privatumo politikoje
          </a>.
        </p>
      </Section>
    </div>
  );
}
