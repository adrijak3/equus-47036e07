import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X, MapPin, Phone, MessageSquare, Sparkles, CalendarDays, ChevronDown, ExternalLink } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";

// Where the two "write to us" buttons lead: direct Messenger chats (m.me links).
// Equus Jojimo Mokykla page = general questions; Adrija = website problems / other questions.
const EQUUS_MESSENGER_URL = "https://m.me/100063701673482";
const ADRIJA_MESSENGER_URL = "https://m.me/adriija.kalikaite";

const FAQ_DATA = {
  lt: [
    {
      q: "Kainos ir pamokos",
      a: "Kainas rasite „Kainos“ skiltyje. Jei norite iškart registruotis, paspauskite „Noriu registruotis“ žemiau arba atsidarykite „Grafikas“.",
    },
    {
      q: "Kaip užsiregistruoti?",
      a: "Prisijunkite arba susikurkite paskyrą, atsidarykite „Grafikas“, pasirinkite laisvą treniruotę ir spauskite „Registruotis“. Vieša registracija uždaroma likus mažiau nei 3 valandoms iki treniruotės.",
    },
    {
      q: "Kaip atšaukti treniruotę?",
      a: "Grafike prie savo treniruotės pasirinkite atšaukimo mygtuką. Jei iki treniruotės liko mažiau nei 3 valandos, susisiekite su Laura.",
    },
    {
      q: "Kaip perkelti treniruotę?",
      a: "Grafike prie savo treniruotės pasirinkite perkėlimo mygtuką. Galima pasirinkti kitą laisvą laiką tą pačią dieną.",
    },
    {
      q: "Kur vyksta treniruotės?",
      a: "Equus jojimo mokykla yra Pakamšės g. 7, Daučionys, Vilniaus raj. Paspauskite „Kaip atvykti“, kad atidarytumėte žemėlapį.",
    },
    {
      q: "Koks amžius?",
      a: "„Mažylio svajonė“ skirta vaikams nuo 3 metų. Sportinės treniruotės galimos nuo 10 metų.",
    },
    {
      q: "Kontaktai",
      a: "Dėl svetainės ar registracijos klausimų rašykite Adrijai (+370 628 76090). Dėl treniruočių ir rezervacijų skambinkite arba rašykite Laurai (+370 658 22872).",
    },
  ],
  en: [
    {
      q: "Prices and lessons",
      a: "Prices are listed in the “Prices” section. To register right away, use the “I want to register” button below or open “Schedule”.",
    },
    {
      q: "How do I register?",
      a: "Sign in or create an account, open “Schedule”, choose an available training slot and press “Register”. Public registration closes less than 3 hours before training.",
    },
    {
      q: "How do I cancel?",
      a: "In the Schedule, use the cancellation action on your training. If less than 3 hours remain, contact Laura.",
    },
    {
      q: "How do I move a training?",
      a: "In the Schedule, use the move action on your training. You can choose another available time on the same day.",
    },
    {
      q: "Where are the trainings?",
      a: "Equus Riding School is at Pakamšės g. 7, Daučionys, Vilnius district. Press “Directions” to open the map.",
    },
    {
      q: "What ages are allowed?",
      a: "“Mažylio svajonė” is available from age 3. Sports training is available from age 10.",
    },
    {
      q: "Contact",
      a: "For website or registration questions, contact Adrija at +370 628 76090. For training and booking questions, call or text Laura at +370 658 22872.",
    },
  ],
};

