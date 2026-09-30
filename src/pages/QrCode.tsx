import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  Copy,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Mail,
  Phone,
  CalendarDays,
  CreditCard,
  QrCode,
  ScanLine,
  ArrowLeft,
} from "lucide-react";

const PREFIX = "EQUUS-CLIENT:";

type ClientResult = {
  client: { id: string; full_name: string | null; email: string | null; phone: string | null };
  subscription: {
    lessons_total: number;
    lessons_used: number;
    expires_at: string;
    price: number;
    paid: boolean;
    package_type?: string | null;
    horse_type?: string | null;
  } | null;
  reservations: Array<{ id: string; slot_date: string; slot_time: string; status: string; checked_in_at?: string | null }>;
};

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

export default function QrCodePage({ scanner = false }: { scanner?: boolean }) {
  const { user, isAdmin, isTrainer } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [scannedToken, setScannedToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [client, setClient] = useState<ClientResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [confirmingBookingId, setConfirmingBookingId] = useState<string | null>(null);
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
    if (error) { toast.error(error.message); return; }
    if (!data?.ok && data?.reason === "NO_QR") {
      const { data: issued, error: issueError } = await (supabase as any).rpc("issue_client_qr_token");
      if (issueError) { toast.error(issueError.message); return; }
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
    if (error) { toast.error("QR kodas neatpažintas arba nebegalioja."); return; }
    setClient(data as ClientResult);
    setManual("");
  }, [stopScanner]);

  useEffect(() => {
    if (!scanner && user) void loadOwnQr();
    return () => { void stopScanner(); };
  }, [scanner, user, loadOwnQr, stopScanner]);

  const confirmAttendance = async (bookingId: string) => {
    if (!client) return;
    setConfirmingBookingId(bookingId);
    const { data, error } = await (supabase as any).rpc("confirm_client_qr_attendance", {
      _token: scannedToken ?? "",
      _booking_id: bookingId,
    });
    setConfirmingBookingId(null);
    if (error || !data?.ok) {
      toast.error(error?.message ?? "Nepavyko patvirtinti atvykimo.");
      return;
    }
    setClient((current) => current ? ({
      ...current,
      reservations: current.reservations.map((b) =>
        b.id === bookingId ? { ...b, checked_in_at: data.checked_in_at ?? new Date().toISOString() } : b
      ),
    }) : current);
    toast.success("Atvykimas patvirtintas ✓");
  };

  const startScanner = async () => {
    setClient(null);
    setScannedToken(null);
    setScannerOpen(true);
    await new Promise((r) => setTimeout(r, 50));
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

  if (scanner) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6">
          <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-gold">
            <ArrowLeft className="h-4 w-4" /> Grįžti
          </Link>
          <p className="mt-5 text-xs uppercase tracking-[0.25em] text-gold/70">Klientai</p>
          <h1 className="text-4xl font-display text-gradient-gold">Skenuoti kliento QR</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Skenavimas vyksta šiame įrenginyje — QR turinys siunčiamas tik į Equus.
          </p>
        </div>

        {!scannerOpen && !client && (
          <div className="rounded-3xl border border-gold/15 bg-gradient-card p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
              <ScanLine className="h-7 w-7 text-gold" />
            </div>
            <h2 className="mt-4 text-xl font-display">Paruošta skenuoti</h2>
            <p className="mt-2 text-sm text-muted-foreground">Naudokite galinę kamerą ir nukreipkite ją į kliento QR kodą.</p>
            <Button variant="gold" className="mt-5" onClick={() => void startScanner()}>
              <Camera className="mr-2 h-4 w-4" /> Įjungti kamerą
            </Button>
          </div>
        )}

        {scannerOpen && (
          <div className="rounded-3xl border border-gold/15 bg-black/20 p-3">
            <div id="equus-qr-reader" className="overflow-hidden rounded-2xl" />
            <Button variant="outlineGold" className="mt-3 w-full" onClick={() => { void stopScanner(); setScannerOpen(false); }}>
              Išjungti kamerą
            </Button>
          </div>
        )}

        {!client && (
          <div className="mt-4 rounded-2xl border border-gold/10 bg-card/50 p-4">
            <p className="text-sm font-medium">Testavimui galima įklijuoti QR turinį</p>
            <div className="mt-3 flex gap-2">
              <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="EQUUS-CLIENT:..." />
              <Button variant="outlineGold" onClick={() => void resolve(manual)} disabled={!manual.trim() || resolving}>
                Tikrinti
              </Button>
            </div>
          </div>
        )}

        {client && (
          <ClientResultCard
            result={client}
            onReset={() => setClient(null)}
            onConfirm={confirmAttendance}
            confirmingBookingId={confirmingBookingId}
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
          Parodykite šį kodą administratoriui ar treneriui, kad Jus greitai atpažintų.
        </p>
      </div>

      <div className="mt-8 rounded-3xl border border-gold/15 bg-gradient-card p-6 sm:p-8">
        <div className="mx-auto w-fit rounded-2xl bg-white p-4 shadow-xl">
          {token ? <QRCodeSVG value={qrValue} size={280} level="M" includeMargin /> : <div className="h-[280px] w-[280px] animate-pulse rounded-xl bg-black/10" />}
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button variant="outlineGold" onClick={() => void loadOwnQr(true)} disabled={rotating}>
            <RefreshCw className="mr-2 h-4 w-4" /> {rotating ? "Generuojama…" : "Regeneruoti QR"}
          </Button>
          <Button variant="outlineGold" onClick={() => {
            if (!token) return;
            void navigator.clipboard?.writeText(qrValue);
            toast.success("QR turinys nukopijuotas");
          }} disabled={!token}>
            <Copy className="mr-2 h-4 w-4" /> Kopijuoti
          </Button>
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-gold/10 bg-background/40 p-4 text-left">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            QR kode nėra Jūsų vardo, el. pašto ar telefono. Jis naudoja atsitiktinį techninį raktą. Regeneravus senasis kodas iš karto nustoja galioti.
          </p>
        </div>
      </div>
    </div>
  );
}

function ClientResultCard({
  result,
  onReset,
  onConfirm,
  confirmingBookingId,
}: {
  result: ClientResult;
  onReset: () => void;
  onConfirm: (bookingId: string) => void;
  confirmingBookingId: string | null;
}) {
  const sub = result.subscription;
  const remaining = sub ? Math.max(0, Number(sub.lessons_total) - Number(sub.lessons_used)) : 0;
  const formatDate = (value: string) => new Date(value + (value.length === 10 ? "T12:00:00" : "")).toLocaleDateString("lt-LT");

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-3xl border border-gold/15 bg-gradient-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10"><UserRound className="h-6 w-6 text-gold" /></div>
          <div className="min-w-0">
            <h2 className="text-2xl font-display">{result.client.full_name || "Be vardo"}</h2>
            {result.client.email && <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-4 w-4" />{result.client.email}</p>}
            {result.client.phone && <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Phone className="h-4 w-4" />{result.client.phone}</p>}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-gold/15 bg-gradient-card p-6">
        <div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-gold" /><h3 className="font-display text-lg">Abonementas</h3></div>
        {sub ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label="Liko" value={String(remaining)} />
            <Metric label="Iš viso" value={String(sub.lessons_total)} />
            <Metric label="Galioja iki" value={formatDate(sub.expires_at)} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Aktyvaus apmokėto abonemento nėra.</p>
        )}
      </div>

      <div className="rounded-3xl border border-gold/15 bg-gradient-card p-6">
        <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-gold" /><h3 className="font-display text-lg">Artimiausios rezervacijos</h3></div>
        {result.reservations.length ? (
          <div className="mt-4 space-y-2">
            {result.reservations.map((booking) => (
              <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/10 bg-background/30 p-3 text-sm">
                <div>
                  <div>{formatDate(booking.slot_date)}</div>
                  <div className="font-medium text-gold">{booking.slot_time.slice(0,5)}</div>
                </div>
                {booking.checked_in_at ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                    <CheckCircle2 className="h-4 w-4" /> Atvykimas patvirtintas
                  </span>
                ) : (
                  (() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const canConfirm = booking.status === "active" && booking.slot_date === today;
                    return canConfirm ? (
                      <Button
                        size="sm"
                        variant="gold"
                        onClick={() => onConfirm(booking.id)}
                        disabled={confirmingBookingId === booking.id}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                        {confirmingBookingId === booking.id ? "Tvirtinama…" : "Patvirtinti atvykimą"}
                      </Button>
                    ) : null;
                  })()
                )}
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">Būsimų rezervacijų nėra.</p>}
      </div>

      <Button variant="outlineGold" className="w-full" onClick={onReset}>
        <ScanLine className="mr-2 h-4 w-4" /> Skenuoti kitą
      </Button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-gold/10 bg-background/30 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-display text-gold">{value}</p></div>;
}
