import { ArrowRight, CreditCard, QrCode } from "lucide-react";
import { Link } from "react-router-dom";

export function BankTransferInstructions() {
  return (
    <section className="rounded-2xl border border-gold/25 bg-gradient-card p-5 shadow-elegant sm:p-7">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gold/20 bg-gold/10">
          <CreditCard className="h-5 w-5 text-gold" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-gold/75">
            Abonemento ir mokėjimas
          </p>
          <h2 className="mt-1 font-display text-2xl text-foreground">
            Abonementas per Equus
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Abonemento užklausą pateikite prisijungę prie Equus ir atidarę „Paskyra“ → „Abonementas“.
            Pasirinkite treniruočių kiekį, tipą, žirgą, mokėjimo būdą ir, jei reikia, įvykusias praeitų
            14 dienų treniruotes, kurias norite įskaityti kaip panaudotas.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-gold/10 bg-background/35 p-4">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-gold" />
            <p className="text-sm font-semibold">Bankinis pavedimas</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Užklausa iškart pasirodo administracijos „QR užklausos“ sąraše. Laura patikrina, ar mokėjimas gautas,
            ir paspaudžia „Patvirtinti mokėjimą“. Naujas abonementas sukuriamas tik po patvirtinimo.
          </p>
        </div>
        <div className="rounded-xl border border-gold/10 bg-background/35 p-4">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-gold" />
            <p className="text-sm font-semibold">Grynais</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Užklausoje parodomas QR kodas. Parodykite jį Laurai; ji atidarys užklausą, patikrins informaciją
            ir paspaus „Patvirtinti mokėjimą“.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-start gap-2">
        <Link
          to="/paskyra?tab=subs"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/15"
        >
          Atidaryti abonemento užklausas
          <ArrowRight className="h-4 w-4" />
        </Link>
        <p className="text-xs leading-5 text-muted-foreground">
          Abonementas neatsiras paskyroje, kol mokėjimas nebus patvirtintas.
        </p>
      </div>
    </section>
  );
}