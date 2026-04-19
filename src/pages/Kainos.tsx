export default function Kainos() {
  return (
    <div className="container max-w-4xl py-12 sm:py-20">
      <header className="text-center mb-14 animate-fade-up">
        <h1 className="text-5xl sm:text-6xl font-display text-gradient-gold mb-3">Kainos</h1>
        <div className="gold-divider max-w-[140px] mx-auto" />
      </header>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Standard */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up">
          <h2 className="text-2xl font-display text-gold mb-6">Pamokos</h2>
          <ul className="space-y-4 font-body">
            <Row label="1 pamoka" price="35 €" />
            <Row label="4 pamokos" price="140 €" />
            <Row label="8 pamokos" price="240 €" />
          </ul>
          <div className="gold-divider my-6" />
          <div className="text-sm text-muted-foreground space-y-1.5">
            <p>≤ 7 pamokos — 35 € / pamoka</p>
            <p>≥ 8 pamokos — 30 € / pamoka</p>
          </div>
        </section>

        {/* Mažylio svajonė */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up">
          <h2 className="text-2xl font-display text-gold mb-6">Mažylio svajonė</h2>
          <ul className="space-y-4 font-body">
            <Row label="30 min" price="20 €" />
            <Row label="45 min" price="35 €" />
          </ul>
          <div className="gold-divider my-6" />
          <p className="text-sm text-muted-foreground italic">
            Daugiau informacijos — kreiptis į administraciją.
          </p>
        </section>
      </div>
    </div>
  );
}

function Row({ label, price }: { label: string; price: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 pb-2 border-b border-gold/5">
      <span className="text-foreground/90">{label}</span>
      <span className="text-xl font-display text-gradient-gold tabular-nums">{price}</span>
    </li>
  );
}
