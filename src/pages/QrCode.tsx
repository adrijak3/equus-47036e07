import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Camera,
  Copy,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Mail,
  Phone,
  CalendarDays,
  CreditCard,
  ScanLine,
  ArrowLeft,
  ShoppingBag,
  Banknote,
  CalendarClock,
  Settings2,
} from "lucide-react";

const PREFIX = "EQUUS-CLIENT:";

type Subscription = {
  id: string;
  lessons_total: number;
  lessons_used: number;
  expires_at: string;
  purchase_date: string;
  start_from_date?: string | null;
  price: number;
  paid: boolean;
  lesson_type?: string | null;
  package_type?: string | null;
  horse_type?: string | null;
  purchase_method?: string | null;
};

type ClientResult = {
  client: {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
  subscription: Subscription | null;
  next_subscription?: Subscription | null;
  reservations: Array<{
    id: string;
    slot_date: string;
    slot_time: string;
    status: string;
    subscription_id?: string | null;
  }>;
};

const packageLabel = (value?: string | null) =>
  value === "po2" ? "Asmeninė po 2" : value === "group" ? "Grupinė" : "—";

const horseLabel = (value?: string | null) =>
  value === "own" ? "Nuosavu žirgu" : value === "school" ? "Mokyklos žirgais" : "—";

const paymentLabel = (value?: string | null) =>
  value === "bank_transfer" ? "Bankiniu pavedimu" : value === "cash" ? "Grynais" : value === "other" ? "Kita" : "—";

function extractToken(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith(PREFIX)) return trimmed.slice(PREFIX.length).trim();

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts.at(-1);
    if (parts.at(-2) === "qr" && token) return token;
  } catch {}

  return trimmed;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value + (value.length === 10 ? "T12:00:00" : "")).toLocaleDateString("lt-LT");
}

function subscriptionType(s: Subscription) {
  return `${packageLabel(s.package_type)} · ${horseLabel(s.horse_type)}`;
}

