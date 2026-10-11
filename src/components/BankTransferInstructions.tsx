import { ArrowRight, Mail } from "lucide-react";

const recipient = "jojimokykla@gmail.com";
const subject = "Equus abonementas – bankinis pavedimas";
const body = [
  "Vardas Pavardė: ",
  "Suaugęs/Vaikas (raitelis, ne mokėtojas): ",
  "Treniruočių kiekis: ",
  "Suma: ",
  "",
  "Sveiki, norėčiau įsigyti abonementą bankiniu pavedimu. Prašau atsiųsti mokėjimo informaciją.",
].join("\n");
const mailtoHref = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export function BankTransferInstructions() {
  return (
    <section className="rounded-2xl border border-gold/25 bg-gradient-card p-5 shadow-elegant sm:p-7">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gold/20 bg-gold/10">
          <Mail className="h-5 w-5 text-gold" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-gold/75">
            Apmokėjimas bankiniu pavedimu
          </p>
          <h2 className="mt-1 font-display text-2xl text-foreground">
            Abonementas pavedimu
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Pirmiausia išsiųskite užklausą el. paštu. Gavę administracijos atsakymą,
            atlikite pavedimą ir atsiųskite mokėjimo patvirtinimą. Patvirtinus mokėjimą,
            abonementą rankiniu būdu pridėsime prie jūsų paskyros.
          </p>
        </div>
      </div>

      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        <li className="rounded-xl border border-gold/10 bg-background/35 p-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/10 text-sm font-semibold text-gold">1</span>
          <p className="mt-3 text-sm font-semibold">Išsiųskite užklausą</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Užpildykite žemiau pateiktą laiško šabloną ir išsiųskite jį administracijai.
          </p>
        </li>
        <li className="rounded-xl border border-gold/10 bg-background/35 p-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/10 text-sm font-semibold text-gold">2</span>
          <p className="mt-3 text-sm font-semibold">Palaukite atsakymo</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Sulaukite administracijos atsakymo su mokėjimo informacija. Iki tol pavedimo neatlikite.
          </p>
        </li>
        <li className="rounded-xl border border-gold/10 bg-background/35 p-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/10 text-sm font-semibold text-gold">3</span>
          <p className="mt-3 text-sm font-semibold">Atsiųskite patvirtinimą</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Atlikę pavedimą, tuo pačiu el. paštu atsiųskite mokėjimo patvirtinimą.
          </p>
        </li>
      </ol>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="rounded-xl border border-gold/15 bg-background/40 p-4">
          <p className="text-sm font-semibold">Laiško šablonas</p>
          <div className="mt-2 space-y-1 font-mono text-xs leading-5 text-foreground/85">
            <p>Vardas Pavardė: <span className="text-muted-foreground">[įrašykite]</span></p>
            <p>Suaugęs/Vaikas (raitelis, ne mokėtojas): <span className="text-muted-foreground">[pasirinkite]</span></p>
            <p>Treniruočių kiekis: <span className="text-muted-foreground">[įrašykite]</span></p>
            <p>Suma: <span className="text-muted-foreground">[įrašykite]</span></p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <a
            href={mailtoHref}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/15"
          >
            <Mail className="h-4 w-4" />
            Paruošti el. laišką
            <ArrowRight className="h-4 w-4" />
          </a>
          <p className="text-xs text-muted-foreground">
            Gavėjas: <a href={`mailto:${recipient}`} className="text-gold underline underline-offset-2">{recipient}</a>
          </p>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Svarbu: abonementas paskyroje atsiras tik po to, kai administracija gaus ir patvirtins mokėjimą.
      </p>
    </section>
  );
}
