import { ArrowRight, CalendarDays, Heart, Mail, MapPin, Phone, Tag } from "lucide-react";
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
          <Link to="/grafikas" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gold px-5 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90">
            Peržiūrėti grafiką <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/kainos" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gold/25 px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-gold/5">
            Kainos
          </Link>
        </div>
      </header>

      <section className="mt-7 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-gold/15 bg-gradient-card p-6 sm:p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">
            <Heart className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-2xl text-gold">Mūsų požiūris</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Žirgas nėra vien sporto partneris – svarbu išmokti jį suprasti, gerbti jo poreikius
            ir atsakingai elgtis. Treniruotėse vertiname saugumą, dėmesingumą ir nuoseklų mokymąsi.
          </p>
        </article>
        <article className="rounded-2xl border border-gold/15 bg-gradient-card p-6 sm:p-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/10 text-gold">
            <CalendarDays className="h-5 w-5" />
          </div>
          <h2 className="mt-4 font-display text-2xl text-gold">Jojimo galimybės</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Galite rinktis grupines, treniruotes poroje arba individualias pamokas. Treniruotis
            galima mokyklos žirgais arba su savo žirgu; kainas ir abonementų variantus rasite
            atskirame kainų puslapyje.
          </p>
        </article>
      </section>

      <section className="mt-7 rounded-2xl border border-gold/15 bg-background/30 p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-gold/70">Kaip pradėti</p>
        <h2 className="mt-2 font-display text-3xl text-gradient-gold">Trys paprasti žingsniai</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <div>
            <p className="font-display text-2xl text-gold">01</p>
            <h3 className="mt-2 font-semibold">Peržiūrėkite grafiką</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Išsirinkite jums tinkamą laiką ir susipažinkite su laisvomis treniruotėmis.</p>
          </div>
          <div>
            <p className="font-display text-2xl text-gold">02</p>
            <h3 className="mt-2 font-semibold">Pasirinkite treniruotę</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Peržiūrėkite kainas ir pasirinkite jums tinkamiausią pamokos ar abonemento variantą.</p>
          </div>
          <div>
            <p className="font-display text-2xl text-gold">03</p>
            <h3 className="mt-2 font-semibold">Susisiekite su mumis</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Jei kyla klausimų dėl pirmos treniruotės, parašykite arba paskambinkite.</p>
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
            <span className="text-sm leading-6"><span className="block font-semibold">Telefonas</span>+370 658 22872</span>
          </a>
          <a href="mailto:jojimokykla@gmail.com" className="flex items-start gap-3 rounded-xl border border-gold/10 p-4 transition-colors hover:border-gold/30">
            <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <span className="break-words text-sm leading-6"><span className="block font-semibold">El. paštas</span>jojimokykla@gmail.com</span>
          </a>
        </div>
      </section>
      <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <Tag className="h-3.5 w-3.5 text-gold" />
        Visą informaciją apie paslaugas ir kainas rasite <Link to="/kainos" className="text-gold underline underline-offset-4">kainų puslapyje</Link>.
      </p>
    </div>
  );
}
