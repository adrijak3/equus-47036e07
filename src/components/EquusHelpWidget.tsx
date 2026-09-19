import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X, MapPin, Phone, MessageSquare, Send, Sparkles } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

type HelpMessage = {
  type: "bot" | "user";
  text: string;
};

const FAQ_DATA = {
  lt: [
    {
      q: "Kainos ir pamokos",
      a: "Kainas rasite „Kainos“ skiltyje. Jei nežinote, kuri treniruotė jums tinka, parašykite, ko ieškote, ir pateiksiu informaciją",
    },
    {
      q: "Kaip užsiregistruoti?",
      a: "Prisijunkite arba susikurkite paskyrą, atsidarykite „Grafikas“, pasirinkite laisvą treniruotę ir spauskite „Registruotis“. Vieša registracija uždaroma likus mažiau nei 3 valandoms iki treniruotės.",
    },
    {
      q: "Kaip atšaukti treniruotę?",
      a: "Grafike prie savo treniruotės pasirinkite atšaukimo mygtuką ir atlikite nurodytus veiksmus. Jei iki treniruotės liko mažiau nei 3 valandos, susisiekite su Equus.",
    },
    {
      q: "Kaip perkelti treniruotę?",
      a: "Grafike prie savo treniruotės pasirinkite perkėlimo mygtuką. Galima pasirinkti kitą laisvą laiką tą pačią dieną. Rankiniu būdu laiko įvesti nereikia.",
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
      a: "Dėl svetainės ar treniruočių informacijos galite skambinti +370 628 76090 arba parašyti per WhatsApp. Taip pat galite susisiekti su Laura telefonu +370 658 22872.",
    },
  ],
  en: [
    {
      q: "Prices and lessons",
      a: "Prices are listed in the “Prices” section. If you are unsure which lesson is right for you, tell me what you are looking for and I will use the Equus FAQ information.",
    },
    {
      q: "How do I register?",
      a: "Sign in or create an account, open “Schedule”, choose an available training slot and press “Register”. Public registration closes less than 3 hours before training.",
    },
    {
      q: "How do I cancel?",
      a: "In the Schedule, use the cancellation action on your training and follow the instructions. If less than 3 hours remain, contact Equus.",
    },
    {
      q: "How do I move a training?",
      a: "In the Schedule, use the move action on your training. You can choose another available time on the same day. No manual time entry is needed.",
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
      a: "For website or training information, call +370 628 76090 or use WhatsApp. You can also contact Laura at +370 658 22872.",
    },
  ],
};

function answerForInput(input: string, language: "lt" | "en") {
  const text = input.toLowerCase();
  const faqs = FAQ_DATA[language];
  const matches = (words: string[]) => words.some((word) => text.includes(word));

  if (matches(["kain", "price", "lesson", "pamok", "treniruot"])) return faqs[0].a;
  if (matches(["registr", "register", "sign up", "signup"])) return faqs[1].a;
  if (matches(["atšauk", "atsauk", "cancel"])) return faqs[2].a;
  if (matches(["perkelt", "perkel", "move"])) return faqs[3].a;
  if (matches(["kur", "viet", "address", "where", "location"])) return faqs[4].a;
  if (matches(["amž", "amzi", "age", "vaik", "child"])) return faqs[5].a;
  if (matches(["kontakt", "phone", "telefon", "whatsapp", "contact"])) return faqs[6].a;

  return language === "lt"
    ? "Į šį klausimą tiksliai atsakyti negaliu. Susisiekite su Equus."
    : "I cannot answer this exactly. Please contact Equus.";
}

const responseDelay = 650;

