import { useEffect, useRef, useState } from "react";
import { useSonner, toast } from "sonner";
import { AlertCircle, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Use for handled API errors that are not otherwise surfaced as a Sonner error toast. */
export function reportHandledError(error: unknown, context: string) {
  window.dispatchEvent(new CustomEvent("equus:app-error", { detail: { error, context } }));
}

type PendingBug = {
  fingerprint: string;
  message: string;
  errorName: string;
  errorCode: string | null;
  pagePath: string;
  occurredAt: string;
  actionContext: string;
  occurrenceCount: number;
};

const COUNT_STORAGE_KEY = "equus_bug_occurrences_v1";
const MAX_MESSAGE = 1500;

function scrub(value: unknown, maxLength = MAX_MESSAGE): string {
  const text = String(value ?? "Nežinoma klaida");
  // Never transmit user-entered secrets, URL parameters, tokens, emails or phone numbers.
  return text
    .replace(/https?:\/\/[^\s)]+/gi, "[nuoroda]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[el. paštas]")
    .replace(/\b(?:bearer|access_token|refresh_token|password|passwd|secret|apikey|api_key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, "[slapti duomenys]")
    .replace(/\b(?:otp|pin|verification code|patvirtinimo kodas|kodas)\s*[:=]?\s*\d{4,8}\b/gi, "[patvirtinimo kodas]")
    .replace(/\b(?:password|slaptažodis)\s*(?:yra|is|=|:)\s*\S+/gi, "[slaptažodis]")
    .replace(/\b(?:\+?370|8)\d{8}\b/g, "[telefonas]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[ID]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){1,2}\b/g, "[prisijungimo duomenys]")
    .slice(0, maxLength);
}

function codeFor(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[a-zA-Z0-9_\-]{1,120}$/.test(code) ? code : null;
}

function messageFor(error: unknown): string {
  if (error instanceof Error) return scrub(error.message);
  if (error && typeof error === "object" && "message" in error) {
    return scrub((error as { message?: unknown }).message);
  }
  return scrub(error);
}

function fingerprintFor(name: string, message: string, path: string) {
  return [name, message.toLowerCase().replace(/\d{2,}/g, "[skaičius]"), path].join("|").slice(0, 500);
}

export function BugReporter() {
  const { user } = useAuth();
  const { toasts } = useSonner();
  const [pending, setPending] = useState<PendingBug | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [action, setAction] = useState("");
  const [notes, setNotes] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const lastAction = useRef("Nežinomas veiksmas");
  const lastEvent = useRef<{ fingerprint: string; at: number } | null>(null);
  const handledToastIds = useRef(new Set<string | number>());
  const pendingRef = useRef<PendingBug | null>(null);

  const record = (error: unknown, name: string, context?: string) => {
    const message = messageFor(error);
    const pagePath = window.location.pathname.slice(0, 300); // Never include URL query tokens.
    const fingerprint = fingerprintFor(name, message, pagePath);
    const now = Date.now();
    if (lastEvent.current?.fingerprint === fingerprint && now - lastEvent.current.at < 2500) return;
    lastEvent.current = { fingerprint, at: now };

    let count = 1;
    try {
      const all = JSON.parse(localStorage.getItem(COUNT_STORAGE_KEY) || "{}") as Record<string, number>;
      count = Math.min(100000, (Number(all[fingerprint]) || 0) + 1);
      // Avoid unbounded localStorage growth.
      const entries = Object.entries(all).slice(-49);
      localStorage.setItem(COUNT_STORAGE_KEY, JSON.stringify({ ...Object.fromEntries(entries), [fingerprint]: count }));
    } catch { /* report is still available */ }

    const next: PendingBug = {
      fingerprint,
      message,
      errorName: scrub(name, 120) || "ApplicationError",
      errorCode: codeFor(error),
      pagePath,
      occurredAt: new Date().toISOString(),
      actionContext: scrub(context || lastAction.current, 240),
      occurrenceCount: count,
    };
    // Avoid replacing an unsent report with a second error.
    if (!pendingRef.current) {
      pendingRef.current = next;
      setPending(next);
      setAction(next.actionContext);
      setNotes("");
      setContactEmail(user?.email || "");
    }
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const node = event.target instanceof Element ? event.target.closest('button, [role="button"], a') : null;
      if (!node || node.closest('[data-error-reporter]')) return;
      const label = node.getAttribute("aria-label") || node.textContent?.trim() || "";
      if (label && label.length <= 100) lastAction.current = scrub(label.replace(/\s+/g, " "), 100);
    };
    const onHandledError = (event: Event) => {
      const detail = (event as CustomEvent<{ error?: unknown; context?: string }>).detail;
      record(detail?.error, "ApplicationError", detail?.context || undefined);
    };
    const onError = (event: ErrorEvent) => {
      record(event.error ?? event.message, event.error?.name || "JavaScriptError");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      record(event.reason, "UnhandledPromiseRejection");
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("error", onError);
    window.addEventListener("equus:app-error", onHandledError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("equus:app-error", onHandledError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
    // Event listeners are installed once; user identity is read separately on submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture the normal app-wide toast.error(...) path, not just uncaught crashes.
  useEffect(() => {
    for (const item of toasts) {
      if (item.type !== "error" || handledToastIds.current.has(item.id)) continue;
      handledToastIds.current.add(item.id);
      if (typeof item.title === "string") record(item.title, "DisplayedError");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  const dismiss = () => {
    pendingRef.current = null;
    setPending(null);
    setDialogOpen(false);
  };

  const submit = async () => {
    if (!pending || sending) return;
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      toast.error("Patikrinkite kontaktinį el. paštą arba palikite lauką tuščią.");
      return;
    }
    setSending(true);
    const { error } = await (supabase as any).from("bug_reports").insert({
      fingerprint: pending.fingerprint,
      error_name: pending.errorName,
      error_message: pending.message,
      error_code: pending.errorCode,
      page_path: pending.pagePath,
      stack_trace: null, // Raw stack traces can contain private values.
      occurrence_count: pending.occurrenceCount,
      user_id: user?.id ?? null,
      user_agent: navigator.userAgent.slice(0, 500),
      action_context: scrub(action || pending.actionContext, 240),
      user_notes: scrub(notes, 500) || null,
      contact_email: contactEmail.trim() || null,
      occurred_at: pending.occurredAt,
    });
    setSending(false);
    if (error) {
      toast.error("Nepavyko išsiųsti pranešimo. Bandykite dar kartą.");
      return;
    }
    dismiss();
    toast.success("Klaidos pranešimas perduotas Equus administracijai. Ačiū!");
  };

  return (
    <>
      {pending && !dialogOpen && (
        <div data-error-reporter className="fixed bottom-[calc(7.5rem+env(safe-area-inset-bottom))] left-3 z-[60] w-[min(370px,calc(100vw-1.5rem))] rounded-xl border border-destructive/40 bg-card p-4 text-card-foreground shadow-xl sm:bottom-6 sm:left-6" role="status">
          <div className="flex items-start gap-2">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Įvyko klaida?</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Galite vienu mygtuku perduoti klaidos informaciją administratorei.</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">Klaida: {pending.errorCode || pending.message}</p>
            </div>
            <button type="button" onClick={dismiss} aria-label="Uždaryti klaidos pranešimą" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <Button type="button" variant="gold" className="mt-3 min-h-11 w-full" onClick={() => { if (user?.email && !contactEmail) setContactEmail(user.email); setDialogOpen(true); }}>
            <Send aria-hidden="true" className="mr-2 h-4 w-4" /> Siųsti klaidą administratorei
          </Button>
        </div>
      )}
      <Dialog open={Boolean(pending && dialogOpen)} onOpenChange={setDialogOpen}>
        <DialogContent data-error-reporter className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pranešti administratorei apie klaidą</DialogTitle>
            <DialogDescription>
              Išsiųsime puslapį, klaidos laiką, kodą, aprašymą ir naršyklės informaciją. Slaptažodžių, įvestų formų, patvirtinimo kodų ir prisijungimo raktų nesiunčiame.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p><strong>Klaida:</strong> {pending?.message}</p>
              <p className="mt-1"><strong>Kodas:</strong> {pending?.errorCode || "nenurodytas"}</p>
              <p className="mt-1"><strong>Puslapis:</strong> {pending?.pagePath}</p>
              <p className="mt-1"><strong>Laikas:</strong> {pending && new Date(pending.occurredAt).toLocaleString("lt-LT")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="bug-action">Ką bandėte padaryti?</Label>
              <Input id="bug-action" value={action} maxLength={240} onChange={(event) => setAction(event.target.value)} placeholder="Pvz., užsiregistruoti į treniruotę" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bug-notes">Papildoma informacija (nebūtina)</Label>
              <Textarea id="bug-notes" value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Pvz., pasirinkau trečiadienį, 18:00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bug-contact">Jūsų el. paštas atsakymui (nebūtina)</Label>
              <Input id="bug-contact" type="email" autoComplete="email" value={contactEmail} maxLength={254} onChange={(event) => setContactEmail(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={sending} onClick={() => setDialogOpen(false)}>Atgal</Button>
            <Button type="button" variant="gold" disabled={sending} onClick={() => void submit()}>
              {sending ? "Siunčiama…" : "Siųsti administratorei"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
