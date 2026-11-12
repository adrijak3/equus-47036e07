import { Building2, CalendarClock, Wallet, ShieldAlert, Scale, RotateCcw, Trophy, Users, FileText } from "lucide-react";

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-gold/20 bg-gradient-card shadow-elegant overflow-hidden">
    <div className="px-6 py-5 border-b border-gold/10 flex items-start gap-3">
      <Icon className="w-5 h-5 text-gold mt-0.5 shrink-0" />
      <h2 className="text-xl font-display text-gold">{title}</h2>
    </div>
    <div className="px-6 py-5 space-y-3 text-sm md:text-base leading-relaxed text-foreground/90">{children}</div>
  </section>;
}

export default function TaisyklesIrSalygos() {
  return <div className="container py-10 md:py-14 max-w-4xl space-y-8">
    <header className="text-center space-y-3">
      <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">Paslaugų teikimo taisyklės ir sąlygos</h1>
      <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
        Paskutinį kartą atnaujinta 2026-11-03. Šios taisyklės apibūdina Equus jojimo paslaugų, registracijų ir svetainės funkcijų naudojimą.
      </p>
    </header>

    <Section icon={Building2} title="Paslaugų teikėjas ir kontaktai">
      <p>Paslaugas teikia <strong>VšĮ Jojimo mokykla „Equus“</strong>, įmonės kodas 302754824, Pakamšės g. 7, Daučionys, 14245 Vilniaus r. sav.</p>
      <p>Dėl registracijos, atsiskaitymo ar taisyklių kreipkitės telefonu <a href="tel:+37062876090" className="text-gold underline">+370 628 76090</a> arba el. paštu <a href="mailto:jojimomokykla@gmail.com" className="text-gold underline">jojimomokykla@gmail.com</a>.</p>
    </Section>

    <Section icon={FileText} title="Registracija ir paslaugų sutartis">
      <p>Treniruotę galima užsakyti viešos registracijos forma, prisijungus grafike ar susitarus su administracija. Viešos registracijos užklausa nėra galutinai patvirtinta tol, kol administracija nepatvirtina jos arba nesuderinamas kitas laikas.</p>
      <p>Prieš pirmąją treniruotę būtina pasirašyti jojimo paslaugų sutartį. Dokumentą galite peržiūrėti <a href="/informacija" className="text-gold underline">Informacijos skiltyje</a>. Dalyviai privalo pateikti teisingus registracijos duomenis.</p>
    </Section>

    <Section icon={CalendarClock} title="Grafikas, rezervacijos ir nuolatiniai laikai">
      <ul className="list-disc pl-5 space-y-2">
        <li>Treniruočių vietų skaičių ir laikus nustato administracija. Laisvos vietos priklauso nuo atitinkamai dienai nustatyto limito, trenerio ir kitų taikomų grafiko sąlygų.</li>
        <li><strong>Registruotis galima iki treniruotės pradžios.</strong> Atšaukimo taisyklės taikomos atskirai.</li>
        <li>Nuolatinį savaitinį laiką ir papildomą nuolatinių laikų laukiančiųjų sąrašą tvarko administracija. Įrašymas į laukiančiųjų sąrašą savaime negarantuoja vietos; vieta suteikiama tik jai atsilaisvinus ir ją priskyrus.</li>
        <li>Perkėlimas į kitą užsiėmimą galimas tik pagal tuo metu siūlomus laisvus laikus, taikomus terminus ir sistemos taisykles. Jei perkėlimo nepavyksta atlikti, susisiekite su administracija.</li>
        <li>Žirgų pasirinkimas treniruotėms priklauso nuo žirgo užimtumo, leistino dienos krūvio ir administracijos nustatytų savaitės dienų. Treneris ir administracija gali priskirti žirgą pagal treniruotės poreikius.</li>
      </ul>
    </Section>

    <Section icon={Wallet} title="Kainos, abonementai ir apmokėjimas">
      <p>Aktualios kainos ir paslaugų rūšys skelbiamos skiltyje <a href="/kainos" className="text-gold underline">„Kainos“</a>. Galima pasirinkti atitinkamo tipo treniruotes ar abonementus; skirtingiems paketams, treniruočių rūšims ir žirgo tipams gali būti taikomos skirtingos kainos.</p>
      <p>Abonemento užklausa, jos patvirtinimas, apmokėjimo būklė, pradžia, likutis ir galiojimas rodomi paskyroje bei administracijos sistemoje. <strong>Įprastas abonemento galiojimo terminas – 30 dienų nuo įsigijimo</strong>; jei konkrečiam abonementui taikomos kitos administracijos patvirtintos sąlygos arba pradžios atidėjimas, vadovaujamasi konkrečios užklausos ir abonemento duomenimis.</p>
      <p>Atsiskaityti galima grynaisiais arba banko pavedimu pagal pateiktus mokėjimo duomenis ar sąskaitą. Kortelių mokėjimų tiesiogiai Equus svetainėje nepriimame.</p>
    </Section>

    <Section icon={RotateCcw} title="Atšaukimas, praleidimas ir išimtys">
      <ul className="list-disc pl-5 space-y-2">
        <li>Treniruotę galima atšaukti be treniruotės praradimo, apie tai pranešus ne vėliau kaip <strong>24 valandas prieš pradžią</strong>.</li>
        <li>Vėliau nei prieš 24 valandas atšaukta arba nepranešus praleista treniruotė paprastai laikoma panaudota ir nekompensuojama, išskyrus individualiai įvertintus ligos ar force majeure atvejus.</li>
        <li>Ligos atveju sistema gali leisti pateikti atskirą prašymą ir pagrindžiančius dokumentus pagal prašyme nurodytą tvarką. Tai nėra automatinė kompensavimo garantija.</li>
        <li>Nuolatinio laiko <strong>vienos pamokos atšaukimas</strong> nereiškia, kad atsisakoma visų būsimų savaičių nuolatinio laiko. Visišką nuolatinio laiko panaikinimą tvarko administracija.</li>
        <li>Pasibaigus abonemento galiojimo laikotarpiui nepanaudotos treniruotės paprastai negrąžinamos ir nekompensuojamos, išskyrus taikomas teisės aktuose nustatytas ar individualiai patvirtintas išimtis.</li>
      </ul>
    </Section>

    <Section icon={Trophy} title="Varžybos ir norinčiųjų sąrašas">
      <p>Skiltyje <a href="/varzybos" className="text-gold underline">„Varžybos“</a> administracija skelbia būsimus renginius, jų datas, vietą bei nuorodą į „LiveJumping“ programą. Prisijungę naudotojai gali savanoriškai įtraukti save į viešą norinčiųjų sąrašą, pasirinkti žirgą ir nurodyti pageidaujamą šuolių aukštį.</p>
      <p><strong>Tai nėra oficiali paraiška į varžybas, žirgo rezervacija ar garantuotas leidimas startuoti.</strong> Galutinį dalyvavimą, žirgo tinkamumą, starto aukščius ir logistiką derina administracija ir treneriai pagal konkretaus renginio sąlygas. Tas pats žirgas norinčiųjų sąraše gali būti pasirinktas kelių raitelių.</p>
      <p>Šiame sąraše viešai rodomas dalyvio vardas, žirgas ir nurodytas aukštis. Prieš įsirašydami perskaitykite <a href="/privatumo-politika" className="text-gold underline">Privatumo politiką</a>. Savo įrašą galite keisti arba ištrinti; už nepilnamečių viešą dalyvavimą atsako jų tėvai ar globėjai.</p>
    </Section>

    <Section icon={Users} title="Paskyros ir susieti šeimos profiliai">
      <p>Paskyra yra asmeninė. Naudotojas atsako už pateiktų duomenų teisingumą ir prisijungimo saugumą. Jei paskyroje valdomi susieti šeimos nariai, veiksmus už juos turi atlikti tik teisę juos atstovauti turintis asmuo.</p>
      <p>Svetainėje gali būti siunčiami su treniruotėmis, rezervacijomis ir abonementais susiję pranešimai. Naršyklės pranešimai priklauso nuo naudotojo pasirinkto leidimo.</p>
    </Section>

    <Section icon={ShieldAlert} title="Saugumas ir atsakomybė">
      <p>Jojimas yra su fizine rizika susijusi veikla. Dalyviai privalo laikytis trenerių nurodymų ir žirgyno taisyklių, dėvėti tinkamą aprangą bei avalynę. Už nepilnamečių registravimą ir priežiūros susitarimus atsako jų tėvai arba globėjai. Apie saugumui svarbias aplinkybes prieš treniruotę informuokite trenerį.</p>
    </Section>

    <Section icon={Scale} title="Ginčai ir taisyklių pakeitimai">
      <p>Jeigu kilo nesutarimų, pirmiausia kreipkitės nurodytais kontaktais. Neišsprendus ginčo, galima pasinaudoti taikomomis vartotojų teisių gynimo priemonėmis, įskaitant kreipimąsi į Valstybinę vartotojų teisių apsaugos tarnybą ar teismą.</p>
      <p>Taisyklės gali būti keičiamos; aktuali versija skelbiama šiame puslapyje. Pakeitimai nepanaikina teisės aktuose numatytų vartotojo teisių ir netaikomi atgaline data taip, kad pablogintų jau sudarytos sutarties sąlygas be teisinio pagrindo.</p>
    </Section>
  </div>;
}