export default function QrCodePage({ scanner = false }: { scanner?: boolean }) {
  const { user, isAdmin, isHalfAdmin } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [scannedToken, setScannedToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [client, setClient] = useState<ClientResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const stopScanner = useCallback(async () => {
    const current = scannerRef.current;
    scannerRef.current = null;
    if (!current) return;
    try { await current.stop(); } catch {}
    try { await current.clear(); } catch {}
  }, []);

  const loadOwnQr = useCallback(async (rotate = false) => {
    if (!user) return;
    setRotating(rotate);

    const fn = rotate ? "issue_client_qr_token" : "get_my_client_qr";
    const { data, error } = await (supabase as any).rpc(fn);

    setRotating(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (!data?.ok && data?.reason === "NO_QR") {
      const { data: issued, error: issueError } = await (supabase as any).rpc("issue_client_qr_token");
      if (issueError) {
        toast.error(issueError.message);
        return;
      }
      setToken(issued?.token ?? null);
      return;
    }

    setToken(data?.token ?? null);
  }, [user]);

  const resolve = useCallback(async (raw: string) => {
    const extracted = extractToken(raw);
    if (!extracted) return;

    setScannedToken(extracted);
    setResolving(true);
    await stopScanner();
    setScannerOpen(false);

    const { data, error } = await (supabase as any).rpc("resolve_client_qr", { _token: extracted });

    setResolving(false);

    if (error) {
      toast.error(
        error.message?.includes("STAFF_ONLY")
          ? "Tik admin"
          : "QR kodas neatpažintas arba nebegalioja.",
      );
      return;
    }

    setClient(data as ClientResult);
    setManual("");
  }, [stopScanner]);

  useEffect(() => {
    if (!scanner && user) void loadOwnQr();
    return () => { void stopScanner(); };
  }, [scanner, user, loadOwnQr, stopScanner]);

  const startScanner = async () => {
    setClient(null);
    setScannedToken(null);
    setScannerOpen(true);

    await new Promise((resolveTimer) => setTimeout(resolveTimer, 50));

    const instance = new Html5Qrcode("equus-qr-reader", {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
    });

    scannerRef.current = instance;

    try {
      await instance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
        (decodedText) => { void resolve(decodedText); },
        () => {},
      );
    } catch {
      toast.error("Nepavyko paleisti kameros. Patikrinkite naršyklės kameros leidimą.");
      await stopScanner();
    }
  };

  const reloadClient = async () => {
    if (!scannedToken) return;
    const { data, error } = await (supabase as any).rpc("resolve_client_qr", { _token: scannedToken });
    if (error) {
      toast.error(error.message);
      return;
    }
    setClient(data as ClientResult);
  };

  if (scanner) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6">
          <Link to={isHalfAdmin && !isAdmin ? "/half-admin/abonementai" : "/admin"} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-gold">
            <ArrowLeft className="h-4 w-4" /> Grįžti
          </Link>
          <p className="mt-5 text-xs uppercase tracking-[0.25em] text-gold/70">Klientai</p>
          <h1 className="text-4xl font-display text-gradient-gold">Skenuoti kliento QR</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Nuskenuokite kliento QR ir peržiūrėkite jo abonementą bei, jei turite teisę, atlikite pirkimą.
          </p>
        </div>

        {!scannerOpen && !client && (
          <div className="rounded-3xl border border-gold/15 bg-gradient-card p-7 text-center shadow-elegant">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gold/10">
              <ScanLine className="h-8 w-8 text-gold" />
            </div>
            <h2 className="mt-5 text-2xl font-display">Paruošta skenuoti</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Klientas parodo savo QR kodą. Jūs jį nuskenuojate telefonu.
            </p>
            <Button variant="gold" size="lg" className="mt-6" onClick={() => void startScanner()}>
              <Camera className="mr-2 h-5 w-5" /> Skenuoti QR
            </Button>
          </div>
        )}

        {scannerOpen && (
          <div className="rounded-3xl border border-gold/15 bg-black/20 p-3 shadow-elegant">
            <div id="equus-qr-reader" className="overflow-hidden rounded-2xl" />
            <Button
              variant="outlineGold"
              className="mt-3 w-full"
              onClick={() => { void stopScanner(); setScannerOpen(false); }}
            >
              Išjungti kamerą
            </Button>
          </div>
        )}

        {!client && (
          <div className="mt-4 rounded-2xl border border-gold/10 bg-card/50 p-4">
            <p className="text-sm font-medium">QR turinys (testavimas)</p>
            <div className="mt-3 flex gap-2">
              <Input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="EQUUS-CLIENT:..."
              />
              <Button variant="outlineGold" onClick={() => void resolve(manual)} disabled={!manual.trim() || resolving}>
                Tikrinti
              </Button>
            </div>
          </div>
        )}

        {client && (
          <ClientResultCard
            result={client}
            isAdmin={isAdmin}
            isHalfAdmin={isHalfAdmin}
            onPurchase={() => setPurchaseOpen(true)}
            onRescan={() => {
              setClient(null);
              setScannedToken(null);
              setPurchaseOpen(false);
            }}
          />
        )}

        {client && (
          <SubscriptionPurchaseDialog
            open={purchaseOpen}
            onOpenChange={setPurchaseOpen}
            client={client}
            isHalfAdmin={isHalfAdmin}
            onPurchased={async () => {
              setPurchaseOpen(false);
              await reloadClient();
            }}
          />
        )}
      </div>
    );
  }

  const qrValue = token ? PREFIX + token : "";

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70">Mano paskyra</p>
        <h1 className="mt-2 text-4xl font-display text-gradient-gold">Mano QR kodas</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
          Parodykite šį kodą Laurai, jei norite įsigyti abonementą.
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-gold/15 bg-gradient-card p-6 shadow-elegant sm:p-8">
        <div className="mx-auto w-fit rounded-2xl bg-white p-4 shadow-xl">
          {token ? (
            <QRCodeSVG value={qrValue} size={280} level="M" includeMargin />
          ) : (
            <div className="h-[280px] w-[280px] animate-pulse rounded-xl bg-black/10" />
          )}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="outlineGold" onClick={() => void loadOwnQr(true)} disabled={rotating}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {rotating ? "Generuojama…" : "Regeneruoti QR"}
          </Button>
          <Button
            variant="outlineGold"
            onClick={() => {
              if (!token) return;
              void navigator.clipboard?.writeText(qrValue);
              toast.success("QR turinys nukopijuotas");
            }}
            disabled={!token}
          >
            <Copy className="mr-2 h-4 w-4" /> Kopijuoti
          </Button>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/10 bg-background/40 p-4 text-left">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Parodyti šį kodą trenerei.
          </p>
        </div>
      </div>
    </div>
  );
}