export function EquusHelpWidget() {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>([
    {
      type: "bot",
      text: language === "lt" ? "Sveiki! Kaip galiu padėti?" : "Hi! How can I help?",
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const faqs = useMemo(() => FAQ_DATA[language], [language]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const sendBotReply = (answer: string) => {
    setIsTyping(true);
    window.setTimeout(() => {
      setMessages((prev) => [...prev, { type: "bot", text: answer }]);
      setIsTyping(false);
    }, responseDelay);
  };

  const handleFAQClick = (faq: { q: string; a: string }) => {
    if (isTyping) return;
    setMessages((prev) => [...prev, { type: "user", text: faq.q }]);
    sendBotReply(faq.a);
  };

  const handleSubmit = () => {
    const value = input.trim();
    if (!value || isTyping) return;

    setMessages((prev) => [...prev, { type: "user", text: value }]);
    setInput("");
    sendBotReply(answerForInput(value, language));
  };

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
            onClick={() => setIsOpen(true)}
            aria-label={language === "lt" ? "Equus pagalba" : "Equus help"}
            className="fixed bottom-6 right-4 sm:right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-gold flex items-center justify-center border border-gold/30 overflow-hidden"
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
            className="fixed bottom-4 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] max-w-sm bg-card text-card-foreground rounded-2xl shadow-elegant border border-border/70 overflow-hidden backdrop-blur-xl"
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
                    <div className="font-semibold leading-tight">Equus pagalba</div>
                    <div className="text-[11px] opacity-80 flex items-center gap-1 mt-0.5">
                      <Sparkles size={11} /> {language === "lt" ? "Greita pagalba" : "Quick help"}
                    </div>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsOpen(false)}
                  aria-label={language === "lt" ? "Uždaryti" : "Close"}
                  className="rounded-full p-1.5 hover:bg-white/10 transition-colors"
                >
                  <X size={19} />
                </motion.button>
              </div>
            </div>

            <div className="p-4 h-80 overflow-y-auto flex flex-col gap-3 bg-background/35">
              <AnimatePresence initial={false} mode="popLayout">
                {messages.map((msg, idx) => (
                  <motion.div
                    key={`${idx}-${msg.type}`}
                    initial={{ opacity: 0, y: 10, scale: 0.96, x: msg.type === "user" ? 12 : -12 }}
                    animate={{ opacity: 1, y: 0, scale: 1, x: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 28 }}
                    className={`p-3 rounded-2xl max-w-[88%] text-sm leading-relaxed shadow-sm ${
                      msg.type === "bot"
                        ? "bg-card border border-border/70 self-start rounded-bl-md"
                        : "bg-primary text-primary-foreground self-end rounded-br-md"
                    }`}
                  >
                    {msg.text}
                  </motion.div>
                ))}
              </AnimatePresence>

              <AnimatePresence>
                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="self-start rounded-2xl rounded-bl-md bg-card border border-border/70 px-4 py-3 shadow-sm"
                    aria-label={language === "lt" ? "Rašoma" : "Typing"}
                  >
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2].map((dot) => (
                        <motion.span
                          key={dot}
                          className="h-1.5 w-1.5 rounded-full bg-primary"
                          animate={{ y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
                          transition={{ duration: 0.8, repeat: Infinity, delay: dot * 0.14 }}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-card border-t border-border/70 flex flex-col gap-2.5">
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {faqs.map((faq) => (
                  <motion.button
                    key={faq.q}
                    whileHover={{ y: -1, scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleFAQClick(faq)}
                    disabled={isTyping}
                    className="text-xs bg-muted hover:bg-accent border border-border/50 px-3 py-1.5 rounded-full text-left transition-colors disabled:opacity-50"
                  >
                    {faq.q}
                  </motion.button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                  }}
                  placeholder={language === "lt" ? "Parašykite klausimą…" : "Ask a question…"}
                  disabled={isTyping}
                  className="min-w-0 flex-1 h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 transition-all disabled:opacity-60"
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={handleSubmit}
                  disabled={!input.trim() || isTyping}
                  className="h-10 w-10 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm disabled:opacity-40 transition-opacity"
                  aria-label={language === "lt" ? "Siųsti" : "Send"}
                >
                  <Send size={15} />
                </motion.button>
              </div>

              <div className="flex gap-1.5 pt-2 border-t border-border/60">
                <motion.a
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  href="https://maps.app.goo.gl/Tjd1rUUVSabq52ip6"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors"
                >
                  <MapPin size={13} /> {language === "lt" ? "Kaip atvykti" : "Directions"}
                </motion.a>
                <motion.a
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  href="https://wa.me/37062876090"
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors"
                >
                  <MessageSquare size={13} /> WhatsApp
                </motion.a>
                <motion.a
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  href="tel:+37062876090"
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-2 bg-muted hover:bg-accent text-foreground rounded-lg border border-border/50 transition-colors"
                >
                  <Phone size={13} /> {language === "lt" ? "Skambinti" : "Call"}
                </motion.a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
