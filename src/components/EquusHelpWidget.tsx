import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, MessageCircle, X, ExternalLink } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useHolidayContact, holidayContactText } from "@/hooks/useHolidayContact";

const FAQ = {
  lt: [
    ["Kaip užsiregistruoti?", "Jeigu esate naujas lankytojas, užpildykite pirmos treniruotės registraciją. Esami nariai registruojasi per grafiką."],
    ["Kaip atšaukti pamoką?", "Atidarykite grafiką ir pasirinkite savo rezervaciją. Dėl išimčių kreipkitės į Laurą."],
    ["Kur vyksta treniruotės?", "Pakamšės g. 7, Daučionys, Vilniaus rajonas."],
    ["Nuo kokio amžiaus?", "„Mažylio svajonė“ – nuo 3 metų. Sportinės treniruotės – nuo 10 metų."],
  ],
  en: [
    ["How do I book?", "New riders can use first-lesson registration. Existing members book in the schedule."],
    ["How do I cancel?", "Open the schedule and select your booking. Contact Laura if you need assistance."],
    ["Where are lessons held?", "Pakamšės g. 7, Daučionys, Vilnius district."],
    ["What ages can attend?", "“Little one's dream” is available from age 3; sport riding lessons from age 10."],
  ],
} as const;

export function EquusHelpWidget() {
  const { language } = useLanguage();
  const { holiday, hidden: hideAdminPhone } = useHolidayContact();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const lt = language === "lt";

  if (dismissed) return null;

  return (
    <div className="equus-help-widget fixed bottom-[calc(5.2rem+env(safe-area-inset-bottom))] right-3 z-50 sm:bottom-6 sm:right-6">
      {!open ? (
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
          <button type="button" onClick={() => setOpen(true)} aria-label={lt ? "Atidaryti pagalbą" : "Open help"}
            aria-expanded={false} className="flex h-9 items-center gap-2 rounded-full px-2 text-sm font-medium hover:bg-muted">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span>{lt ? "Pagalba" : "Help"}</span>
          </button>
          <button type="button" aria-label={lt ? "Paslėpti pagalbą iki puslapio atnaujinimo" : "Hide help until refresh"}
            onClick={() => setDismissed(true)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <section role="dialog" aria-modal="false" aria-label={lt ? "Pagalba" : "Help"}
          className="flex max-h-[min(75dvh,440px)] w-[min(350px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">{lt ? "Pagalba" : "Help"}</h2>
              <p className="text-xs text-muted-foreground">{lt ? "Raskite atsakymą arba parašykite mums" : "Find an answer or contact us"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={lt ? "Uždaryti" : "Close"}
              className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <div className="space-y-1">
              {(lt ? FAQ.lt : FAQ.en).map(([question, answer], index) => (
                <div key={question} className="border-b border-border/60 last:border-0">
                  <button type="button" aria-expanded={expanded === index} onClick={() => setExpanded(expanded === index ? null : index)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm">
                    <span>{question}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded === index ? "rotate-180" : ""}`} />
                  </button>
                  {expanded === index && <p className="pb-3 text-sm leading-relaxed text-muted-foreground">{answer}</p>}
                </div>
              ))}
            </div>
            {holiday && <p className="mt-3 rounded-md bg-muted p-3 text-xs leading-relaxed">{holidayContactText(holiday)}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/kainos" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted">{lt ? "Kainos" : "Prices"}</Link>
              <Link to="/grafikas" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted">{lt ? "Grafikas" : "Schedule"}</Link>
              <Link to="/registracija" onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted">{lt ? "Pirma treniruotė" : "First lesson"}</Link>
            </div>
          </div>
          <footer className="space-y-2 border-t border-border bg-background/40 px-4 py-3">
            <a href="https://m.me/100063701673482" target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-between rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
              {lt ? "Rašyti Equus per Messenger" : "Message Equus on Messenger"} <ExternalLink className="h-4 w-4" />
            </a>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <a href="tel:+37065822872" className="hover:underline">Laura · +370 658 22872</a>
              {!hideAdminPhone && <a href="https://m.me/adriija.kalikaite" target="_blank" rel="noreferrer" className="hover:underline">{lt ? "Svetainės klausimai" : "Website support"}</a>}
            </div>
          </footer>
        </section>
      )}
    </div>
  );
}
