import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, CheckCircle2, CreditCard, QrCode, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/equus";

type RequestStatus = "pending" | "approved" | "rejected";
type PaymentMethod = "bank_transfer" | "cash";

type SelectedLesson = {
  id: string;
  slot_date: string;
  slot_time: string;
};

export type SubscriptionPurchaseRequest = {
  id: string;
  user_id: string;
  rider_name: string | null;
  lessons_total: number;
  package_type: "group" | "po2" | "individual";
  horse_type: "school" | "own";
  payment_method: PaymentMethod;
  price_eur: number;
  status: RequestStatus;
  created_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  subscription_id?: string | null;
  selected_past_lessons: SelectedLesson[];
};

function dateLabel(value: string) {
  return new Date(value + "T12:00:00").toLocaleDateString("lt-LT", {
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function statusLabel(status: RequestStatus) {
  if (status === "approved") return "Mokėjimas patvirtintas";
  if (status === "rejected") return "Užklausa atmesta";
  return "Laukia mokėjimo patvirtinimo";
}

function errorMessage(message: string) {
  if (message.includes("REQUEST_ALREADY_PROCESSED")) return "Ši užklausa jau apdorota. Atnaujinkite sąrašą.";
  if (message.includes("REQUEST_PRICE_CHANGED")) return "Kaina nuo užklausos pateikimo pasikeitė. Nepatvirtinta; susisiekite su raiteliu prieš kuriant naują užklausą.";
  if (message.includes("PAST_LESSON_NO_LONGER_ELIGIBLE")) return "Bent viena pasirinkta pamoka jau nebetinkama įskaityti. Užklausa nepatvirtinta; peržiūrėkite raitelio pamokų istoriją.";
  if (message.includes("PENDING_SUBSCRIPTION_ALREADY_EXISTS")) return "Šis raitelis jau turi abonementą, kuris laukia pirmos treniruotės. Užklausa nepatvirtinta.";
  if (message.includes("PRICE_NOT_CONFIGURED")) return "Šiam variantui aktyvios kainos nėra. Užklausa nepatvirtinta.";
  return message || "Nepavyko apdoroti užklausos.";
}

function PurchaseRequestCard({
  request,
  onChanged,
}: {
  request: SubscriptionPurchaseRequest;
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState(request);
  const [busy, setBusy] = useState(false);

  useEffect(() => setCurrent(request), [request]);

  const decide = async (decision: "approve" | "reject") => {
    if (current.status !== "pending" || busy) return;
    if (decision === "reject" && !window.confirm("Atmesti " + (current.rider_name || "raitelio") + " abonemento užklausą?")) return;

    setBusy(true);
    const rpc = decision === "approve" ? "approve_subscription_purchase_request" : "reject_subscription_purchase_request";
    const args = decision === "approve"
      ? { _request_id: current.id }
      : { _request_id: current.id, _reason: null };
    const { data, error } = await (supabase as any).rpc(rpc, args);
    setBusy(false);

    if (error) {
      toast.error(errorMessage(error.message));
      return;
    }
    if (!data?.ok) {
      toast.error("Serveris nepatvirtino užklausos veiksmo.");
      return;
    }

    if (decision === "approve") {
      setCurrent({ ...current, status: "approved", subscription_id: data.subscription_id, approved_at: new Date().toISOString() });
      toast.success("Mokėjimas patvirtintas · " + Number(data.price_eur ?? current.price_eur).toFixed(2) + " € · panaudota " + (data.lessons_used ?? current.selected_past_lessons?.length ?? 0) + " treniruotė(-s).");
    } else {
      setCurrent({ ...current, status: "rejected", rejected_at: new Date().toISOString() });
      toast.success("Užklausa atmesta.");
    }
    onChanged?.();
  };

  return (
    <article className="rounded-2xl border border-gold/15 bg-gradient-card p-4 shadow-elegant sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-display text-2xl text-gold">{current.rider_name || "Raitelis be vardo"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {current.lessons_total} treniruotės · {current.package_type === "group" ? "Grupinė" : current.package_type === "po2" ? "Po 2" : "Individuali"} · {current.horse_type === "school" ? "Mokyklos žirgais" : "Nuosavu žirgu"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {current.payment_method === "bank_transfer" ? "Bankinis pavedimas" : "Grynais"} · pateikta {new Date(current.created_at).toLocaleString("lt-LT")}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="font-display text-3xl text-gradient-gold tabular-nums">{Number(current.price_eur).toFixed(2)} €</p>
          <span className={"mt-2 inline-flex rounded-full border px-3 py-1 text-xs " + (current.status === "approved" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-500" : current.status === "rejected" ? "border-destructive/25 bg-destructive/10 text-destructive" : "border-gold/20 bg-gold/5 text-gold")}>
            {statusLabel(current.status)}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gold/10 bg-background/30 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 text-gold" />
          Pasirinktos praeitos pamokos ({current.selected_past_lessons?.length ?? 0})
        </div>
        {current.selected_past_lessons?.length ? (
          <ul className="mt-2 space-y-1.5">
            {current.selected_past_lessons.map((lesson) => (
              <li key={lesson.id} className="flex items-center justify-between gap-3 text-xs">
                <span>{dateLabel(lesson.slot_date)}</span>
                <span className="tabular-nums text-muted-foreground">{formatTime(lesson.slot_time)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Praeitų pamokų įskaityti nepasirinko nei vienos.</p>
        )}
      </div>

      {current.payment_method === "bank_transfer" && current.status === "pending" && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          Bankinį pavedimą patvirtinti per banką ir tuomet tik patvirtinti
        </p>
      )}
      {current.payment_method === "cash" && current.status === "pending" && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          Grynais sumokėjus, patvirtinkite mokėjimą. QR kodas atveria šią užklausą:)
        </p>
      )}
      {current.status === "approved" && current.subscription_id && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
          Abonementas sukurtas. Pasirinktos praeitos pamokos įskaitytos kaip panaudotos.
        </p>
      )}
      {current.status === "rejected" && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          Užklausa atmesta; abonementas nesukurtas.
        </p>
      )}

      {current.status === "pending" && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outlineGold" onClick={() => void decide("reject")} disabled={busy}>
            {busy ? "Apdorojama…" : "Atmesti"}
          </Button>
          <Button variant="gold" onClick={() => void decide("approve")} disabled={busy}>
            {busy ? "Apdorojama…" : "Patvirtinti mokėjimą"}
          </Button>
        </div>
      )}
    </article>
  );
}

export function SubscriptionPurchaseRequestsPanel({ standalone = false }: { standalone?: boolean }) {
  const [requests, setRequests] = useState<SubscriptionPurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await (supabase as any).rpc("list_subscription_purchase_requests");
    if (rpcError) {
      setError(rpcError.message);
      setRequests([]);
      setLoading(false);
      return;
    }
    setRequests((data?.requests ?? []) as SubscriptionPurchaseRequest[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const pending = requests.filter((request) => request.status === "pending");
  const processed = requests.filter((request) => request.status !== "pending");

  return (
    <div className="space-y-5">
      {standalone && (
        <header className="mb-5">
          <Link to="/admin/skenuoti" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-gold">
            <ArrowLeft className="h-4 w-4" /> Grįžti į QR skenavimą
          </Link>
          <p className="mt-5 text-xs uppercase tracking-[0.25em] text-gold/70">Administracija</p>
          <h1 className="mt-2 font-display text-4xl text-gradient-gold">QR užklausos</h1>
          <p className="mt-2 text-sm text-muted-foreground">Bankiniai pavedimai ir grynųjų mokėjimai, laukiantys patvirtinimo.</p>
        </header>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-gold">Laukiama patvirtinimo · {pending.length}</h3>
          <p className="mt-1 text-xs text-muted-foreground">Patvirtinus mokėjimą sukuriamas abonementas; pasirinktos praeitos pamokos įskaitomos kaip panaudotos.</p>
        </div>
        <Button variant="outlineGold" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Atnaujinama…" : "Atnaujinti"}
        </Button>
      </div>

      {loading ? (
        <p className="rounded-xl border border-gold/10 bg-background/25 p-5 text-sm text-muted-foreground">Kraunamos užklausos…</p>
      ) : error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">{error}</p>
      ) : pending.length === 0 ? (
        <p className="rounded-xl border border-gold/10 bg-background/25 p-5 text-sm text-muted-foreground">Nėra laukiančių užklausų.</p>
      ) : (
        <div className="space-y-3">
          {pending.map((request) => (
            <PurchaseRequestCard key={request.id} request={request} onChanged={() => void load()} />
          ))}
        </div>
      )}

      {processed.length > 0 && (
        <details className="rounded-2xl border border-gold/10 bg-background/20 p-4">
          <summary className="cursor-pointer font-display text-lg text-gold">Apdorotos užklausos · {processed.length}</summary>
          <div className="mt-4 space-y-3">
            {processed.map((request) => (
              <PurchaseRequestCard key={request.id} request={request} onChanged={() => void load()} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function SubscriptionPurchaseRequestQrPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [request, setRequest] = useState<SubscriptionPurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requestId) {
      setError("Nenurodytas užklausos numeris.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await (supabase as any).rpc("get_subscription_purchase_request_for_staff", {
      _request_id: requestId,
    });
    if (rpcError) {
      setError(rpcError.message);
      setRequest(null);
    } else {
      setError(null);
      setRequest(data as SubscriptionPurchaseRequest);
    }
    setLoading(false);
  }, [requestId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link to="/admin/qr-uzklausos" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-gold">
        <ArrowLeft className="h-4 w-4" /> QR užklausų sąrašas
      </Link>
      <header className="mb-6 mt-5">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70">Equus · mokėjimas</p>
        <h1 className="mt-2 font-display text-4xl text-gradient-gold">Abonemento užklausa</h1>
        <p className="mt-2 text-sm text-muted-foreground">Jei viskas ok - patvirtinam.</p>
      </header>

      {loading ? (
        <p className="rounded-xl border border-gold/10 bg-background/25 p-5 text-sm text-muted-foreground">Kraunama…</p>
      ) : error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">Nepavyko atidaryti QR užklausos. Prisijunkite darbuotojo paskyra ir bandykite dar kartą. {error}</p>
      ) : request ? (
        <PurchaseRequestCard request={request} />
      ) : null}
    </div>
  );
}