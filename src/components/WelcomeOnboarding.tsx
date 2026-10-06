import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Heart,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import horseHead from "./equus-head-transparent.png";

const ONBOARDING_VERSION = 2;

const RULES = [
  {
    key: "subscription",
    icon: Tag,
    title: "Abonementas",
    teaser: "4, 8 ar 12 treniruočių viename pakete.",
    body: "Abonementas galioja 30 dienų nuo jo įsigijimo datos. Jo treniruotės naudojamos pagal pasirinktą abonemento tipą ir gali būti skirtos vienam arba dviem raiteliams. Jei abonemento neturite, nuo 2026-10-18 galite turėti vieną būsimą įprastą rezervaciją be abonemento.",
  },
  {
    key: "booking",
    icon: CalendarDays,
    title: "Rezervacija",
    teaser: "Pasirinkite laiką grafike ir registruokitės.",
    body: "Grafike matysite laisvas vietas. Rezervuojant galite pasirinkti ir kartu lankantį raitelį. Jei turite 2 žmonėms skirtą abonementą, viena bendra rezervacija gali sunaudoti dvi abonemento treniruotes.",
  },
  {
    key: "cancel",
    icon: XCircle,
    title: "Atšaukimas",
    teaser: "Iki 24 val. prieš treniruotę – be praradimo.",
    body: "Treniruotę galima atšaukti nemokamai ne vėliau kaip 24 valandas prieš pradžią. Vėliau atšaukta arba praleista treniruotė paprastai laikoma panaudota, išskyrus ligos ar force majeure atvejus.",
  },
  {
    key: "family",
    icon: Heart,
    title: "Kartu lankantis raitelis",
    teaser: "Vaiką ar kitą artimą raitelį galite turėti savo paskyroje.",
    body: "Kartu lankantis raitelis neturi atskiro prisijungimo. Rezervuojant galite jį pridėti kartu, o atšaukus vieną rezervaciją kito raitelio rezervacija lieka nepakeista.",
  },
  {
    key: "contract",
    icon: FileText,
    title: "Sutartis ir saugumas",
    teaser: "Prieš pirmą treniruotę – pasirašyta sutartis.",
    body: "Prieš pirmąją treniruotę būtina pasirašyti jojimo paslaugų sutartį. Laikykitės trenerio nurodymų, žirgyno taisyklių ir atvykite su tinkama apranga bei avalyne.",
  },
] as const;

const GUIDE = [
  {
    title: "1 · Pasirinkite laiką",
    description: "Grafike paspauskite norimą dieną ir treniruotės laiką.",
    icon: CalendarDays,
    mock: "schedule",
  },
  {
    title: "2 · Patvirtinkite raitelį",
    description: "Galite rezervuoti tik save arba pridėti kartu lankantį raitelį.",
    icon: UserRound,
    mock: "rider",
  },
  {
    title: "3 · Atšaukite, kai reikia",
    description: "Atidarykite savo rezervaciją ir pasirinkite atšaukimo veiksmą.",
    icon: Clock3,
    mock: "cancel",
  },
] as const;

