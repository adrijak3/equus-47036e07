import {
  ArrowRight,
  CalendarDays,
  Heart,
  ImagePlus,
  Mail,
  MapPin,
  Phone,
  Tag,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

export default function ApieMus() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-card p-7 shadow-elegant sm:p-12">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full border border-gold/10" />
        <div className="pointer-events-none absolute -right-6 -top-10 h-44 w-44 rounded-full border border-gold/10" />
        <p className="text-xs uppercase tracking-[0.25em] text-gold/75">EQUUS · JOJIMO MOKYKLA</p>
        <h1 className="mt-3 font-display text-5xl text-gradient-gold sm:text-6xl">Apie mus</h1>
        <div className="gold-divider mt-5 max-w-[120px]" />
        <p className="mt-5 max-w-2xl text-base leading-7 text-foreground/85 sm:text-lg">
          Jojimas prasideda nuo pažinties su žirgu, pasitikėjimo ir kantrybės.
          „Equus“ kviečia mokytis, tobulėti ir atrasti savo ryšį su žirgu.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            to="/kainos"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold/25 px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-gold/5"
          >
            Kainos <Tag className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Aiškus pasirinkimas pagal tai, ar žmogus jau yra jojęs Equus mokykloje. */}
      <section className="mt-7 grid gap-4 md:grid-cols-2">
        <article className="flex flex-col items-start rounded-2xl border border-gold/25 bg-gradient-card p-6 shadow-elegant sm:p-8">
          <span className="rounded-full border border-gold/20 bg-gold/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-gold">
            Pirmą kartą „Equus“
          </span>
          <h2 className="mt-4 font-display text-2xl text-gradient-gold sm:text-3xl">
            Esate naujas raitelis?
          </h2>
          <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
            Dar nesate joję mūsų mokykloje? Pradėkite nuo registracijos — susipažinsime
            su jumis ir padėsime žengti pirmuosius žingsnius.
          </p>
          <Link
            to="/registracija"
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            Eiti į registraciją <ArrowRight className="h-4 w-4" />
          </Link>
        </article>

        <article className="flex flex-col items-start rounded-2xl border border-gold/15 bg-background/35 p-6 sm:p-8">
          <span className="rounded-full border border-gold/15 bg-background/50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Jau mūsų bendruomenėje
          </span>
          <h2 className="mt-4 font-display text-2xl text-foreground sm:text-3xl">
            Jau jojote „Equus“?
          </h2>
          <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
            Jei jau lankėtės mūsų jojimo mokykloje ir norite pasirinkti kitą treniruotę,
            atsidarykite grafiką ir išsirinkite tinkamą laiką.
          </p>
          <Link
            to="/grafikas"
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10"
          >
            Atidaryti treniruočių grafiką <ArrowRight className="h-4 w-4" />
          </Link>
        </article>
      </section>

      {/* Istorijos tekstą papildykite savo asmenine, širdžiai artima istorija. */}
      <section className="mt-7 grid gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
        <article className="rounded-2xl border border-gold/20 bg-gradient-card p-6 shadow-elegant sm:p-8">
          <p className="text-xs uppercase tracking-[0.2em] text-gold/75">Nuo 2011 metų</p>
          <h2 className="mt-2 font-display text-3xl text-gradient-gold sm:text-4xl">Mūsų istorija</h2>
          <div className="gold-divider mt-4 max-w-[100px]" />
          <p className="mt-5 text-sm leading-7 text-foreground/85">
            Jojimo mokykla „Equus“ duris atvėrė 2011 metais.
          </p>
          <div className="mt-4 rounded-xl border border-dashed border-gold/30 bg-background/30 p-5 sm:p-6">
            <p className="text-sm font-medium text-gold">Čia bus mūsų istorija</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Šioje vietoje įrašysiu mūsų istoriją — kaip prasidėjo „Equus“, kokie
              žmonės ir prisiminimai kūrė mokyklą ir ką ji reiškia mūsų bendruomenei.
            </p>
          </div>
        </article>

        <aside className="rounded-2xl border border-gold/15 bg-background/30 p-4 sm:p-5">
          {/*
            Lauros nuotraukos vieta:
            įkelkite nuotrauką į public/images/laura.jpg ir šį bloką pakeiskite, pvz.:
            <img src="/images/laura.jpg" alt="Jojimo trenerė Laura" className="h-full w-full object-cover" />
          */}
          <div className="flex aspect-[4/5] min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-gold/30 bg-gradient-card px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/20 bg-gold/10 text-gold">
              <ImagePlus className="h-6 w-6" />
            </div>
            <p className="mt-4 font-display text-xl text-gold">Lauros nuotrauka</p>
            <p className="mt-2 max-w-[220px] text-sm leading-6 text-muted-foreground">
              Nuotrauką galėsite įkelti čia — palikta speciali vieta.
            </p>
          </div>
          <p className="mt-4 text-center font-display text-xl text-foreground">Laura</p>
          <p className="mt-1 text-center text-xs uppercase tracking-[0.16em] text-muted-foreground">Jojimo trenerė</p>
        </aside>
      </section>

      <section className="mt-7">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-gold/70">Mūsų komanda</p>
          <h2 className="mt-2 font-display text-3xl text-gradient-gold sm:text-4xl">Treniruokitės su mūsų treneriais</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            „Equus“ treniruotes veda Laura, Jolita, Jovita ir Vytautas. Kiekvienas treneris
            turi savą patirtį ir požiūrį, o jūsų pažanga tęsiasi kartu su visa komanda.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { name: "Laura", role: "Trenerė" },
            { name: "Jolita", role: "Trenerė" },
            { name: "Jovita", role: "Trenerė" },
            { name: "Vytautas", role: "Treneris" },
          ].map((trainer) => (
            <article key={trainer.name} className="rounded-2xl border border-gold/15 bg-gradient-card p-4 text-center sm:p-5">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-gold/20 bg-gold/10 text-gold">
                <Users className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-display text-lg text-foreground sm:text-xl">{trainer.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{trainer.role}</p>
            </article>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border border-gold/25 bg-gold/5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
              <Heart className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-xl text-gold">Vienas abonementas — visi mūsų treneriai</h3>
              <p className="mt-2 text-sm leading-6 text-foreground/80">
                Tas pats abonementas galioja treniruotėms su Laura, Jolita, Jovita ir Vytautu.
                Nereikia atskiro abonemento kiekvienam treneriui — galite registruotis į
                tinkamą treniruotę pagal grafiką.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-7 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-gold/15 bg-gradient-card p-6 sm:p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">
            <Heart className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-2xl text-gold">Mūsų požiūris</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Žirgas nėra vien sporto partneris — svarbu išmokti jį suprasti, gerbti jo poreikius
            ir atsakingai elgtis. Treniruotėse vertiname saugumą, dėmesingumą ir nuoseklų mokymąsi.
          </p>
        </article>
        <article className="rounded-2xl border border-gold/15 bg-gradient-card p-6 sm:p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">
            <CalendarDays className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-2xl text-gold">Jojimo galimybės</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Galite rinktis grupines jojimo pamokas, treniruotes poroje arba individualias pamokas.
            Treniruotis galima mokyklos žirgais arba su savo žirgu. Kainas ir abonementų variantus
            rasite atskirame kainų puslapyje.
          </p>
        </article>
      </section>

      <section className="mt-7 rounded-2xl border border-gold/15 bg-background/30 p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-gold/70">Kaip pradėti?</p>
        <h2 className="mt-2 font-display text-3xl text-gradient-gold">Žingsnis po žingsnio</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <div>
            <p className="font-display text-2xl text-gold">01</p>
            <h3 className="mt-2 font-semibold">Užsiregistruokite</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Jei esate naujas raitelis, pradėkite nuo registracijos puslapio.
            </p>
          </div>
          <div>
            <p className="font-display text-2xl text-gold">02</p>
            <h3 className="mt-2 font-semibold">Pasirinkite treniruotę</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Jau jojusiems „Equus“ — treniruočių grafike rasite galimus laikus.
            </p>
          </div>
          <div>
            <p className="font-display text-2xl text-gold">03</p>
            <h3 className="mt-2 font-semibold">Peržiūrėkite kainas</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Pasirinkite jums tinkamiausią treniruotės ar abonemento variantą.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-7 rounded-2xl border border-gold/20 bg-gradient-card p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-gold/70">Laukiame jūsų</p>
        <h2 className="mt-2 font-display text-3xl text-gradient-gold">Aplankykite „Equus“</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <a href="https://maps.app.goo.gl/Tjd1rUUVSabq52ip6" target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 rounded-xl border border-gold/10 p-4 transition-colors hover:border-gold/30">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <span className="text-sm leading-6">Pakamšės g. 7,<br />Daučionys, 14245<br />Vilniaus r. sav.</span>
          </a>
          <a href="tel:+37065822872" className="flex items-start gap-3 rounded-xl border border-gold/10 p-4 transition-colors hover:border-gold/30">
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <span className="text-sm leading-6"><span className="block font-semibold">Telefonas</span>+370 658 22872 arba +370 628 76090</span>
          </a>
          <a href="mailto:jojimokykla@gmail.com" className="flex items-start gap-3 rounded-xl border border-gold/10 p-4 transition-colors hover:border-gold/30">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <span className="break-words text-sm leading-6"><span className="block font-semibold">El. paštas</span>jojimokykla@gmail.com</span>
          </a>
        </div>
      </section>

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <Tag className="h-3.5 w-3.5 text-gold" />
        Visą informaciją apie paslaugas ir kainas rasite{" "}
        <Link to="/kainos" className="text-gold underline underline-offset-4">kainų puslapyje</Link>.
      </p>
    </div>
  );
}
