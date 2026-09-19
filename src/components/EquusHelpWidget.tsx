import React, { useMemo, useState } from "react";
import { MessageCircle, X, MapPin, Phone, MessageSquare, Send } from "lucide-react";
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

export function EquusHelpWidget() {
  const { language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<HelpMessage[]>([
    {
      type: "bot",
      text: language === "lt" ? "Sveiki! Kaip galiu padėti?" : "Hi! How can I help?",
    },
  ]);

  const faqs = useMemo(() => FAQ_DATA[language], [language]);

  const handleFAQClick = (faq: { q: string; a: string }) => {
    setMessages((prev) => [
      ...prev,
      { type: "user", text: faq.q },
      { type: "bot", text: faq.a },
    ]);
  };

  const handleSubmit = () => {
    const value = input.trim();
    if (!value) return;

    setMessages((prev) => [
      ...prev,
      { type: "user", text: value },
      { type: "bot", text: answerForInput(value, language) },
    ]);
    setInput("");
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label={language === "lt" ? "Equus pagalba" : "Equus help"}
        className="fixed bottom-6 right-4 sm:right-6 p-4 bg-amber-700 text-white rounded-full shadow-lg hover:bg-amber-800 transition-all z-50"
      >
        <MessageCircle size={28} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 sm:right-6 w-[calc(100vw-2rem)] max-w-sm bg-background rounded-xl shadow-2xl border border-gold/20 z-50 flex flex-col overflow-hidden">
      <div className="bg-amber-700 text-white p-4 flex justify-between items-center">
        <span className="font-semibold flex items-center gap-2">🐴 Equus pagalba</span>
        <button onClick={() => setIsOpen(false)} aria-label="Uždaryti">
          <X size={20} />
        </button>
      </div>

      <div className="p-4 h-80 overflow-y-auto flex flex-col gap-3 bg-background/80">
        {messages.map((msg, idx) => (
          <div
            key={`${idx}-${msg.type}`}
            className={`p-3 rounded-lg max-w-[88%] text-sm ${
              msg.type === "bot"
                ? "bg-card border border-gold/10 self-start"
                : "bg-gold/10 text-foreground self-end"
            }`}
          >
            {msg.text}
          </div>
        ))}
      </div>

      <div className="p-3 bg-background border-t border-gold/10 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {faqs.map((faq) => (
            <button
              key={faq.q}
              onClick={() => handleFAQClick(faq)}
              className="text-xs bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-full text-left transition-colors"
            >
              {faq.q}
            </button>
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
            className="min-w-0 flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-gold/50"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="h-9 w-9 shrink-0 rounded-md bg-gold text-background flex items-center justify-center disabled:opacity-40"
            aria-label={language === "lt" ? "Siųsti" : "Send"}
          >
            <Send size={15} />
          </button>
        </div>

        <div className="flex gap-2 mt-1 pt-2 border-t border-gold/10">
          <a
            href="https://maps.app.goo.gl/Tjd1rUUVSabq52ip6"
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100"
          >
            <MapPin size={14} /> {language === "lt" ? "Kaip atvykti" : "Directions"}
          </a>
          <a
            href="https://wa.me/37062876090"
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-green-50 text-green-700 rounded-md hover:bg-green-100"
          >
            <MessageSquare size={14} /> WhatsApp
          </a>
          <a
            href="tel:+37062876090"
            className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-amber-50 text-amber-700 rounded-md hover:bg-amber-100"
          >
            <Phone size={14} /> {language === "lt" ? "Skambinti" : "Call"}
          </a>
        </div>
      </div>
    </div>
  );
}
