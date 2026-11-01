import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BankTransferInstructions } from "@/components/BankTransferInstructions";

const fullPriceLists = [
  {
    title: "Grupinės · mokyklos žirgais",
    prices: [40, 75, 112, 150, 185, 225, 260, 280, 315, 350, 385, 400],
  },
  {
    title: "Po 2 · mokyklos žirgais",
    prices: [45, 85, 127, 170, 212, 255, 297, 320, 360, 400, 440, 480],
  },
  {
    title: "Grupinės · nuosavu žirgu",
    prices: [40, 70, 105, 140, 175, 210, 245, 260, 290, 325, 357, 360],
  },
  {
    title: "Po 2 · nuosavu žirgu",
    prices: [45, 80, 120, 160, 200, 240, 280, 300, 337, 375, 412, 450],
  },
];

export default function Kainos() {
  const [showAllPrices, setShowAllPrices] = useState(false);

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
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant">
          <h2 className="text-2xl font-display text-gold mb-6">12 kartų abonementai (3 treniruotės per savaitę)</h2>
          <ul className="space-y-4 font-body">
            <Row label="Grupinės · mokyklos žirgais" price="400 €" />
            <Row label="Grupinės · nuosavu žirgu" price="360 €" />
            <Row label="Po 2 · mokyklos žirgais" price="480 €" />
            <Row label="Po 2 · nuosavu žirgu" price="450 €" />
          </ul>
        </section>

        {/* Mažylio svajonė */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant">
          <h2 className="text-2xl font-display text-gold mb-6">Mažylio svajonė</h2>
          <ul className="space-y-4 font-body">
            <Row label="30 min" price="20 €" />
            <Row label="45 min" price="35 €" />
          </ul>
        </section>

        {/* Gardo nuoma */}
        <section className="bg-gradient-card border border-gold/15 rounded-lg p-8 shadow-elegant sm:col-span-2">
          <h2 className="text-2xl font-display text-gold mb-6">Gardo nuoma</h2>
          <ul className="space-y-4 font-body">
            <Row label="1 mėnuo" price="450 €" />
          </ul>
        </section>
      </div>

      <section className="mt-6 overflow-hidden rounded-lg border border-gold/15 bg-gradient-card shadow-elegant">
        <button
          type="button"
          onClick={() => setShowAllPrices((current) => !current)}
          aria-expanded={showAllPrices}
          className="flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-gold/5 sm:p-6"
        >
          <span>
            <span className="block font-display text-xl text-gold">Visos abonementų kainos</span>
            <span className="mt-1 block text-sm text-muted-foreground">Peržiūrėti visus 1–12 treniruočių variantus</span>
          </span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-gold transition-transform duration-200 ${showAllPrices ? "rotate-180" : ""}`} />
        </button>

        {showAllPrices && (
          <div className="grid gap-5 border-t border-gold/10 p-5 sm:grid-cols-2 sm:p-6">
            {fullPriceLists.map((list) => (
              <div key={list.title} className="rounded-md border border-gold/10 p-4">
                <h3 className="mb-3 font-medium text-foreground">{list.title}</h3>
                <div className="space-y-2">
                  {list.prices.map((price, index) => (
                    <div key={index} className="flex items-center justify-between border-b border-gold/5 pb-1.5 text-sm last:border-0">
                      <span className="text-muted-foreground">{index + 1} {index === 0 ? "treniruotė" : "treniruotės"}</span>
                      <span className="font-medium tabular-nums">{price} €</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8">
        <BankTransferInstructions />
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