export function WelcomeOnboarding() {
  const { user, isAdmin, profile, loading: authLoading, refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);

  const [completionName, setCompletionName] = useState("");
  const [completionPhone, setCompletionPhone] = useState("+370");
  const [completionExperience, setCompletionExperience] = useState("");
  const [completionParentPhone, setCompletionParentPhone] = useState(false);
  const [saving, setSaving] = useState(false);

  const [readToEnd, setReadToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [rulesViewed, setRulesViewed] = useState<Set<string>>(new Set());
  const [expandedRule, setExpandedRule] = useState<string | null>(RULES[0].key);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || authLoading || isAdmin) return;

    let cancelled = false;

    const load = async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select(
          "onboarding_accepted_at,onboarding_version,full_name,phone,experience_text,phone_is_parent",
        )
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Equus onboarding profile load failed", error);
        return;
      }

      let profileData = data;

      if (!profileData) {
        const meta = (user.user_metadata || {}) as Record<string, unknown>;
        const fallbackName = String(meta.full_name || "").trim();
        const fallbackPhone = String(meta.phone || "").trim();
        const fallbackExperience = String(meta.experience_text || "").trim();

        const { error: insertError } = await (supabase as any)
          .from("profiles")
          .upsert(
            {
              id: user.id,
              full_name:
                fallbackName ||
                ((user.email || "").split("@")[0] || "Equus klientas"),
              phone: fallbackPhone || null,
              experience_text: fallbackExperience || null,
              phone_is_parent: meta.phone_is_parent === true,
            },
            { onConflict: "id" },
          );

        if (cancelled) return;

        if (insertError) {
          console.error("Equus onboarding profile create failed", insertError);
          toast.error("Nepavyko paruošti jūsų Equus profilio.");
          return;
        }

        const refreshed = await (supabase as any)
          .from("profiles")
          .select(
            "onboarding_accepted_at,onboarding_version,full_name,phone,experience_text,phone_is_parent",
          )
          .eq("id", user.id)
          .maybeSingle();

        if (cancelled) return;

        if (refreshed.error || !refreshed.data) {
          console.error(
            "Equus onboarding profile reload failed",
            refreshed.error,
          );
          return;
        }

        profileData = refreshed.data;
      }

      const savedName = String(
        profileData?.full_name || profile?.full_name || "",
      ).trim();
      const email = (user.email || "").trim().toLowerCase();
      const nameLooksLikeEmail =
        !!savedName && savedName.toLowerCase() === email;

      setCompletionName(nameLooksLikeEmail ? "" : savedName);
      setCompletionPhone(
        profileData?.phone ? String(profileData.phone) : "+370",
      );
      setCompletionExperience(profileData?.experience_text || "");
      setCompletionParentPhone(!!profileData?.phone_is_parent);

      const version = Number(profileData?.onboarding_version || 0);
      const needsOnboarding =
        !profileData?.onboarding_accepted_at || version < ONBOARDING_VERSION;

      if (!needsOnboarding) return;

      setStep(1);
      setReadToEnd(false);
      setAccepted(false);
      setRulesViewed(new Set());
      setExpandedRule(RULES[0].key);
      setOpen(true);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin, profile, authLoading]);

  const saveMainInfo = async () => {
    if (!user) return false;

    const cleanName = completionName.trim();
    const cleanPhone = completionPhone.trim();
    const cleanExperience = completionExperience.trim();

    if (cleanName.length < 2 || cleanName.includes("@")) {
      toast.error("Įveskite tikrą raitelio vardą ir pavardę.");
      return false;
    }

    if (cleanPhone.length < 6) {
      toast.error("Įveskite telefono numerį.");
      return false;
    }

    if (cleanExperience.length < 30) {
      toast.error("Aprašykite jojimo patirtį bent 30 simbolių.");
      return false;
    }

    setSaving(true);

    const { error } = await (supabase as any)
      .from("profiles")
      .update({
        full_name: cleanName,
        phone: cleanPhone,
        experience_text: cleanExperience,
        phone_is_parent: completionParentPhone,
      })
      .eq("id", user.id);

    setSaving(false);

    if (error) {
      toast.error("Nepavyko išsaugoti profilio.");
      return false;
    }

    await refreshProfile();
    return true;
  };

  const handleNext = async () => {
    if (step === 2) {
      if (!(await saveMainInfo())) return;
    }

    if (step === 5) {
      setStep(6);
      return;
    }

    setStep((current) => Math.min(6, current + 1));
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  };

  const handleBack = () => {
    setStep((current) => Math.max(1, current - 1));
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  };

  const markRuleViewed = (key: string) => {
    setRulesViewed((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  const atBottom = (el: HTMLDivElement) =>
    el.scrollTop + el.clientHeight >= el.scrollHeight - 40;

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && atBottom(el)) setReadToEnd(true);
  };

  useEffect(() => {
    if (!open || step !== 4) return;

    const check = () => {
      const el = scrollRef.current;
      if (el && atBottom(el)) setReadToEnd(true);
    };

    check();
    const timer = window.setInterval(check, 400);
    window.addEventListener("resize", check);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", check);
    };
  }, [open, step]);

  const canFinish =
    readToEnd && accepted && rulesViewed.size === RULES.length && !saving;

  const progressLabel = useMemo(
    () => `${step}/6`,
    [step],
  );

  const finish = async () => {
    if (!user || !canFinish) return;

    setSaving(true);

    const { error } = await (supabase as any)
      .from("profiles")
      .update({
        onboarding_accepted_at: new Date().toISOString(),
        onboarding_version: ONBOARDING_VERSION,
        rules_version: "2026-10",
      })
      .eq("id", user.id);

    if (error) {
      setSaving(false);
      toast.error("Nepavyko užbaigti pasveikinimo.");
      return;
    }

    await refreshProfile();
    setSaving(false);
    setOpen(false);
    toast.success("Sveiki atvykę į Equus 🐴");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={() => undefined}
    >
      <DialogContent
        className="grid h-[100dvh] max-h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-gold/30 bg-card p-0 sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100%-2rem)] sm:rounded-3xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-border bg-gradient-card px-4 py-4 pr-10 sm:px-7 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-gold/70">
                Equus · pasveikinimas
              </p>
              <DialogTitle className="mt-1 font-display text-2xl text-gradient-gold sm:text-3xl">
                Sveiki atvykę
              </DialogTitle>
            </div>
            <div className="rounded-full border border-gold/20 bg-background/30 px-3 py-1.5 text-xs text-muted-foreground">
              {progressLabel}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-6 gap-1.5" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className={cn(
                  "h-1.5 rounded-full transition-colors",
                  index + 1 <= step ? "bg-gold" : "bg-muted",
                )}
              />
            ))}
          </div>
        </DialogHeader>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-7"
        >
          {step === 1 && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex min-h-[54vh] flex-col items-center justify-center text-center"
            >
              <div className="relative mb-7 flex h-44 w-44 items-center justify-center sm:h-52 sm:w-52">
                <motion.div
                  className="absolute inset-0 rounded-full border border-gold/20 bg-gold/5"
                  animate={{ scale: [0.9, 1.04, 0.9], opacity: [0.35, 0.8, 0.35] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                  className="absolute inset-4 rounded-full border border-gold/15"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
                />
                <motion.img
                  src={horseHead}
                  alt="Equus"
                  className="relative z-10 h-36 w-36 object-contain drop-shadow-elegant sm:h-44 sm:w-44"
                  initial={{ opacity: 0, scale: 0.72, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <motion.p
                className="text-xs uppercase tracking-[0.34em] text-gold/65"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                Equus jojimo mokykla
              </motion.p>
              <motion.h2
                className="mt-3 max-w-xl font-display text-4xl text-gradient-gold sm:text-5xl"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
              >
                Čia prasideda jūsų kitas jojimo sezonas.
              </motion.h2>
              <motion.p
                className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground sm:text-base"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.75 }}
              >
                Keliose trumpose stotelėse parodysime, kaip naudotis Equus
                svetaine. Visą turinį galėsite laisvai slinkti ir peržiūrėti.
              </motion.p>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-2xl space-y-5"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gold/65">
                  02 · Paskyra
                </p>
                <h2 className="mt-2 font-display text-3xl text-gradient-gold">
                  Susipažinkime
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Šie duomenys naudojami rezervacijoms ir treneriui geriau
                  suprasti jūsų jojimo patirtį.
                </p>
              </div>

              <div className="grid gap-4 rounded-2xl border border-gold/15 bg-gradient-card p-5 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">El. paštas</label>
                  <Input
                    value={user?.email ?? ""}
                    readOnly
                    disabled
                    className="mt-1.5"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Šis adresas naudojamas prisijungimui.
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Telefonas</label>
                  <Input
                    type="tel"
                    value={completionPhone}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "");
                      setCompletionPhone(
                        digits.startsWith("370")
                          ? "+" + digits
                          : digits.startsWith("8")
                            ? "+370" + digits.slice(1)
                            : "+370" + digits,
                      );
                    }}
                    maxLength={20}
                    placeholder="+370 6…"
                    className="mt-1.5"
                  />
                  <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={completionParentPhone}
                      onChange={(event) =>
                        setCompletionParentPhone(event.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 accent-[hsl(var(--gold))]"
                    />
                    <span>
                      Tai tėvų / globėjo numeris
                      <span className="ml-1 text-gold/80">
                        (jei raitelis yra vaikas)
                      </span>
                    </span>
                  </label>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-sm font-medium">Vardas ir pavardė</label>
                  <Input
                    value={completionName}
                    onChange={(event) => setCompletionName(event.target.value)}
                    maxLength={80}
                    className="mt-1.5"
                    placeholder="Vardas Pavardė"
                  />
                </div>

                <div className="sm:col-span-2">
                  <div className="flex items-end justify-between gap-3">
                    <label className="text-sm font-medium">
                      Jojimo patirtis
                    </label>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        completionExperience.trim().length >= 30
                          ? "text-emerald-500"
                          : "text-muted-foreground",
                      )}
                    >
                      {completionExperience.length}/30 min.
                    </span>
                  </div>
                  <textarea
                    value={completionExperience}
                    onChange={(event) =>
                      setCompletionExperience(event.target.value)
                    }
                    minLength={30}
                    maxLength={500}
                    rows={6}
                    className="mt-1.5 flex w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none transition-colors focus:border-gold/50 focus:ring-1 focus:ring-gold/30"
                    placeholder="Pvz. kiek laiko jodinėjate, kokiose treniruotėse dalyvavote, ką mokate, ar turite varžybų patirties…"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Mažiausiai 30 simbolių. Galite parašyti ir daugiau.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="guide"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-3xl space-y-5"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gold/65">
                  03 · Rezervacijos
                </p>
                <h2 className="mt-2 font-display text-3xl text-gradient-gold">
                  Kaip veikia rezervacija?
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Trumpas vizualus gidas – panašiai atrodys pagrindiniai
                  veiksmai pačiame grafike.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {GUIDE.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <motion.div
                      key={item.mock}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.08 }}
                      className="overflow-hidden rounded-2xl border border-gold/15 bg-gradient-card"
                    >
                      <div className="border-b border-gold/10 bg-background/25 p-4">
                        <div className="mb-3 flex items-center gap-2 text-gold">
                          <Icon className="h-4 w-4" />
                          <span className="text-xs font-semibold uppercase tracking-[0.15em]">
                            {item.title}
                          </span>
                        </div>

                        <div className="relative h-36 overflow-hidden rounded-xl border border-gold/10 bg-background/55 p-3">
                          {item.mock === "schedule" && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-muted-foreground">
                                <span>Trečiadienis</span>
                                <span>18:45</span>
                              </div>
                              <div className="rounded-lg border border-gold/30 bg-gold/10 p-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold">Grupinė</span>
                                  <span className="text-[10px] text-gold">3 vietos</span>
                                </div>
                                <div className="mt-3 h-2 rounded-full bg-muted">
                                  <div className="h-2 w-2/5 rounded-full bg-gold/70" />
                                </div>
                              </div>
                              <div className="rounded-lg bg-gold px-3 py-2 text-center text-[10px] font-semibold text-gold-foreground">
                                Registruotis
                              </div>
                            </div>
                          )}

                          {item.mock === "rider" && (
                            <div className="space-y-2">
                              <div className="rounded-lg border border-gold/20 bg-background/50 p-3">
                                <p className="text-[9px] uppercase tracking-widest text-muted-foreground">
                                  Raitelis
                                </p>
                                <p className="mt-1 text-xs font-semibold">Aistė</p>
                              </div>
                              <div className="rounded-lg border border-gold/30 bg-gold/10 p-3">
                                <div className="flex items-center gap-2">
                                  <Check className="h-3.5 w-3.5 text-gold" />
                                  <span className="text-xs font-semibold">+ Emilija</span>
                                </div>
                                <p className="mt-1 text-[9px] text-muted-foreground">
                                  Kartu lankantis raitelis
                                </p>
                              </div>
                              <div className="text-center text-[9px] text-gold">
                                Viena rezervacija · du raiteliai
                              </div>
                            </div>
                          )}

                          {item.mock === "cancel" && (
                            <div className="space-y-2">
                              <div className="rounded-lg border border-gold/15 bg-background/50 p-3">
                                <p className="text-xs font-semibold">18:45 · Grupinė</p>
                                <div className="mt-2 text-[9px] text-muted-foreground">
                                  Aistė · Emilija
                                </div>
                              </div>
                              <div className="rounded-lg border border-blush/20 bg-blush/5 p-3">
                                <div className="flex items-center gap-2 text-blush">
                                  <XCircle className="h-3.5 w-3.5" />
                                  <span className="text-[10px] font-semibold">
                                    Atšaukti pasirinktą raitelį
                                  </span>
                                </div>
                                <p className="mt-1 text-[9px] text-muted-foreground">
                                  Kito raitelio rezervacija lieka.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-4">
                        <p className="text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-gold/15 bg-gold/5 p-4 text-sm leading-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                  <div>
                    <p className="font-semibold">Maža taisyklė, kurią verta žinoti</p>
                    <p className="mt-1 text-muted-foreground">
                      Vienas žmogus gali turėti vieną aktyvią rezervaciją konkrečiam
                      laikui. Kartu lankantys raiteliai turi atskiras rezervacijas,
                      todėl vieno atšaukimas automatiškai neatšaukia kito.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="rules"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-3xl space-y-5"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gold/65">
                  04 · Taisyklės
                </p>
                <h2 className="mt-2 font-display text-3xl text-gradient-gold">
                  Abonementai ir svarbiausia
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Spustelėkite korteles – jos išsiskleidžia ir parodo esmę.
                  Apačioje yra nuoroda į pilną taisyklių puslapį.
                </p>
              </div>

              <div className="space-y-3">
                {RULES.map((rule, index) => {
                  const Icon = rule.icon;
                  const expanded = expandedRule === rule.key;
                  const viewed = rulesViewed.has(rule.key);

                  return (
                    <motion.button
                      key={rule.key}
                      type="button"
                      onClick={() => {
                        markRuleViewed(rule.key);
                        setExpandedRule(expanded ? null : rule.key);
                      }}
                      whileTap={{ scale: 0.995 }}
                      className={cn(
                        "w-full overflow-hidden rounded-2xl border text-left transition-colors",
                        expanded
                          ? "border-gold/40 bg-gold/5"
                          : "border-gold/15 bg-gradient-card hover:border-gold/30",
                      )}
                    >
                      <div className="flex items-center gap-3 p-4 sm:p-5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gold/20 bg-gold/10 text-gold">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold">{rule.title}</p>
                            {viewed && (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {rule.teaser}
                          </p>
                        </div>
                        <ChevronDown
                          className={cn(
                            "h-5 w-5 shrink-0 text-gold transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </div>

                      {expanded && (
                        <div className="border-t border-gold/10 px-4 pb-5 pt-4 sm:px-5">
                          <p className="text-sm leading-7 text-foreground/85">
                            {rule.body}
                          </p>
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-gold/15 bg-background/25 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">Pilnos taisyklės</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Atidaroma atskirame puslapyje, kad galėtumėte ramiai
                      perskaityti visą teisinį tekstą.
                    </p>
                  </div>
                  <Link
                    to="/taisykles"
                    target="_blank"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gold underline underline-offset-4"
                  >
                    Skaityti
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              <div className="min-h-16 pt-5 text-center text-xs text-muted-foreground">
                {readToEnd ? (
                  <span className="inline-flex items-center gap-1 text-emerald-500">
                    <CheckCircle2 className="h-4 w-4" />
                    Pasiekėte taisyklių apačią
                  </span>
                ) : (
                  "Slinkite iki pat apačios, tada galėsite patvirtinti taisykles."
                )}
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div
              key="theme"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-3xl space-y-5"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gold/65">
                  05 · Išvaizda
                </p>
                <h2 className="mt-2 font-display text-3xl text-gradient-gold">
                  Pasirinkite savo Equus nuotaiką
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Temą ir šviesumą vėliau galėsite pakeisti paskyroje.
                </p>
              </div>

              <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4 sm:p-5">
                <ThemeSwitcher />
              </div>
            </motion.div>
          )}

          {step === 6 && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.98, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="flex min-h-[52vh] flex-col items-center justify-center text-center"
            >
              <motion.div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-gold shadow-gold"
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <Sparkles className="h-9 w-9" />
              </motion.div>
              <p className="mt-6 text-xs uppercase tracking-[0.24em] text-gold/65">
                Viskas paruošta
              </p>
              <h2 className="mt-2 max-w-xl font-display text-4xl text-gradient-gold sm:text-5xl">
                Susitiksime manieže. 🐴
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
                Jūsų profilis, taisyklės ir pasirinkta tema išsaugoti. Toliau
                galite tiesiog pereiti į grafiką ir pasirinkti treniruotę.
              </p>
              <div className="mt-7 grid w-full max-w-md gap-2 sm:grid-cols-3">
                {[
                  ["Profilis", "✓"],
                  ["Taisyklės", "✓"],
                  ["Tema", "✓"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-gold/15 bg-gradient-card px-3 py-3"
                  >
                    <div className="text-sm text-emerald-500">{value}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        <div className="border-t border-border bg-card px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-7">
          {step === 4 && (
            <label
              className={cn(
                "mb-3 flex items-start gap-3 rounded-2xl border p-3.5 transition-opacity",
                !readToEnd || rulesViewed.size !== RULES.length
                  ? "border-border opacity-55"
                  : "border-gold/30 bg-gold/5",
              )}
            >
              <Checkbox
                checked={accepted}
                disabled={!(readToEnd && rulesViewed.size === RULES.length)}
                onCheckedChange={(value) => setAccepted(value === true)}
              />
              <span className="text-sm leading-6">
                Susipažinau su svarbiausiomis Equus taisyklėmis ir pilnomis
                sąlygomis.
              </span>
            </label>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              disabled={step === 1 || saving}
              onClick={handleBack}
            >
              <ChevronLeft className="h-4 w-4" />
              Atgal
            </Button>

            {step < 4 && (
              <Button variant="gold" onClick={handleNext} disabled={saving}>
                {step === 2 && saving ? "Saugoma…" : "Toliau"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}

            {step === 4 && (
              <Button
                variant="gold"
                onClick={handleNext}
                disabled={!accepted || !readToEnd || rulesViewed.size !== RULES.length}
              >
                Toliau
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}

            {step === 5 && (
              <Button variant="gold" onClick={handleNext}>
                Baigti
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}

            {step === 6 && (
              <Button variant="gold" onClick={finish} disabled={saving}>
                {saving ? "Išsaugoma…" : "Į Equus"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}