export function EquusHelpWidget() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showRegistrationChoice, setShowRegistrationChoice] = useState(false);
  const faqs = useMemo(() => FAQ_DATA[language], [language]);
  const lt = language === "lt";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("equus-help-position");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) setDragOffset({ x: parsed.x, y: parsed.y });
      }
    } catch {
      // Ignore malformed or missing saved widget position.
    }
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const x = Math.max(-240, Math.min(240, drag.baseX + event.clientX - drag.startX));
      const y = Math.max(-320, Math.min(320, drag.baseY + event.clientY - drag.startY));
      setDragOffset({ x, y });
    };
    const end = () => { setIsDragging(false); dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [isDragging]);

  useEffect(() => {
    if (!isDragging) {
      try {
        window.localStorage.setItem("equus-help-position", JSON.stringify(dragOffset));
      } catch {
        // Ignore storage failures (for example, private browsing restrictions).
      }
    }
  }, [dragOffset, isDragging]);

  const startDrag = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: dragOffset.x, baseY: dragOffset.y };
    setIsDragging(true);
  };

  const handleRegistrationChoice = (isNewClient: boolean) => {
    setIsOpen(false);
    setShowRegistrationChoice(false);
    navigate(isNewClient ? "/registracija" : "/grafikas");
  };

  const contactButtons = [
    {
      href: EQUUS_MESSENGER_URL,
      title: lt ? "Bendri klausimai" : "General questions",
      subtitle: lt ? "Equus Jojimo Mokykla · Messenger" : "Equus Jojimo Mokykla · Messenger",
    },
    {
      href: ADRIJA_MESSENGER_URL,
      title: lt ? "Svetainės problemos ar kiti klausimai" : "Website problems or other questions",
      subtitle: lt ? "Adrija Kalikaitė · Messenger" : "Adrija Kalikaitė · Messenger",
    },
  ];

  return (
    <>
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: 16 }}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            onClick={() => { if (!isDragging) setIsOpen(true); }}
            onPointerDown={startDrag}
            aria-label={lt ? "Klausimai — galima perkelti" : "Questions — draggable"}
            style={{ transform: "translate(" + dragOffset.x + "px, " + dragOffset.y + "px)", touchAction: "none" }}
            className="fixed bottom-24 sm:bottom-6 right-4 sm:right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-gold flex items-center justify-center border border-gold/30 overflow-hidden"
          >
            <motion.span
              animate={{ rotate: [0, -8, 8, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3 }}
              className="relative z-10"
            >
              <MessageCircle size={26} />
            </motion.span>
            <motion.span
              className="absolute inset-0 rounded-full border border-gold/40"
              animate={{ scale: [1, 1.28], opacity: [0.45, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            style={{ transform: "translate(" + dragOffset.x + "px, " + dragOffset.y + "px)" }}
            className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 flex h-[min(34rem,calc(100dvh-7rem))] max-h-[calc(100dvh-7rem)] w-[calc(100vw-2rem)] max-w-[22rem] flex-col bg-card text-card-foreground rounded-2xl shadow-elegant border border-border/70 overflow-hidden backdrop-blur-xl"
          >
            <div className="relative overflow-hidden bg-gradient-gold p-4 text-gold-foreground">
              <motion.div
                className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/10"
                animate={{ scale: [1, 1.12, 1], rotate: [0, 8, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <motion.div
                    initial={{ rotate: -8 }}
                    animate={{ rotate: [0, -5, 5, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 2 }}
                    className="h-9 w-9 rounded-full bg-background/20 border border-white/20 flex items-center justify-center text-lg"
                  >
                    🐴
                  </motion.div>
                  <div>
                    <div className="font-semibold leading-tight">{lt ? "Klausimai?" : "Questions?"}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{lt ? "Tempkite langą" : "Drag to move"}</div>
                    <div className="text-[11px] opacity-80 flex items-center gap-1 mt-0.5">
                      <Sparkles size={11} /> {lt ? "Parašykite mums" : "Write to us"}
                    </div>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setIsOpen(false)}
                  aria-label={lt ? "Uždaryti" : "Close"}
                  className="rounded-full p-1.5 hover:bg-white/10 transition-colors"
                >
                  <X size={19} />
                </motion.button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-3 bg-background/35 overscroll-contain">
              <div className="flex flex-col gap-2">
                {contactButtons.map((item) => (
                  <motion.a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    whileHover={{ y: -1, scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-3 rounded-xl border border-gold/25 bg-gold/10 px-3 py-2.5 hover:bg-gold/15 transition-colors"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <MessageCircle size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-snug">{item.title}</span>
                      <span className="block text-[11px] text-muted-foreground">{item.subtitle}</span>
                    </span>
                    <ExternalLink size={14} className="shrink-0 text-muted-foreground" />
                  </motion.a>
                ))}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="px-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {lt ? "Dažniausi klausimai" : "Common questions"}
                </div>
                {faqs.map((faq, index) => {
                  const expanded = openFaq === index;
                  return (
                    <div key={faq.q} className="rounded-xl border border-border/60 bg-card">
                      <button
                        type="button"
                        onClick={() => setOpenFaq(expanded ? null : index)}
                        aria-expanded={expanded}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
                      >
                        <span className="min-w-0 break-words">{faq.q}</span>
                        <ChevronDown size={15} className={"shrink-0 text-gold transition-transform " + (expanded ? "rotate-180" : "")} />
                      </button>
                      <AnimatePresence initial={false}>
                        {expanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <p className="px-3 pb-3 text-[13px] leading-relaxed text-muted-foreground">{faq.a}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 bg-card border-t border-border/70 flex flex-col gap-2">
              <motion.button
                whileHover={{ y: -1, scale: 1.01 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowRegistrationChoice((v) => !v)}
                className="flex min-w-0 items-center gap-1.5 rounded-xl border border-gold/15 bg-gold/5 px-2.5 py-2 text-left text-[11px] font-medium hover:bg-gold/10"
              >
                <CalendarDays size={13} className="shrink-0 text-gold" />
                <span className="min-w-0 break-words">{lt ? "Noriu registruotis" : "I want to register"}</span>
              </motion.button>

              {showRegistrationChoice && (
                <div className="grid grid-cols-2 gap-1.5">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleRegistrationChoice(true)}
                    className="rounded-xl border border-gold/20 bg-gold/5 px-2.5 py-2 text-[11px] font-medium hover:bg-gold/10"
                  >
                    {lt ? "Taip, naujas klientas" : "Yes, new client"}
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleRegistrationChoice(false)}
                    className="rounded-xl border border-border/60 bg-muted px-2.5 py-2 text-[11px] font-medium hover:bg-accent"
                  >
                    {lt ? "Ne, jau klientas" : "No, existing client"}
                  </motion.button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-border/60">
                <motion.a href="https://maps.app.goo.gl/Tjd1rUUVSabq52ip6" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors">
                  <MapPin size={13} /> {lt ? "Kaip atvykti" : "Directions"}
                </motion.a>
                <motion.a href="tel:+37065822872" className="flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors">
                  <Phone size={13} /> {lt ? "Laura · skambinti" : "Call Laura"}
                </motion.a>
                <motion.a href="sms:+37065822872" className="flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors">
                  <MessageSquare size={13} /> {lt ? "Laura · SMS" : "Text Laura"}
                </motion.a>
                <motion.a href="sms:+37062876090" className="flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors">
                  <MessageSquare size={13} /> {lt ? "Adrija · SMS" : "Text Adrija"}
                </motion.a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
