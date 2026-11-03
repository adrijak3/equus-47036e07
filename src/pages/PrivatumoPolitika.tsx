import { ShieldCheck, Database, Clock, UserCheck, Baby, Cookie, Mail, Trophy, Bell, Server } from "lucide-react";

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-gold/20 bg-gradient-card shadow-elegant overflow-hidden">
    <div className="px-6 py-5 border-b border-gold/10 flex items-start gap-3">
      <Icon className="w-5 h-5 text-gold mt-0.5 shrink-0" />
      <h2 className="text-xl font-display text-gold">{title}</h2>
    </div>
    <div className="px-6 py-5 space-y-3 text-sm md:text-base leading-relaxed text-foreground/90">{children}</div>
  </section>;
}

export default function PrivatumoPolitika() {
  return <div className="container py-10 md:py-14 max-w-4xl space-y-8">
    <header className="text-center space-y-3">
      <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">Privatumo politika</h1>
      <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
        Paskutinį kartą atnaujinta 2026-11-03. Čia paaiškiname, kaip Equus tvarko klientų, svetainės naudotojų ir varžybomis besidominčių asmenų duomenis.
      </p>
    </header>

    <Section icon={ShieldCheck} title="Duomenų valdytojas ir kontaktai">
      <p>Duomenų valdytojas – <strong>VšĮ Jojimo mokykla „Equus“</strong>, įmonės kodas 302754824, Pakamšės g. 7, Daučionys, 14245 Vilniaus r. sav.</p>
      <p>Dėl asmens duomenų kreipkitės telefonu <a className="text-gold underline" href="tel:+37065822872">+370 658 22872</a> arba el. paštu <a className="text-gold underline" href="mailto:jojimomokykla@gmail.com">jojimomokykla@gmail.com</a>.</p>
    </Section>

    <Section icon={Database} title="Kokius duomenis tvarkome">
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Registracija ir paskyra:</strong> vardas, pavardė, telefono numeris, el. paštas, prisijungimo identifikatorius, amžius, skubios pagalbos kontaktas, pasirinktos paslaugos bei laikas, neprivalomi jojimo patirties, pageidaujamo laiko ir „Facebook“ vardo duomenys.</li>
        <li><strong>Treniruočių administravimas:</strong> rezervacijos, nuolatiniai laikai, laukiančiųjų sąrašai, atšaukimai, perkėlimai, pasirinkti žirgai, lankomumas, QR patikros įrašai ir su treniruotėmis susiję pranešimai.</li>
        <li><strong>Abonementai ir apskaita:</strong> pasirinktų abonementų tipai, treniruočių likučiai, užklausos, įmokų būsenos ir apskaitai reikalinga informacija. Svetainėje banko kortelių duomenų nerenkame.</li>
        <li><strong>Ryšys su mumis:</strong> žinutės, registracijos statuso laiškai, atsiliepimai, klaidų pranešimai ir savanoriškai pateikta papildoma informacija.</li>
        <li><strong>Techniniai duomenys:</strong> prisijungimo sesijos, naršyklės ar įrenginio techninė informacija, pasirenkami pranešimų prenumeratos duomenys ir svetainės nustatymai.</li>
        <li><strong>Susietos paskyros:</strong> su šeimos nariais / globėjais susietų profilių ryšiai, reikalingi paskyroms tvarkyti.</li>
      </ul>
      <p>Registracijos laukuose neprašome nurodyti diagnozių ar kitos detalios sveikatos informacijos. Jei dėl ligos atšaukimo pateikiami dokumentai, juose gali būti sveikatos duomenų; jie tvarkomi tik tokio prašymo nagrinėjimui, taikant atitinkamas BDAR apsaugos sąlygas. Apie treniruotės saugumui svarbias aplinkybes iš anksto informuokite trenerį.</p>
    </Section>

    <Section icon={Trophy} title="Viešas sąrašas „Varžybos“">
      <p>Norint dalyvauti varžybų norinčiųjų sąraše, prisijungęs naudotojas savo iniciatyva pasirenka žirgą ir įrašo pageidaujamą šuolių aukštį. <strong>Naudotojo vardas ir pavardė, pasirinktas žirgas bei įrašytas aukštis rodomi viešai visiems svetainės lankytojams</strong>, įskaitant neprisijungusius.</p>
      <p>Šie duomenys tvarkomi siekiant administruoti jūsų savanoriškai pasirinktą dalyvavimą viešame sąraše. Įrašą galima keisti ar pašalinti skiltyje „Varžybos“; administracija taip pat gali pašalinti įrašus. Prieš prisijungdami įvertinkite viešą matomumą. Šis sąrašas nėra oficiali registracija į varžybas.</p>
      <p>Jeigu sąraše dalyvauja nepilnamečiai, jų duomenų paskelbimą turi įvertinti ir patvirtinti tėvai ar globėjai.</p>
    </Section>

    <Section icon={Baby} title="Nepilnamečiai ir globėjai">
      <p>Nepilnamečio treniruotės registraciją ir duomenų pateikimą organizuoja tėvas ar globėjas. Susietų profilių funkcija leidžia valdyti šeimos nario registracijas; susiejimo informacija naudojama tik paskyros ir treniruočių administravimui.</p>
    </Section>

    <Section icon={UserCheck} title="Duomenų naudojimo tikslai ir teisinis pagrindas">
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Sutarties vykdymas arba veiksmai prieš sutartį (BDAR 6 str. 1 d. b p.):</strong> registracijos, treniruotės, abonementai ir būtinas susirašinėjimas.</li>
        <li><strong>Teisinės prievolės (6 str. 1 d. c p.):</strong> apskaitos dokumentai ir kitos taikomos pareigos.</li>
        <li><strong>Teisėtas interesas (6 str. 1 d. f p.):</strong> paslaugų ir paskyrų saugumas, piktnaudžiavimo prevencija, techninių trikdžių analizė, reikalavimų gynimas, kai toks interesas viršija duomenų subjektų interesus.</li>
        <li><strong>Sutikimas arba savanoriškas pasirinkimas (6 str. 1 d. a p., kai taikoma):</strong> nebūtini pranešimai, viešo atsiliepimo paskelbimas ir viešo varžybų sąrašo pasirinkimas. Tokį pasirinkimą galite atšaukti, tačiau tai nepanaikina iki atšaukimo teisėtai atlikto tvarkymo.</li>
      </ul>
      <p>Jei prašyme dėl ligos yra specialių kategorijų duomenų, jų tvarkymui papildomai turi būti taikoma tinkama BDAR 9 straipsnio išimtis. Dėl tokio dokumento pateikimo ir alternatyvų galite tartis su administracija.</p>
    </Section>

    <Section icon={Bell} title="Elektroniniai laiškai ir pranešimai">
      <p>Siunčiame su registracijomis, treniruočių pakeitimais, atšaukimais, abonementais ir kitais paslaugos veiksmais susijusius el. laiškus. Pasirinkus naršyklės „push“ pranešimus, gali būti saugomas įrenginio pranešimų prenumeratos identifikatorius. Pranešimų leidimą galite išjungti naršyklės arba įrenginio nustatymuose.</p>
    </Section>

    <Section icon={Server} title="Paslaugų teikėjai ir duomenų perdavimas">
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Supabase:</strong> duomenų bazė, paskyrų autentifikavimas ir serverio funkcijos.</li>
        <li><strong>Cloudflare:</strong> svetainės priegloba ir turinio pateikimas.</li>
        <li><strong>Google / Gmail API:</strong> paslaugos el. laiškų siuntimas naudojant prijungtą Equus pašto paskyrą.</li>
        <li><strong>Buhalterinės apskaitos paslaugų teikėjai:</strong> tik atsiskaitymui reikalingi duomenys.</li>
      </ul>
      <p>Kai paslaugų teikėjai tvarko duomenis už Europos ekonominės erdvės ribų, taikomos atitinkamos BDAR perdavimo sąlygos ir apsaugos priemonės; dėl konkrečių perdavimų informacijos galite kreiptis aukščiau nurodytais kontaktais.</p>
      <p>Duomenų neparduodame. Nuoroda į išorinę „LiveJumping“ programą atveria kitą svetainę, kuriai taikomos jos pačios privatumo sąlygos.</p>
    </Section>

    <Section icon={Clock} title="Duomenų saugojimas">
      <p>Rezervacijų ir paskyrų duomenys saugomi tiek, kiek reikia paslaugų vykdymui, ginčams ir teisėtiems reikalavimams; finansiniai dokumentai – pagal privalomus apskaitos saugojimo terminus. Techniniai ir pranešimų duomenys saugomi pagal jų funkcijos poreikį. Viešas varžybų įrašas pašalinamas naudotojui pasitraukus ar administratoriui jį ištrynus, išskyrus teisiškai privalomą atskirą saugojimą.</p>
      <p>Konkrečius taikomus terminus arba jų nustatymo kriterijus galite sužinoti susisiekę su duomenų valdytoju. Ištrynimas gali būti ribojamas įstatymuose nustatytų pareigų.</p>
    </Section>

    <Section icon={ShieldCheck} title="Jūsų teisės">
      <p>Turite teisę susipažinti su duomenimis, juos ištaisyti, tam tikrais atvejais ištrinti, apriboti tvarkymą, nesutikti su tvarkymu, gauti perkeliamus duomenis ir atšaukti sutikimą, kai juo remiamasi. Teisės taikomos pagal BDAR numatytas sąlygas ir išimtis.</p>
      <p>Dėl savo teisių kreipkitės nurodytais kontaktais. Taip pat galite skųstis <a href="https://vdai.lrv.lt/" className="text-gold underline" target="_blank" rel="noreferrer">Valstybinei duomenų apsaugos inspekcijai</a>.</p>
    </Section>

    <Section icon={Cookie} title="Slapukai ir naršyklės atmintis">
      <p>Apie naudojamą naršyklės saugyklą bei slapukų valdymą skaitykite <a href="/slapuku-politika" className="text-gold underline">Slapukų politikoje</a>.</p>
    </Section>

    <Section icon={Mail} title="Politikos pakeitimai">
      <p>Atnaujinę duomenų tvarkymo praktiką peržiūrime ir šią politiką. Apie reikšmingus pakeitimus informuojame svetainėje arba kitu tinkamu būdu.</p>
    </Section>
  </div>;
}