function ClientResultCard({
  result,
  isAdmin,
  isHalfAdmin,
  onPurchase,
  onRescan,
}: {
  result: ClientResult;
  isAdmin: boolean;
  isHalfAdmin: boolean;
  onPurchase: () => void;
  onRescan: () => void;
}) {
  const sub = result.subscription;
  const nextSub = result.next_subscription;
  const remaining = sub ? Math.max(0, Number(sub.lessons_total) - Number(sub.lessons_used)) : 0;

  return (
    <div className="mt-6 space-y-4">
      <section className="overflow-hidden rounded-3xl border border-gold/20 bg-gradient-card shadow-elegant">
        <div className="bg-gold/5 p-6 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10">
              <UserRound className="h-8 w-8 text-gold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.22em] text-gold/70">Klientas</p>
              <h2 className="mt-1 truncate text-3xl font-display text-gradient-gold">
                {result.client.full_name || "Be vardo"}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {result.client.email && <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4" />{result.client.email}</span>}
                {result.client.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{result.client.phone}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Button variant="gold" size="lg" className="h-14" onClick={onPurchase}>
            <ShoppingBag className="mr-2 h-5 w-5" /> Pirkti abonementą
          </Button>
          {isAdmin ? (
            <Button
              variant="outlineGold"
              size="lg"
              className="h-14"
              asChild
            >
              <Link to={`/admin?section=users&uid=${result.client.id}`}>
                <Settings2 className="mr-2 h-5 w-5" /> Valdyti kliento informaciją
              </Link>
            </Button>
          ) : (
            <Button variant="outlineGold" size="lg" className="h-14" onClick={onRescan}>
              <ScanLine className="mr-2 h-5 w-5" /> Skenuoti kitą QR kodą
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-gold/15 bg-gradient-card p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-gold" />
          <h3 className="font-display text-xl text-gold">Dabartinis abonementas</h3>
        </div>

        {sub ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-gold/10 bg-background/30 p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Liko</p>
                <p className="mt-1 font-display text-4xl text-gradient-gold">{remaining}</p>
                <p className="text-xs text-muted-foreground">iš {sub.lessons_total} treniruočių</p>
              </div>
              <div className="rounded-2xl border border-gold/10 bg-background/30 p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Treniruočių tipas</p>
                <p className="mt-2 font-medium">{packageLabel(sub.package_type)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{horseLabel(sub.horse_type)}</p>
              </div>
              <div className="rounded-2xl border border-gold/10 bg-background/30 p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Galioja iki</p>
                <p className="mt-2 font-display text-xl text-gold">{formatDate(sub.expires_at)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Pradžia: {formatDate(sub.start_from_date || sub.purchase_date)}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-gold/15 bg-background/30 px-3 py-1.5">{subscriptionType(sub)}</span>
              <span className="rounded-full border border-gold/15 bg-background/30 px-3 py-1.5">{Number(sub.price).toFixed(2)} €</span>
              {sub.purchase_method && <span className="rounded-full border border-gold/15 bg-background/30 px-3 py-1.5">{paymentLabel(sub.purchase_method)}</span>}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-blush/20 bg-blush/5 p-5">
            <p className="font-medium">Šiuo metu aktyvaus abonemento nėra.</p>
            <p className="mt-1 text-sm text-muted-foreground">Galite iškart sukurti naują abonementą.</p>
          </div>
        )}

        {nextSub && (
          <div className="mt-4 rounded-2xl border border-gold/20 bg-gold/5 p-4">
            <div className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
              <div>
                <p className="font-medium">Kitas abonementas jau nupirktas</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prasidės {formatDate(nextSub.start_from_date || nextSub.purchase_date)} · {nextSub.lessons_total} treniruotės · {Number(nextSub.price).toFixed(2)} €
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-gold/15 bg-gradient-card p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-gold" />
          <h3 className="font-display text-xl text-gold">Artimiausios rezervacijos</h3>
        </div>

        {result.reservations.length ? (
          <div className="mt-4 space-y-2">
            {result.reservations.slice(0, 5).map((booking) => (
              <div key={booking.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gold/10 bg-background/30 p-3.5">
                <div>
                  <div className="font-medium">{formatDate(booking.slot_date)}</div>
                  <div className="text-sm text-gold">{booking.slot_time.slice(0, 5)}</div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {booking.subscription_id ? "Susieta su abonementu" : "Laukia priskyrimo"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Būsimų rezervacijų nėra.</p>
        )}
      </section>

      <Button variant="outlineGold" className="w-full" onClick={onRescan}>
        <ScanLine className="mr-2 h-4 w-4" /> Skenuoti kitą klientą
      </Button>
    </div>
  );
}

function SubscriptionPurchaseDialog({
  open,
  onOpenChange,
  client,
  isHalfAdmin,
  onPurchased,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientResult;
  isHalfAdmin: boolean;
  onPurchased: () => Promise<void>;
}) {
  const [packageType, setPackageType] = useState<"group" | "po2">("group");
  const [horseType, setHorseType] = useState<"school" | "own">("school");
  const [lessons, setLessons] = useState("4");
  const [otherQuantity, setOtherQuantity] = useState("");
  const [quantityMode, setQuantityMode] = useState<"preset" | "other">("preset");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [allocationMode, setAllocationMode] = useState<"none" | "today" | "next">("next");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingPrices(true);
    supabase
      .from("subscription_prices")
      .select("lessons_total, package_type, horse_type, price_eur")
      .eq("active", true)
      .then(({ data, error }) => {
        setLoadingPrices(false);
        if (error) {
          toast.error(error.message);
          return;
        }
        setPrices(
          Object.fromEntries(
            (data ?? []).map((row: any) => [
              `${row.lessons_total}|${row.package_type}|${row.horse_type}`,
              Number(row.price_eur),
            ]),
          ),
        );
      });
  }, [open]);

  const count = quantityMode === "preset" ? Number(lessons) : Number(otherQuantity);
  const price = prices[`${count}|${packageType}|${horseType}`];
  const validCount = Number.isInteger(count) && count >= 1 && count <= 12 && Number.isFinite(price);

  const purchase = async () => {
    if (!validCount) {
      toast.error("Pasirinkite kiekį, kuriam yra sukonfigūruota kaina.");
      return;
    }

    setSaving(true);

    const purchaseRpc = isHalfAdmin ? "half_admin_purchase_subscription" : "admin_purchase_subscription";
    const { data, error } = await (supabase as any).rpc(purchaseRpc, {
      _user_id: client.client.id,
      _lessons_total: count,
      _package_type: packageType,
      _horse_type: horseType,
      _allocation_mode: allocationMode,
      _payment_method: paymentMethod,
    });

    setSaving(false);

    if (error) {
      toast.error(
        error.message?.includes("PRICE_NOT_CONFIGURED")
          ? "Šio varianto kaina nesukonfigūruota."
          : error.message?.includes("INVALID_PAYMENT_METHOD")
            ? "Šis mokėjimo būdas dar nesukonfigūruotas."
            : error.message,
      );
      return;
    }

    if (!data?.ok || !data?.subscription_id) {
      toast.error("Pirkimas nebuvo patvirtintas.");
      return;
    }

    const start = formatDate(data.start_from_date);
    const expiry = formatDate(data.expires_at);
    const allocationText = data.booking_id
      ? " Rezervacija priskirta."
      : allocationMode === "none"
        ? ""
        : " Rezervacijos pagal pasirinktą kriterijų nerasta.";

    toast.success(
      `Pirkimas patvirtintas · ${Number(data.price_eur).toFixed(2)} € · pradžia ${start} · galioja iki ${expiry}.${allocationText}`,
      { duration: 7000 },
    );

    await onPurchased();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto bg-gradient-card border-gold/20 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-gradient-gold">
            Naujas abonementas
          </DialogTitle>
          <DialogDescription>
            {client.client.full_name || "Klientui"} · kainas galite rasti "Kainos" meniu skiltyje.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label>Treniruočių skaičius</Label>
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {Array.from({ length: 12 }, (_, index) => index + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setQuantityMode("preset");
                    setLessons(String(n));
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    quantityMode === "preset" && Number(lessons) === n
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-gold/15 bg-background/30 hover:border-gold/40"
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setQuantityMode("other")}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  quantityMode === "other"
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-gold/15 bg-background/30 hover:border-gold/40"
                }`}
              >
                Kita
              </button>
            </div>
            {quantityMode === "other" && (
              <Input
                className="mt-2"
                type="number"
                min={1}
                max={12}
                value={otherQuantity}
                onChange={(e) => setOtherQuantity(e.target.value)}
                placeholder="Įveskite 1–12"
              />
            )}
          </div>

          <div>
            <Label>Treniruočių tipas</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                ["group", "Grupinė"],
                ["po2", "Asmeninė po 2"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPackageType(value)}
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    packageType === value
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-gold/15 bg-background/30 hover:border-gold/40"
                  }`}
                >
                  <div className="font-medium">{label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {value === "group" ? "Sportinė grupinė" : "Sportinė po 2"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Žirgai</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                ["school", "Mokyklos žirgais"],
                ["own", "Nuosavais žirgais"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHorseType(value)}
                  className={`rounded-2xl border p-3 text-left transition-colors ${
                    horseType === value
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-gold/15 bg-background/30 hover:border-gold/40"
                  }`}
                >
                  <div className="font-medium">{label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-gold/25 bg-gold/5 p-5 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mokėtina suma</p>
            <p className="mt-1 font-display text-5xl text-gradient-gold">
              {loadingPrices ? "…" : validCount ? `${price.toFixed(2)} €` : "—"}
            </p>
            {validCount && (
              <p className="mt-2 text-sm text-muted-foreground">
                {count} treniruotės · {packageLabel(packageType)} · {horseLabel(horseType)}
              </p>
            )}
            {!loadingPrices && quantityMode === "other" && !validCount && otherQuantity && (
              <p className="mt-2 text-xs text-blush">Šiam kiekiui kainyno įrašo nėra.</p>
            )}
          </div>

          <div>
            <Label>Mokėjimo būdas</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                className={`rounded-2xl border p-3 text-left ${
                  paymentMethod === "cash" ? "border-gold bg-gold/10 text-gold" : "border-gold/15 bg-background/30"
                }`}
              >
                <Banknote className="mb-2 h-5 w-5" />
                <div className="font-medium">Grynais</div>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod("bank_transfer")}
                className={`rounded-2xl border p-3 text-left ${
                  paymentMethod === "bank_transfer" ? "border-gold bg-gold/10 text-gold" : "border-gold/15 bg-background/30"
                }`}
              >
                <CreditCard className="mb-2 h-5 w-5" />
                <div className="font-medium">Bankiniu pavedimu</div>
              </button>
            </div>
          </div>

          <div>
            <Label>Priskirti treniruotę</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {([
                ["none", "Neskirti"],
                ["today", "Šiandien"],
                ["next", "Kita rezervacija"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAllocationMode(value)}
                  className={`rounded-2xl border px-3 py-3 text-sm font-medium ${
                    allocationMode === value ? "border-gold bg-gold/10 text-gold" : "border-gold/15 bg-background/30"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sistema pati priskirs tik tinkamą aktyvią rezervaciją pagal abonemento tipą.
            </p>
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Atšaukti
          </Button>
          <Button variant="gold" size="lg" onClick={() => void purchase()} disabled={saving || !validCount}>
            {saving ? "Tvirtinama…" : "PATVIRTINTI PIRKIMĄ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
