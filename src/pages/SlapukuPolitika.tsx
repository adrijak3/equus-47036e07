import { Cookie, CheckCircle2, Settings2, ShieldCheck } from "lucide-react";

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-gold/20 bg-gradient-card shadow-elegant overflow-hidden">
    <div className="px-6 py-5 border-b border-gold/10 flex items-start gap-3">
      <Icon className="w-5 h-5 text-gold mt-0.5 shrink-0" />
      <h2 className="text-xl font-display text-gold">{title}</h2>
    </div>
    <div className="px-6 py-5 space-y-3 text-sm md:text-base leading-relaxed text-foreground/90">{children}</div>
  </section>;
}

export default function SlapukuPolitika() {
  return <div className="container py-10 md:py-14 max-w-4xl space-y-8">
    <header className="text-center space-y-3">
      <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">Slapukų politika</h1>
      <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">Paskutinį kartą atnaujinta 2026-11-03. Slapukai, vietinė saugykla ir kitos naršyklės technologijos.</p>
    </header>

    <Section icon={Cookie} title="Kokias technologijas naudojame">
      <p>Svetainė naudoja naršyklės saugyklą ir gali naudoti techninius slapukus, kad veiktų prisijungimas ir pasirinktos funkcijos. Pagal šiuo metu įdiegtą Equus svetainės kodą <strong>nenaudojame Google Analytics ar Meta Pixel rinkodaros sekimo</strong>.</p>
      <p><strong>localStorage</strong> ir panaši saugykla nėra tradicinis slapukas, tačiau prieigai prie įrenginio informacijos taikytinos slapukams analogiškos taisyklės.</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Prisijungimo sesija:</strong> Supabase autentifikavimo duomenys, reikalingi išlaikyti prisijungimą ir valdyti paskyrą.</li>
        <li><strong>Sąsajos nustatymai:</strong> tema, šviesus / tamsus režimas, kalba ir vizualiniai efektai, kad svetainė prisimintų jūsų pasirinkimą.</li>
        <li><strong>Pasirinktas profilis:</strong> susietos šeimos paskyros / aktyvaus profilio pasirinkimas.</li>
        <li><strong>Naudojimo patogumas:</strong> įvadinių ekranų peržiūros būsena, programėlės diegimo pranešimo ir pagalbos sąsajos nustatymai.</li>
        <li><strong>Veikimo diagnostika:</strong> kai kurie vietiniai klaidų pranešimų ar sąsajos būsenos įrašai.</li>
      </ul>
      <p>Techninių įrašų pavadinimai ir saugojimo trukmė priklauso nuo funkcijos ir naudojamos naršyklės. Prisijungimo duomenys gali išlikti iki atsijungimo, sesijos galiojimo pabaigos arba naršyklės saugyklos išvalymo; kai kurie pasirinkimai išlieka, kol juos pakeičiate ar ištrinate.</p>
    </Section>

    <Section icon={CheckCircle2} title="Būtini ir pasirenkami duomenys">
      <p>Prisijungimo ir saugumo informacija gali būti būtina jūsų prašomai paskyros paslaugai suteikti. Kalbos, temos ir vaizdo efektų įsiminimas skirtas jūsų pasirinktam patogumui. Ne kiekviena tokia nuostata automatiškai laikoma techniškai būtina.</p>
      <p>Jeigu ateityje bus įdiegta nebūtinų analitikos, reklamos ar kitų sekimo priemonių, joms, kai reikalaujama teisės aktų, bus prašoma išankstinio sutikimo, kurį bus galima atšaukti. Šis aprašymas pats savaime nėra sutikimo valdymo priemonė.</p>
    </Section>

    <Section icon={ShieldCheck} title="Trečiųjų šalių paslaugos">
      <p>Supabase naudojama autentifikavimui ir programos duomenims; Cloudflare pateikia svetainę. Šie paslaugų teikėjai gali tvarkyti techninius užklausų duomenis pagal savo funkcijas ir taikomas privatumo sąlygas.</p>
      <p>Atvėrus išorines nuorodas, pavyzdžiui, į „LiveJumping“ varžybų programą, taikoma atitinkamos svetainės slapukų ir privatumo politika.</p>
    </Section>

    <Section icon={Settings2} title="Kaip valdyti duomenų saugojimą">
      <p>Galite pakeisti svetainės temą, kalbą ir vaizdo efektus meniu, atsijungti nuo paskyros arba naršyklės nustatymuose išvalyti Equus svetainės slapukus ir vietinę saugyklą. Išvalius saugyklą gali reikėti prisijungti iš naujo; kai kurie pasirinkimai bus atstatyti.</p>
      <p>Pranešimų leidimus galite valdyti naršyklės arba įrenginio nustatymuose. Daugiau informacijos apie asmens duomenų tvarkymą pateikiama <a href="/privatumo-politika" className="text-gold underline">Privatumo politikoje</a>.</p>
    </Section>
  </div>;
}
