import { createContext, ReactNode, useContext, useEffect, useState } from "react";

export type EquusLanguage = "lt" | "en";

const STORAGE_KEY = "equus_language";

type Dictionary = Record<string, { lt: string; en: string }>;

const dictionary: Dictionary = {
  menu: { lt: "Meniu", en: "Menu" },
  home: { lt: "Pradžia", en: "Home" },
  schedule: { lt: "Grafikas", en: "Schedule" },
  prices: { lt: "Kainos", en: "Prices" },
  information: { lt: "Informacija", en: "Information" },
  account: { lt: "Paskyra", en: "Account" },
  admin: { lt: "Admin", en: "Admin" },
  trainerArea: { lt: "Trenerio sritis", en: "Trainer area" },
  appearance: { lt: "Svetainės išvaizda", en: "Website appearance" },
  appearanceHint: { lt: "Sezonas, šviesumas ir spalvos", en: "Season, brightness and colours" },
  language: { lt: "Kalba", en: "Language" },
  signedInAs: { lt: "Prisijungta kaip", en: "Signed in as" },
  activeProfile: { lt: "Aktyvus profilis", en: "Active profile" },
  me: { lt: "Aš", en: "Me" },
  signOut: { lt: "Atsijungti", en: "Sign out" },
  signIn: { lt: "Prisijungti", en: "Sign in" },
  register: { lt: "Registruotis", en: "Register" },
  school: { lt: "Equus jojimo mokykla", en: "Equus Riding School" },
  rights: { lt: "Visos teisės saugomos.", en: "All rights reserved." },
  previousWeek: { lt: "Praėjusi savaitė", en: "Previous week" },
  nextWeek: { lt: "Kita savaitė", en: "Next week" },
  today: { lt: "Šiandien", en: "Today" },
  horseFreedom: { lt: "Mylintiems žirgus ir laisvę", en: "For those who love horses and freedom" },
  signInPromptA: { lt: "Prisijunkite", en: "Sign in" },
  signInPromptB: { lt: "arba", en: "or" },
  signInPromptC: { lt: "susikurkite paskyrą", en: "create an account" },
  signInPromptD: { lt: "norėdami registruotis į pamokas.", en: "to book riding lessons." },
  weekView: { lt: "Savaitė", en: "Week" },
  listView: { lt: "Sąrašas", en: "List" },
  noLessons: { lt: "Treniruočių nėra", en: "No lessons" },
  individual: { lt: "Individualus", en: "Individual lessons" },
  lessonsCancelled: { lt: "Treniruotės nevyksta", en: "Lessons cancelled" },
  video: { lt: "Video", en: "Video" },
  newTime: { lt: "Naujas laikas", en: "New time" },
  dayMessage: { lt: "Dienos žinutė", en: "Day message" },
  editMessage: { lt: "Redaguoti žinutę", en: "Edit message" },
  cancelDay: { lt: "Atšaukti dieną", en: "Cancel day" },
};

interface LanguageContextValue {
  language: EquusLanguage;
  setLanguage: (language: EquusLanguage) => void;
  t: (key: keyof typeof dictionary) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function initialLanguage(): EquusLanguage {
  if (typeof window === "undefined") return "lt";

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "lt" || saved === "en") return saved;

  return navigator.language.toLowerCase().startsWith("lt") ? "lt" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<EquusLanguage>(initialLanguage);

  const setLanguage = (next: EquusLanguage) => {
    setLanguageState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: keyof typeof dictionary) => dictionary[key][language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}
