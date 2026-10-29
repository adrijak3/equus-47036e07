import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function reportHandledError(error: unknown, context: string) {
  window.dispatchEvent(new CustomEvent("equus:app-error", { detail: { error, context } }));
}

type PendingBug = {
  fingerprint: string;
  message: string;
  errorName: string;
  errorCode: string | null;
  pagePath: string;
  stack: string | null;
  occurrenceCount: number;
};

const STORAGE_KEY = "equus_bug_occurrences_v1";
const PROMPT_KEY = "equus_bug_prompted_v1";

function safeMessage(value: unknown) {
  const details = value && typeof value === "object" ? value as { message?: string; code?: string } : null;
  const base = value instanceof Error ? value.message : details?.message ?? String(value ?? "Nežinoma klaida");
  const raw = details?.code ? `${base} (kodas: ${details.code})` : base;
  return raw.replace(/https?:\/\/[^\s)]+/g, "[URL]").slice(0, 1500);
}

function getErrorCode(message: string) {
  return message.match(/\b(?:[A-Z]{2,}[A-Z0-9_]{1,}|\d{3,})\b/)?.[0] ?? null;
}

function fingerprintFor(name: string, message: string, path: string) {
  const normalized = message.toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "[id]").replace(/\s+/g, " ").trim();
  return [name, normalized, path].join("|").slice(0, 500);
}

export function BugReporter() {
  const [pending, setPending] = useState<PendingBug | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const record = (name: string, messageValue: unknown, stack?: string | null) => {
      const message = safeMessage(messageValue);
      const pagePath = window.location.pathname;
      const fingerprint = fingerprintFor(name, message, pagePath);
      let counts: Record<string, number> = {};
      let prompted: Record<string, number> = {};
      try {
        counts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        prompted = JSON.parse(localStorage.getItem(PROMPT_KEY) || "{}");
      } catch {
        counts = {};
        prompted = {};
      }

      const occurrenceCount = (Number(counts[fingerprint]) || 0) + 1;
      counts[fingerprint] = occurrenceCount;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(counts)); } catch { /* reporting still works without persistent counts */ }

      const lastPrompt = Number(prompted[fingerprint]) || 0;
      const now = Date.now();
      if (occurrenceCount >= 3 && now - lastPrompt > 24 * 60 * 60 * 1000) {
        prompted[fingerprint] = now;
        try { localStorage.setItem(PROMPT_KEY, JSON.stringify(prompted)); } catch { /* ignore storage restrictions */ }
        setPending({
          fingerprint,
          message,
          errorName: name.slice(0, 120),
          errorCode: getErrorCode(message),
          pagePath,
          stack: stack ? stack.slice(0, 6000) : null,
          occurrenceCount,
        });
      }
    };

    const onHandledError = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const error = detail?.error;
      const context = String(detail?.context || "Programos veiksmas");
      record(error?.name || "ApplicationError", context + ": " + safeMessage(error), error?.stack);
    };
    const onError = (event: ErrorEvent) => {
      record(event.error?.name || "JavaScriptError", event.message || event.error?.message, event.error?.stack);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      record(reason?.name || "UnhandledPromiseRejection", reason?.message ?? reason, reason?.stack);
    };

    window.addEventListener("error", onError);
    window.addEventListener("equus:app-error", onHandledError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("equus:app-error", onHandledError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const submit = async () => {
    if (!pending || sending) return;
    setSending(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("bug_reports").insert({
        fingerprint: pending.fingerprint,
        error_name: pending.errorName,
        error_message: pending.message,
        error_code: pending.errorCode,
        page_path: pending.pagePath,
        stack_trace: pending.stack,
        occurrence_count: pending.occurrenceCount,
        user_id: userData.user?.id ?? null,
        user_agent: navigator.userAgent.slice(0, 500),
      });
      if (error) throw error;
      setPending(null);
      toast.success("Ačiū! Klaidos pranešimas išsiųstas administracijai.");
    } catch {
      toast.error("Nepavyko išsiųsti pranešimo. Bandykite dar kartą.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ar norite pranešti apie šią problemą?</DialogTitle>
          <DialogDescription>
            Panašu, kad ta pati techninė klaida pasikartojo kelis kartus. Jei sutiksite, klaidos informaciją automatiškai išsiųsime Equus administracijai. Jums nieko papildomai daryti nereikės.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-gold/15 bg-background/40 p-3 text-sm">
          <p className="font-medium">{pending?.errorName}</p>
          <p className="mt-1 break-words text-muted-foreground">{pending?.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">Pasikartojo šiame įrenginyje: {pending?.occurrenceCount} kartus</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPending(null)}>Ne, ačiū</Button>
          <Button variant="gold" disabled={sending} onClick={() => void submit()}>
            {sending ? "Siunčiama..." : "Taip, pranešti"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
