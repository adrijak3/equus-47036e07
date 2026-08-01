import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Baby,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LEVELS = [
  {
    value: "beginner",
    title: "Pradedantysis",
    text: "Niekada nejojo arba jojo tik 1–2 kartus pramogai. Savarankiškai dar nejoja risčia.",
  },
  {
    value: "intermediate",
    title: "Vidutiniškai pažengęs",
    text: "Yra jojęs anksčiau, savarankiškai joja risčia, yra bandęs zovaduoti ir šokti nedidelius šuolius.",
  },
  {
    value: "advanced",
    title: "Pažengęs",
    text: "Savarankiškai balnoja žirgą, užtikrintai joja visais aliūrais, šokinėja ir/ar yra dalyvavęs varžybose.",
  },
] as const;

const SERVICES = [
  {
    value: "mazylio_30",
    title: "Mažylio svajonė · 30 min.",
    description: "Žirgą veda tėvai arba lydintis suaugęs asmuo.",
    price: 20,
    duration: 30,
    minAge: 3,
    icon: Baby,
  },
  {
    value: "mazylio_45",
    title: "Mažylio svajonė · 45 min.",
    description: "Užsiėmimą ir žirgą veda treneris.",
    price: 35,
    duration: 45,
    minAge: 3,
    icon: Sparkles,
  },
  {
    value: "sportine",
    title: "Sportinė jojimo treniruotė",
    description: "Porinė arba grupinė treniruotė. Minimalus amžius – 10 metų.",
    price: 35,
    duration: 45,
    minAge: 10,
    icon: Users,
  },
] as const;

type Level = (typeof LEVELS)[number]["value"];
type Service = (typeof SERVICES)[number]["value"];
type Slot = {
  slot_date: string;
  slot_time: string;
  max_capacity: number;
  active_count: number;
  lesson_type: string;
};

