import { FileText, Download, AlertCircle, CheckCircle2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUTARTIS_URL = "/jojimo-paslaugu-sutartis-equus.pdf";

const BALNOJIMO_ZINGSNIAI = [
  "Prieš atsivedant žirgą būtina iškrapštyti kanopas garde.",
  "Gardinę gūnią prieš vedant balnotis reikia palikti garde.",
  "Žirgas turi būti švariai iššukuotas, ypač nugaros ir pilvo srityje, kur dedasi pavarža.",
  "Pabalnojus žirgą, prieš dedant kamanas, balnojimo vieta privalo būti iššluota — tai, kas sušluota, metama į karutį.",
  "Prieš įeinant į maniežą privaloma apsižvalgyti, jog netrukdytum kitiems raiteliams.",
  "Prieš lipant ant žirgo būtina patikrinti kilpų ilgį ir dar kartą paveržti balną.",
  "Po jojimo žirgas turi būti nubalnotas ir su prakaitine gūnia kuo greičiau pastatytas į jam priskirtą gardą.",
  "Balnojimo vieta privalo būti sutvarkyta — baltas smėlis grąžinamas į maniežą.",
  "Inventorius išvalytas ir sutvarkytas: nuplauti žąslai, iš kilpų išvalytas smėlis, viskas padėta į savo vietą.",
  "Žirgui nudžiuvus — turi būti perrengtas į jo gardo gūnią; prakaitinė gūnia gražiai sulankstyta ir padėta į vietą.",
];

export default function Informacija() {
  return (
    <div className="container py-10 md:py-14 max-w-4xl space-y-10">
      <header className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-display text-gradient-gold">Informacija</h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
          Svarbi informacija apie sutartį ir balnojimo tvarką.
        </p>
      </header>

      {/* SUTARTIS */}
      <section className="rounded-lg border border-gold/20 bg-gradient-card shadow-elegant overflow-hidden">
        <div className="px-6 py-5 border-b border-gold/10 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-gold mt-0.5 shrink-0" />
          <div>
            <h2 className="text-xl font-display text-gold">Jojimo paslaugų sutartis</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Kiekvienas raitelis <strong className="text-foreground">privalo pasirašyti</strong> šią sutartį
              <strong className="text-foreground"> prieš pirmąją treniruotę</strong>. Be pasirašytos sutarties treniruotė nevyks.
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="gold">
              <a href={SUTARTIS_URL} target="_blank" rel="noopener noreferrer">
                <FileText className="w-4 h-4" />
                Peržiūrėti sutartį
              </a>
            </Button>
            <Button asChild variant="outlineGold">
              <a href={SUTARTIS_URL} download>
                <Download className="w-4 h-4" />
                Atsisiųsti PDF
              </a>
            </Button>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Į treniruotę atvykite <strong className="text-foreground">30 min. prieš</strong> jos
            pradžią – reikia laiko pasiruošti ir pabalnoti žirgą. Be pasirašytos sutarties
            treniruotė nebus įskaityta.
          </p>
        </div>
      </section>

      {/* BALNOJIMO TAISYKLĖS */}
      <section className="rounded-lg border border-gold/20 bg-gradient-card shadow-elegant overflow-hidden">
        <div className="px-6 py-5 border-b border-gold/10 flex items-start gap-3">
          <ListChecks className="w-5 h-5 text-gold mt-0.5 shrink-0" />
          <div>
            <h2 className="text-xl font-display text-gold">Balnojimo eiga</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Tvarka, kurios privalo laikytis kiekvienas raitelis prieš ir po treniruotės.
            </p>
          </div>
        </div>

        <ol className="px-6 py-5 space-y-3">
          {BALNOJIMO_ZINGSNIAI.map((zingsnis, i) => (
            <li key={i} className="flex items-start gap-3 text-sm md:text-base text-foreground/90 leading-relaxed">
              <span className="shrink-0 w-7 h-7 rounded-full bg-gold/10 border border-gold/30 text-gold text-xs font-display flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span>{zingsnis}</span>
            </li>
          ))}
        </ol>

        <div className="px-6 pb-5">
          <div className="flex items-center gap-2 rounded-md border border-gold/15 bg-gold/5 px-4 py-3 text-xs text-foreground/80">
            <CheckCircle2 className="w-4 h-4 text-gold shrink-0" />
            <span>Tvarkinga balnojimo vieta — saugumas tau, žirgui ir kitiems raiteliams.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
