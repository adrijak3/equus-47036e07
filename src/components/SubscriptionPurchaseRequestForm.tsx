import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CalendarClock, CheckCircle2, Clock3, CreditCard, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/SubscriptionRequestUi";
import { formatTime } from "@/lib/equus";

type PackageType = "group" | "po2" | "individual";
type HorseType = "school" | "own";
type PaymentMethod = "bank_transfer" | "cash";
type RequestStatus = "pending" | "approved" | "rejected";

type PastLesson = {
  id: string;
  slot_date: string;
  slot_time: string;
};

type PriceRow = {
  lessons_total: number;
  package_type: PackageType;
  horse_type: HorseType;
  price_eur: number;
};

type PurchaseRequest = {
  id: string;
  user_id: string;
  rider_name: string | null;
  lessons_total: number;
  package_type: PackageType;
  horse_type: HorseType;
  payment_method: PaymentMethod;
  price_eur: number;
  status: RequestStatus;
  created_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  subscription_id?: string | null;
  selected_past_lessons: PastLesson[];
};

type BankTransferEmailDraft = {
  requestId: string;
  riderId: string;
  riderName: string;
  lessonsTotal: number;
  packageType: PackageType;
  horseType: HorseType;
  priceEur: number;
};

function dateLabel(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("lt-LT", {
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function requestStatusLabel(status: RequestStatus) {
  if (status === "approved") return "Mokėjimas patvirtintas";
  if (status === "rejected") return "Užklausa atmesta";
  return "Laukia mokėjimo patvirtinimo";
}

function requestErrorMessage(message: string) {
  if (message.includes("PENDING_REQUEST_EXISTS")) {
    return "Jau turite laukiančią abonemento užklausą. Pirmiausia palaukite jos patvirtinimo, tuomet tik galėsit prisidėti naują abonementą, jei reikia:)";
  }
  if (message.includes("PENDING_SUBSCRIPTION_ALREADY_EXISTS")) {
    return "Jau turite abonementą, kuris laukia pirmos treniruotės.";
  }
  if (message.includes("PRICE_NOT_CONFIGURED")) {
    return "Šiam abonemento variantui kaina dar nesukonfigūruota:(";
  }
  if (message.includes("TOO_MANY_PAST_LESSONS")) {
    return "Negalite pasirinkti daugiau praeitų pamokų nei abonemente yra treniruočių...";
  }
  if (message.includes("PAST_LESSON_NOT_ELIGIBLE")) {
    return "Viena iš pasirinktų pamokų nebepriklauso 2 sav. laikotarpiui, tas tas pamokas atskirai sudėsim;).";
  }
  if (message.includes("INVALID_LESSON_COUNT")) {
    return "Pasirinkite treniruočių skaičių nuo 1 iki 12.";
  }
  return message || "Nepavyko pateikti užklausos.";
}

export function SubscriptionPurchaseRequestForm({ riderId }: { riderId: string | null }) {
  const { user, profile, activeProfileName } = useAuth();
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [pastLessons, setPastLessons] = useState<PastLesson[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [lessonsTotal, setLessonsTotal] = useState(4);
  const [packageType, setPackageType] = useState<PackageType>("group");
  const [horseType, setHorseType] = useState<HorseType>("school");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank_transfer");
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [bankTransferDialogOpen, setBankTransferDialogOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<BankTransferEmailDraft | null>(null);

  const currentPrice = useMemo(
    () => prices.find((row) =>
      Number(row.lessons_total) === lessonsTotal
      && row.package_type === packageType
      && row.horse_type === horseType,
    ),
    [prices, lessonsTotal, packageType, horseType],
  );
  const pendingRequest = requests.find((r) => r.status === "pending");
  const availableQuantities = useMemo(
    () => Array.from(new Set(
      prices
        .filter((row) => row.package_type === packageType && row.horse_type === horseType)
        .map((row) => Number(row.lessons_total)),
    )).sort((a, b) => a - b),
    [prices, packageType, horseType],
  );

  const load = useCallback(async () => {
    if (!riderId || !user?.id) {
      setPrices([]);
      setPastLessons([]);
      setRequests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [priceResult, lessonResult, requestResult] = await Promise.all([
      supabase
        .from("subscription_prices")
        .select("lessons_total, package_type, horse_type, price_eur")
        .eq("active", true),
      (supabase as any).rpc("get_subscription_request_past_lessons", {
        _user_id: riderId,
      }),
      (supabase as any).rpc("get_my_subscription_purchase_requests", {
        _user_id: riderId,
      }),
    ]);

    if (priceResult.error) {
      toast.error("Nepavyko įkelti abonementų kainų.");
    } else {
      setPrices((priceResult.data ?? []) as PriceRow[]);
    }

    if (lessonResult.error) {
      toast.error(requestErrorMessage(lessonResult.error.message));
      setPastLessons([]);
    } else {
      setPastLessons((lessonResult.data?.lessons ?? []) as PastLesson[]);
    }

    if (requestResult.error) {
      toast.error(requestErrorMessage(requestResult.error.message));
      setRequests([]);
    } else {
      setRequests((requestResult.data?.requests ?? []) as PurchaseRequest[]);
    }

    setLoading(false);
  }, [riderId, user?.id]);

  useEffect(() => {
    void load();
    // The active account/profile is the rider whose bookings and subscription are used.
  }, [load]);

  useEffect(() => {
    if (availableQuantities.length > 0 && !availableQuantities.includes(lessonsTotal)) {
      setLessonsTotal(availableQuantities[0]);
    }
  }, [availableQuantities, lessonsTotal]);

  useEffect(() => {
    if (selectedLessonIds.length > lessonsTotal) {
      setSelectedLessonIds((current) => current.slice(0, lessonsTotal));
    }
  }, [lessonsTotal, selectedLessonIds.length]);

  const toggleLesson = (id: string, checked: boolean) => {
    setSelectedLessonIds((current) => {
      if (checked) {
        if (current.includes(id)) return current;
        if (current.length >= lessonsTotal) {
          toast.error("Pasirinktų praeitų pamokų skaičius negali viršyti abonemento treniruočių kiekio.");
          return current;
        }
        return [...current, id];
      }
      return current.filter((existing) => existing !== id);
    });
  };

  const submit = async () => {
    if (!riderId) {
      toast.error("Nepavyko nustatyti raitelio profilio.");
      return;
    }
    if (!currentPrice) {
      toast.error("Šiam variantui kaina nesukonfigūruota. Pasirinkite kitą treniruočių kiekį ar tipą.");
      return;
    }
    if (selectedLessonIds.length > lessonsTotal) {
      toast.error("Pasirinkta per daug praeitų pamokų.");
      return;
    }

    setSubmitting(true);
    const { data, error } = await (supabase as any).rpc("create_subscription_purchase_request", {
      _user_id: riderId,
      _lessons_total: lessonsTotal,
      _package_type: packageType,
      _horse_type: horseType,
      _payment_method: paymentMethod,
      _booking_ids: selectedLessonIds,
    });
    setSubmitting(false);

    if (error) {
      toast.error(requestErrorMessage(error.message));
      return;
    }
    if (!data?.ok || !data?.request_id) {
      toast.error("Užklausa nebuvo sukurta.");
      return;
    }

    setSelectedLessonIds([]);

    if (paymentMethod === "cash") {
      toast.success("Užklausa sukurta. Parodykite QR kodą Laurai:).");
    } else {
      toast.success("Užklausa išsaugota. Užbaikite pavedimą el. paštu.");
      openBankTransferEmail({
        requestId: String(data.request_id),
        riderId: riderId,
        riderName: currentRiderName,
        lessonsTotal,
        packageType,
        horseType,
        priceEur: Number(data.price_eur ?? currentPrice.price_eur),
      });
    }
    await load();
  };

  const currentRiderName = (activeProfileName || profile?.full_name || "").trim();
  const riderName = currentRiderName || "raiteliui";

  const openBankTransferEmail = (draft: BankTransferEmailDraft) => {
    setEmailDraft(draft);
    setBankTransferDialogOpen(true);
  };

  const riderTypeLabelFor = (targetRiderId: string) => {
    const isChildRider =
      !!user &&
      (targetRiderId !== user.id || user.user_metadata?.phone_is_parent === true);
    return isChildRider ? "Vaikas" : "Suaugęs";
  };

  const getBankTransferEmailBody = (draft: BankTransferEmailDraft) => [
    "Sveiki, norėčiau įsigyti abonementą",
    `Kiekis: ${draft.lessonsTotal}`,
    `Suma: ${Number(draft.priceEur).toFixed(2)} €`,
    `Raitelis: ${draft.riderName.trim()} (${riderTypeLabelFor(draft.riderId)})`,
  ].join("\n");

  const openPreparedEmail = () => {
    if (!emailDraft) return;
    const trimmedName = emailDraft.riderName.trim() || riderName;
    const subject = `Abonemento užklausa – ${trimmedName}`;
    const body = getBankTransferEmailBody({ ...emailDraft, riderName: trimmedName });
    const mailto = `mailto:jojimomokykla@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    setBankTransferDialogOpen(false);
  };

  return (
    <div className="space-y-4">
      <Section title="Pateikti abonemento užklausą" icon={<CreditCard className="h-4 w-4" />}>
        <div className="space-y-5 p-5">
          <p className="text-sm leading-6 text-muted-foreground">
            Pasirinkite abonementą ir mokėjimo būdą. Abonementas paskyroje atsiras tik tada, kai Laura patvirtins, kad mokėjimas įvyko (nuskenavus QR kodą)
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="request-lessons-total">Treniruočių skaičius</label>
              <select
                id="request-lessons-total"
                value={lessonsTotal}
                onChange={(e) => setLessonsTotal(Number(e.target.value))}
                disabled={loading || !!pendingRequest}
                className="h-11 w-full rounded-lg border border-gold/20 bg-background px-3 text-sm"
              >
                {availableQuantities.length === 0 ? (
                  <option value={lessonsTotal}>Nėra aktyvių kainų</option>
                ) : availableQuantities.map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? "treniruotė" : "treniruotės"}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="request-package-type">Treniruotės tipas</label>
              <select
                id="request-package-type"
                value={packageType}
                onChange={(e) => setPackageType(e.target.value as PackageType)}
                disabled={loading || !!pendingRequest}
                className="h-11 w-full rounded-lg border border-gold/20 bg-background px-3 text-sm"
              >
                <option value="group">Grupinė</option>
                <option value="po2">Po 2</option>
                <option value="individual">Individuali (1 asmuo)</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="request-horse-type">Žirgas</label>
              <select
                id="request-horse-type"
                value={horseType}
                onChange={(e) => setHorseType(e.target.value as HorseType)}
                disabled={loading || !!pendingRequest}
                className="h-11 w-full rounded-lg border border-gold/20 bg-background px-3 text-sm"
              >
                <option value="school">Mokyklos žirgais</option>
                <option value="own">Nuosavu žirgu</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="request-payment-method">Mokėjimo būdas</label>
              <select
                id="request-payment-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                disabled={loading || !!pendingRequest}
                className="h-11 w-full rounded-lg border border-gold/20 bg-background px-3 text-sm"
              >
                <option value="bank_transfer">Bankinis pavedimas</option>
                <option value="cash">Grynais</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-gold/20 bg-gold/5 p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Pasirinktas abonementas</p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-display text-2xl text-gold">{lessonsTotal} treniruotės · {packageType === "group" ? "Grupinė" : packageType === "po2" ? "Po 2" : "Individuali"}</p>
                <p className="mt-1 text-sm text-muted-foreground">{horseType === "school" ? "Mokyklos žirgais" : "Nuosavu žirgu"}</p>
              </div>
              <p className="font-display text-3xl text-gradient-gold tabular-nums">
                {currentPrice ? Number(currentPrice.price_eur).toFixed(2) + " €" : "Kaina nenustatyta"}
              </p>
            </div>
            {!currentPrice && (
              <p className="mt-2 text-xs text-blush">Šiam kiekiui ir tipui aktyvios kainos nėra.</p>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="font-display text-xl text-gold">Praėjusios treniruotės</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Galite pasirinkti įvykusias treniruotes iš paskutinių 14 kalendorinių dienų, įskaitant šiandieną. Jos bus įskaitytos kaip panaudotos tik patvirtinus mokėjimą:)
                </p>
              </div>
              <span className="rounded-full border border-gold/15 px-3 py-1 text-xs tabular-nums">
                {selectedLessonIds.length}/{lessonsTotal} pasirinkta
              </span>
            </div>

            {loading ? (
              <p className="mt-3 text-sm text-muted-foreground">Kraunamas treniruočių sąrašas…</p>
            ) : pastLessons.length === 0 ? (
              <p className="mt-3 rounded-xl border border-gold/10 bg-background/30 p-4 text-sm text-muted-foreground">
                Per paskutines 14 dienų įvykusių treniruočių nėra..
              </p>
            ) : (
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {pastLessons.map((lesson) => {
                  const checked = selectedLessonIds.includes(lesson.id);
                  const disabled = !!pendingRequest || (!checked && selectedLessonIds.length >= lessonsTotal);
                  return (
                    <label
                      key={lesson.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-gold/10 bg-background/30 p-3 transition-colors hover:border-gold/30 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || loading}
                        onChange={(e) => toggleLesson(lesson.id, e.target.checked)}
                        className="h-4 w-4 accent-[hsl(var(--gold))]"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{dateLabel(lesson.slot_date)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{formatTime(lesson.slot_time)}</span>
                      </span>
                      <CheckCircle2 className="h-4 w-4 text-gold" />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gold/10 bg-background/25 p-4">
            <p className="text-sm font-medium">Mokėjimo būdas</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {paymentMethod === "bank_transfer"
                ? "Pateikus užklausą atsidarys paruoštas el. laiškas adresu jojimomokykla@gmail.com. Išsiuntę užklausą, sulauksite sąskaitos apmokėjimui. Apmokėję sąskaitą, atsiųskite mokėjimo patvirtinimą. Jei uždarysite langą, laišką galėsite paruošti iš naujo savo paskyroje."
                : "Pateikus užklausą bus sugeneruotas QR kodas. Parodykite jį Laurai, kad ji atidarytų užklausą ir patvirtintų gautą mokėjimą."}
            </p>
          </div>

          <Button
            variant="gold"
            className="w-full"
            onClick={() => void submit()}
            disabled={loading || submitting || !!pendingRequest || !currentPrice}
          >
            {submitting ? "Pateikiama…" : pendingRequest ? "Laukiama ankstesnės užklausos" : "Pateikti užklausą"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Raitelis: <span className="font-medium text-foreground">{riderName}</span>. Kainą patikrina serveris pagal aktyvų kainoraštį.
          </p>
        </div>
      </Section>

      <Section title="Mano abonemento užklausos" icon={<CalendarClock className="h-4 w-4" />}>
        <div className="space-y-3 p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Kraunama…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Užklausų dar nėra.</p>
          ) : (
            requests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-gold/15 bg-background/30 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{request.lessons_total} treniruotės · {request.package_type === "group" ? "Grupinė" : "Po 2"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {request.horse_type === "school" ? "Mokyklos žirgais" : "Nuosavu žirgu"} · {request.payment_method === "bank_transfer" ? "Bankinis pavedimas" : "Grynais"} · {Number(request.price_eur).toFixed(2)} €
                    </p>
                  </div>
                  <span className={"rounded-full border px-3 py-1 text-xs " + (request.status === "approved" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500" : request.status === "rejected" ? "border-destructive/25 bg-destructive/10 text-destructive" : "border-gold/20 bg-gold/5 text-gold")}>
                    {requestStatusLabel(request.status)}
                  </span>
                </div>

                {request.selected_past_lessons?.length > 0 && (
                  <div className="mt-3 border-t border-gold/10 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gold/80">Pasirinktos praeitos pamokos · {request.selected_past_lessons.length}</p>
                    <div className="mt-2 space-y-1">
                      {request.selected_past_lessons.map((lesson) => (
                        <p key={lesson.id} className="text-xs text-muted-foreground">
                          {dateLabel(lesson.slot_date)} · {formatTime(lesson.slot_time)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {request.status === "pending" && request.payment_method === "cash" && (
                  <div className="mt-4 rounded-xl border border-gold/15 bg-background/40 p-4 text-center">
                    <p className="text-sm font-medium">Parodykite šį QR Laurai</p>
                    <div className="mx-auto mt-3 w-fit rounded-xl bg-white p-3">
                      <QRCodeSVG value={window.location.origin + "/qr-uzklausa/" + request.id} size={220} level="M" includeMargin />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">QR atidaro šią užklausą.</p>
                  </div>
                )}
                {request.status === "pending" && request.payment_method === "bank_transfer" && (
                  <div className="mt-3 space-y-3">
                    <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                      Užklausa išsaugota. Išsiųskite laišką adresu jojimomokykla@gmail.com. Administracija atsiųs sąskaitą apmokėjimui; apmokėję ją, atsiųskite mokėjimo patvirtinimą. Abonementas atsiras, kai mokėjimas bus patvirtintas.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => openBankTransferEmail({
                        requestId: request.id,
                        riderId: request.user_id,
                        riderName: (request.rider_name || currentRiderName).trim(),
                        lessonsTotal: request.lessons_total,
                        packageType: request.package_type,
                        horseType: request.horse_type,
                        priceEur: Number(request.price_eur),
                      })}
                    >
                      <Mail className="h-4 w-4" />
                      Paruošti el. laišką
                    </Button>
                  </div>
                )}
                {request.status === "approved" && request.subscription_id && (
                  <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    Abonementas sukurtas. Pasirinktos praeitos pamokos įskaitytos kaip panaudotos.
                  </p>
                )}
                {request.status === "rejected" && request.rejection_reason && (
                  <p className="mt-3 text-xs text-muted-foreground">Priežastis: {request.rejection_reason}</p>
                )}
              </div>
            ))
          )}
          {loading && <span className="sr-only">Kraunama</span>}
        </div>
      </Section>

      <Dialog open={bankTransferDialogOpen} onOpenChange={setBankTransferDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Paruoštas abonemento el. laiškas</DialogTitle>
            <DialogDescription>
              Užklausa išsaugota paskyroje. Atidarykite paruoštą laišką ir išsiųskite užklausą. Sąskaitą apmokėjimui gausite vėliau.
            </DialogDescription>
          </DialogHeader>

          {emailDraft && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gold/15 bg-background/40 p-4 text-sm">
                <p><span className="text-muted-foreground">Kam:</span> <span className="font-medium">jojimomokykla@gmail.com</span></p>
              </div>
              <div className="whitespace-pre-line rounded-xl border border-gold/15 bg-background/30 p-4 text-sm leading-6">
                {getBankTransferEmailBody(emailDraft)}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Laiškas bus atidarytas jūsų el. pašto programoje. Šiame etape jokio mokėjimo įrodymo pridėti nereikia.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setBankTransferDialogOpen(false)}>
              Uždaryti
            </Button>
            <Button
              type="button"
              variant="gold"
              className="gap-2"
              onClick={openPreparedEmail}
              disabled={!emailDraft}
            >
              <Mail className="h-4 w-4" />
              Atidaryti el. paštą
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}