export default function Kainos() {
  return (
    <div className="container max-w-4xl py-12 sm:py-20">
      <header className="text-center mb-14 animate-fade-up">
        <h1 className="text-5xl sm:text-6xl font-display text-gradient-gold mb-3">Kainos</h1>
        <div className="gold-divider max-w-[140px] mx-auto" />
      </header>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Pavienės pamokos */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up sm:col-span-2">
          <h2 className="text-2xl font-display text-gold mb-6">Pavienės pamokos</h2>
          <ul className="space-y-4 font-body">
            <Row label="Grupinė jojimo pamoka" price="40 €" />
            <Row label="Asmeninė jojimo pamoka (po 2)" price="45 €" />
            <Row label="Asmeninė jojimo pamoka" price="50 €" />
          </ul>
        </section>

        {/* 4k abonementai */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up">
          <h2 className="text-2xl font-display text-gold mb-6">4 kartų abonementai (1 treniruotė per savaitę)</h2>
          <ul className="space-y-4 font-body">
            <Row label="Grupinės · mokyklos žirgais" price="150 €" />
            <Row label="Grupinės · nuosavu žirgu" price="140 €" />
            <Row label="Po 2 · mokyklos žirgais" price="170 €" />
            <Row label="Po 2 · nuosavu žirgu" price="160 €" />
          </ul>
        </section>

        {/* 8k abonementai */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up">
          <h2 className="text-2xl font-display text-gold mb-6">8 kartų abonementai (2 treniruotės per savaitę)</h2>
          <ul className="space-y-4 font-body">
            <Row label="Grupinės · mokyklos žirgais" price="280 €" />
            <Row label="Grupinės · nuosavu žirgu" price="260 €" />
            <Row label="Po 2 · mokyklos žirgais" price="320 €" />
            <Row label="Po 2 · nuosavu žirgu" price="300 €" />
          </ul>
        </section>

        {/* 12k abonementai */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up">
          <h2 className="text-2xl font-display text-gold mb-6">12 kartų abonementai (3 treniruotės per savaitę)</h2>
          <ul className="space-y-4 font-body">
            <Row label="Grupinės · mokyklos žirgais" price="400 €" />
            <Row label="Grupinės · nuosavu žirgu" price="360 €" />
            <Row label="Po 2 · mokyklos žirgais" price="480 €" />
            <Row label="Po 2 · nuosavu žirgu" price="450 €" />
          </ul>
        </section>

        {/* Mažylio svajonė */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up">
          <h2 className="text-2xl font-display text-gold mb-6">Mažylio svajonė</h2>
          <ul className="space-y-4 font-body">
            <Row label="30 min" price="20 €" />
            <Row label="45 min" price="35 €" />
          </ul>
        </section>

        {/* Gardo nuoma */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant animate-fade-up sm:col-span-2">
          <h2 className="text-2xl font-display text-gold mb-6">Gardo nuoma</h2>
          <ul className="space-y-4 font-body">
            <Row label="1 mėnuo" price="450 €" />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Row({ label, price }: { label: string; price: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 pb-2 border-b border-gold/5">
      <span className="text-foreground/90">{label}</span>
      <span className="text-xl font-display text-gradient-gold tabular-nums whitespace-nowrap">{price}</span>
    </li>
  );
}