export default function PublicRegistration() {
  const { token } = useParams();
  const [step, setStep] = useState(1);
  const [service, setService] = useState<Service | "">("");
  const [level, setLevel] = useState<Level | "">("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    age: "",
    emergency: "",
    experienceNotes: "",
    preferredTimes: "",
    facebookName: "",
  });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [rules, setRules] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [existing, setExisting] = useState<any>(null);

  const selectedService = useMemo(
    () => SERVICES.find((item) => item.value === service),
    [service],
  );

  useEffect(() => {
    if (!token) return;
    void (async () => {
      const { data } = await (supabase as any).rpc(
        "get_public_registration_request",
        { _token: token },
      );
      setExisting(Array.isArray(data) ? data[0] : data);
    })();
  }, [token]);

  useEffect(() => {
    setSelected(null);

    if (service !== "sportine" || !level || level === "beginner") {
      setSlots([]);
      return;
    }

    void (async () => {
      // 14 calendar days total: today + the next 13 days.
      const { data, error } = await (supabase as any).rpc(
        "get_public_registration_slots",
        { _days: 13 },
      );

      if (error) {
        toast.error("Nepavyko užkrauti laikų");
        return;
      }

      setSlots(
        (data ?? []).filter(
          (slot: Slot) => slot.max_capacity >= 2,
        ),
      );
    })();
  }, [service, level]);

  const age = Number(form.age);
  const minAge = selectedService?.minAge ?? 3;
  const validAge = Number.isFinite(age) && age >= minAge;
  const validInfo = Boolean(
    form.firstName.trim() &&
      form.lastName.trim() &&
      form.phone.trim() &&
      form.email.trim() &&
      validAge &&
      form.emergency.trim(),
  );

  const stepOneValid = Boolean(
    service && (service !== "sportine" || level),
  );

  const remaining = (slot: Slot) =>
    Math.max(0, slot.max_capacity - slot.active_count);

  const lessonType = (slot: Slot) =>
    slot.max_capacity === 2 ? "Porinė" : "Grupinė";

  const needsAdminSelectedTime =
    service !== "sportine" || level === "beginner";

  const submit = async () => {
    if (!service || !validInfo || !rules) return;
    if (service === "sportine" && !level) return;

    if (!needsAdminSelectedTime && !selected) {
      toast.error("Pasirinkite pageidaujamą laiką");
      return;
    }

    setBusy(true);

    const { data, error } = await (supabase as any).rpc(
      "submit_public_registration_v2",
      {
        _first_name: form.firstName.trim(),
        _last_name: form.lastName.trim(),
        _phone: form.phone.trim(),
        _email: form.email.trim(),
        _age: age,
        _emergency_contact: form.emergency.trim(),
        _service_type: service,
        _experience_level: service === "sportine" ? level : "beginner",
        _experience_notes: form.experienceNotes.trim() || null,
        _preferred_times: form.preferredTimes.trim() || null,
        _requested_date: selected?.slot_date ?? null,
        _requested_time: selected?.slot_time ?? null,
        _facebook_name: form.facebookName.trim() || null,
      },
    );

    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.public_token) {
      history.replaceState(
        null,
        "",
        `/registracija/${result.public_token}`,
      );
    }
    setDone(true);
  };

  if (token && existing) {
    const accept = async (yes: boolean) => {
      const { error } = await (supabase as any).rpc(
        "respond_to_public_registration_proposal",
        { _token: token, _accept: yes },
      );

      if (error) {
        toast.error(error.message);
      } else {
        toast.success(yes ? "Laikas patvirtintas" : "Pasiūlymas atmestas");
        location.reload();
      }
    };

    return (
      <div className="container max-w-2xl py-12">
        <div className="rounded-3xl border border-gold/20 bg-gradient-card p-6 shadow-elegant">
          <h1 className="font-display text-3xl text-gradient-gold">
            Registracijos būsena
          </h1>
          <p className="mt-3 text-muted-foreground">
            {existing.first_name} {existing.last_name}
          </p>

          <div className="mt-5 rounded-xl border border-gold/15 bg-background/35 p-4">
            <p>
              <b>Būsena:</b> {existing.status}
            </p>
            {existing.proposed_date && (
              <p className="mt-2">
                <b>Pasiūlytas laikas:</b> {existing.proposed_date} ·{" "}
                {String(existing.proposed_time).slice(0, 5)}
              </p>
            )}
            {existing.admin_note && (
              <p className="mt-2 text-sm text-muted-foreground">
                {existing.admin_note}
              </p>
            )}
          </div>

          {existing.status === "proposed" && (
            <div className="mt-5 flex gap-3">
              <Button variant="gold" onClick={() => accept(true)}>
                Priimti laiką
              </Button>
              <Button variant="outline" onClick={() => accept(false)}>
                Atmesti
              </Button>
            </div>
          )}

          {existing.status === "approved" && (
            <p className="mt-5 text-emerald-500">
              Registracija patvirtinta. Jei negalėsite dalyvauti, taikomos
              įprastos Equus atšaukimo taisyklės.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="container max-w-xl py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 font-display text-4xl text-gradient-gold">
          Registracija gauta!
        </h1>
        <p className="mt-3 text-muted-foreground">
          Administracija peržiūrės prašymą ir susisieks su jumis.
          {selectedService && ` Kaina – ${selectedService.price} €.`}
        </p>
        <Link
          to="/atsiliepimai"
          className="mt-6 inline-block text-gold underline"
        >
          Peržiūrėti atsiliepimus
        </Link>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-10 sm:py-14">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[.25em] text-gold/70">
          Vieša registracija
        </p>
        <h1 className="font-display text-4xl text-gradient-gold sm:text-5xl">
          Registruotis į treniruotę
        </h1>
        <p className="mt-2 text-muted-foreground">
          Prašymą gali pateikti ir neturint paskyros.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((number) => (
          <div
            key={number}
            className={cn(
              "h-2 rounded-full",
              number <= step ? "bg-gold" : "bg-muted",
            )}
          />
        ))}
      </div>

      <div className="rounded-3xl border border-gold/20 bg-gradient-card p-5 shadow-elegant sm:p-8">
        {step === 1 && (
          <div>
            <h2 className="font-display text-3xl">Pasirinkite užsiėmimą</h2>
            <div className="mt-5 grid gap-3">
              {SERVICES.map((item) => {
                const Icon = item.icon;
                const active = service === item.value;

                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => {
                      setService(item.value);
                      if (item.value !== "sportine") setLevel("");
                    }}
                    className={cn(
                      "rounded-2xl border p-5 text-left transition-colors",
                      active
                        ? "border-gold bg-gold/10"
                        : "border-border bg-background/30 hover:border-gold/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                      <div className="min-w-0">
                        <div className="font-semibold">{item.title}</div>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                        <p className="mt-2 text-sm font-medium text-gold">
                          {item.price} € · nuo {item.minAge} m.
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {service === "sportine" && (
              <div className="mt-8">
                <h3 className="font-display text-2xl">Jojimo patirtis</h3>
                <div className="mt-4 grid gap-3">
                  {LEVELS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setLevel(item.value)}
                      className={cn(
                        "rounded-2xl border p-5 text-left transition-colors",
                        level === item.value
                          ? "border-gold bg-gold/10"
                          : "border-border bg-background/30 hover:border-gold/40",
                      )}
                    >
                      <div className="font-semibold">{item.title}</div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.text}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="font-display text-3xl">Asmeninė informacija</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Vardas">
                <Input
                  value={form.firstName}
                  onChange={(event) =>
                    setForm({ ...form, firstName: event.target.value })
                  }
                />
              </Field>
              <Field label="Pavardė">
                <Input
                  value={form.lastName}
                  onChange={(event) =>
                    setForm({ ...form, lastName: event.target.value })
                  }
                />
              </Field>
              <Field label="Telefonas">
                <Input
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </Field>
              <Field label="El. paštas">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </Field>
              <Field
                label={`Amžius (mažiausiai ${minAge} m.)`}
              >
                <Input
                  type="number"
                  min={minAge}
                  max="90"
                  value={form.age}
                  onChange={(event) =>
                    setForm({ ...form, age: event.target.value })
                  }
                />
                {form.age && !validAge && (
                  <p className="mt-1.5 text-xs text-destructive">
                    Šiam užsiėmimui dalyvis turi būti bent {minAge} metų.
                  </p>
                )}
              </Field>
              <Field label="Skubios pagalbos kontaktas">
                <Input
                  value={form.emergency}
                  onChange={(event) =>
                    setForm({ ...form, emergency: event.target.value })
                  }
                />
              </Field>
              <Field label="Papildomai apie jojimo patirtį" full>
                <Textarea
                  value={form.experienceNotes}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      experienceNotes: event.target.value,
                    })
                  }
                  placeholder="Trumpai parašykite, ką jau mokate arba kur esate joję."
                />
              </Field>
              <Field label="Facebook vardas ir pavardė (nebūtina)" full>
                <Input
                  value={form.facebookName}
                  onChange={(event) =>
                    setForm({ ...form, facebookName: event.target.value })
                  }
                  placeholder="Kad galėtume rasti ir pridėti į Messenger grupę"
                />
              </Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="font-display text-3xl">Pageidaujamas laikas</h2>

            {needsAdminSelectedTime ? (
              <div className="mt-5 rounded-2xl border border-gold/20 bg-gold/5 p-5">
                <p className="font-medium">
                  Tikslų laiką pasiūlys ir patvirtins administracija.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Parašykite, kurios dienos ir valandos jums patogiausios.
                  Registracija bus patvirtinta tik jums sutikus su pasiūlytu
                  laiku.
                </p>
                <Textarea
                  className="mt-4"
                  value={form.preferredTimes}
                  onChange={(event) =>
                    setForm({ ...form, preferredTimes: event.target.value })
                  }
                  placeholder="Pvz. šeštadieniais po 12 val. arba sekmadieniais ryte"
                />
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Rodomi tik artimiausių 2 savaičių porinių ir grupinių
                  treniruočių laikai. Individualios treniruotės čia
                  nesiūlomos.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {slots.map((slot) => {
                    const left = remaining(slot);
                    const isSelected =
                      selected?.slot_date === slot.slot_date &&
                      selected?.slot_time === slot.slot_time;

                    return (
                      <button
                        key={`${slot.slot_date}-${slot.slot_time}`}
                        type="button"
                        disabled={left <= 0}
                        onClick={() => setSelected(slot)}
                        className={cn(
                          "rounded-2xl border p-4 text-left transition-colors",
                          isSelected
                            ? "border-gold bg-gold/10"
                            : "border-border bg-background/30 hover:border-gold/40",
                          left <= 0 && "opacity-50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">
                            {new Date(`${slot.slot_date}T12:00:00`).toLocaleDateString(
                              "lt-LT",
                              {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-1 text-xs",
                              left === 0
                                ? "bg-red-500/15 text-red-500"
                                : left === 1
                                  ? "bg-amber-500/15 text-amber-500"
                                  : "bg-emerald-500/15 text-emerald-500",
                            )}
                          >
                            {left === 0
                              ? "Pilna"
                              : left === 1
                                ? "Liko 1 vieta"
                                : `Liko ${left} vietos`}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {slot.slot_time.slice(0, 5)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            {lessonType(slot)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {slots.length === 0 && (
                  <div className="mt-5 rounded-2xl border border-dashed border-gold/20 p-6 text-center text-sm text-muted-foreground">
                    Artimiausioms 2 savaitėms laisvų porinių ar grupinių
                    laikų šiuo metu nėra.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 4 && selectedService && (
          <div>
            <h2 className="font-display text-3xl">Patvirtinimas</h2>
            <div className="mt-5 space-y-2 rounded-2xl border border-border bg-background/30 p-5 text-sm">
              <p>
                <b>Vardas:</b> {form.firstName} {form.lastName}
              </p>
              <p>
                <b>Užsiėmimas:</b> {selectedService.title}
              </p>
              {service === "sportine" && (
                <p>
                  <b>Patirtis:</b>{" "}
                  {LEVELS.find((item) => item.value === level)?.title}
                </p>
              )}
              <p>
                <b>Laikas:</b>{" "}
                {selected
                  ? `${selected.slot_date} · ${selected.slot_time.slice(0, 5)} · ${lessonType(selected)}`
                  : "Pasiūlys administracija"}
              </p>
              <p>
                <b>Trukmė:</b> {selectedService.duration} min.
              </p>
              <p>
                <b>Kaina:</b> {selectedService.price} €
              </p>
            </div>

            <div className="mt-5 rounded-2xl border border-gold/20 bg-gold/5 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                <div>
                  <p className="text-sm font-medium">Atšaukimo taisyklės</p>
                  <button
                    type="button"
                    onClick={() => setRulesOpen(true)}
                    className="mt-1 inline-flex items-center gap-1 text-sm text-gold underline underline-offset-4"
                  >
                    <Info className="h-4 w-4" />
                    Peržiūrėti taisykles
                  </button>
                </div>
              </div>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-gold/20 p-4">
              <Checkbox
                checked={rules}
                onCheckedChange={(value) => setRules(value === true)}
              />
              <span className="text-sm">
                Susipažinau su Equus treniruočių atšaukimo taisyklėmis ir
                sutinku, kad jos bus taikomos patvirtinus registraciją.
              </span>
            </label>
          </div>
        )}

        <div className="mt-8 flex justify-between gap-3">
          <Button
            variant="ghost"
            disabled={step === 1}
            onClick={() => setStep((current) => current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Atgal
          </Button>

          {step < 4 ? (
            <Button
              variant="gold"
              disabled={
                (step === 1 && !stepOneValid) ||
                (step === 2 && !validInfo)
              }
              onClick={() => setStep((current) => current + 1)}
            >
              Toliau
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="gold"
              disabled={!rules || busy}
              onClick={submit}
            >
              {busy ? "Siunčiama…" : "Pateikti registraciją"}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Treniruočių atšaukimo taisyklės</DialogTitle>
            <DialogDescription>
              Šios taisyklės taikomos, kai administracija patvirtina jūsų
              registraciją.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm leading-6">
            <div className="rounded-xl border border-gold/15 bg-background/40 p-4">
              <p className="font-semibold">Atšaukimas prieš 24 valandas</p>
              <p className="mt-1 text-muted-foreground">
                Treniruotę galima atšaukti likus ne mažiau kaip 24 valandoms
                iki jos pradžios.
              </p>
            </div>

            <div className="rounded-xl border border-gold/15 bg-background/40 p-4">
              <p className="font-semibold">Vėlyvas atšaukimas</p>
              <p className="mt-1 text-muted-foreground">
                Pavėluotai atšaukta treniruotė skaičiuojama kaip panaudota,
                išskyrus ligos arba force majeure atvejus.
              </p>
            </div>

            <div className="rounded-xl border border-gold/15 bg-background/40 p-4">
              <p className="font-semibold">Negalėjimas dalyvauti</p>
              <p className="mt-1 text-muted-foreground">
                Jei negalite atvykti, apie tai praneškite kuo anksčiau. Po
                registracijos patvirtinimo taikoma tokia pati atšaukimo tvarka
                kaip ir paskyrą turintiems klientams.
              </p>
            </div>
          </div>

          <Button
            variant="gold"
            className="w-full"
            onClick={() => setRulesOpen(false)}
          >
            Supratau
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <Label>{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
