import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type PendingDevice = {
  challengeId: string | null;
  userId: string;
  name: string;
  createdAt: string | null;
  expiresAt: string | null;
};
type ApiResponse = {
  pending?: PendingDevice[];
  code?: string;
  expiresAt?: string;
  error?: string;
};

const errorMessage = (error?: string) => {
  switch (error) {
    case "ADMIN_MFA_REQUIRED": return "Įjunkite ir patvirtinkite 2FA skiltyje „Saugumas“.";
    case "ADMIN_ONLY": return "Kodą gali sukurti tik pagrindinis administratorius.";
    case "NO_ACTIVE_CHALLENGE": return "Kodas nebegalioja. Raitelis turi prisijungti iš naujo.";
    case "CHALLENGE_REPLACED": return "Raitelis jau turi naujesnį kodą.";
    case "RATE_LIMITED": return "Pasiektas limitas: 2 kodai per valandą.";
    case "UNAUTHORIZED": return "Prisijunkite iš naujo ir bandykite dar kartą.";
    case "ROLE_CHECK_FAILED": return "Nepavyko patikrinti administratoriaus teisių.";
    default: return "Nepavyko atlikti veiksmo (" + (error || "nežinoma klaida") + ").";
  }
};

async function callAdmin(action: "list" | "generate", target?: PendingDevice): Promise<ApiResponse> {
  const { data, error } = await supabase.functions.invoke("admin-new-device-code", {
    body: {
      action,
      ...(target ? { targetUserId: target.userId, challengeId: target.challengeId } : {}),
    },
  });
  if (error || !data || (data as ApiResponse).error) {
    let details = (data as ApiResponse | null)?.error;
    // FunctionHttpError stores the JSON body in the response context.
    if (!details && error && "context" in error) {
      try {
        const context = (error as {context?: Response}).context;
        if (context && typeof context.json === "function") {
          const body = await context.json() as {error?:string};
          details = body.error;
        }
      } catch { /* Preserve original error below. */ }
    }
    throw new Error(details || error?.message || "UNKNOWN");
  }
  return data as ApiResponse;
}

export function AdminDeviceCodes() {
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [shown, setShown] = useState<{ code: string; expiresAt: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMessageText, setErrorMessageText] = useState("");
  const selected = pending.find((item) => item.userId === selectedId);
  const canGenerate = Boolean(selected?.challengeId);

  const refresh = async () => {
    setLoading(true);
    setShown(null);
    setErrorMessageText("");
    try {
      const result = await callAdmin("list");
      setPending(result.pending ?? []);
      setSelectedId((previous) => (result.pending ?? []).some((p) => p.userId === previous) ? previous : "");
    } catch (error) {
      setErrorMessageText(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const generate = async () => {
    if (!selected || !selected.challengeId || generating) return;
    if (!window.confirm("Išduoti naują atsarginį kodą raiteliui „" + selected.name + "“? Anksčiau siųstas el. pašto kodas nebegalios.")) return;
    setGenerating(true);
    setShown(null);
    setErrorMessageText("");
    try {
      const result = await callAdmin("generate", selected);
      if (!result.code || !result.expiresAt) throw new Error("UNKNOWN");
      setShown({ code: result.code, expiresAt: result.expiresAt, name: selected.name });
      toast.success("Atsarginis kodas sukurtas.");
    } catch (error) {
      setErrorMessageText(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setGenerating(false);
    }
  };

  return <div className="space-y-4">
    <h3 className="font-display text-lg">Naujo įrenginio atsarginis kodas</h3>
    <p className="text-sm text-muted-foreground">
      Pasirinkite raitelį ir sukurkite naują kodą.
    </p>
    <div className="space-y-2">
      <label htmlFor="pending-device-user" className="text-sm font-medium">Raitelis</label>
      <select id="pending-device-user" value={selectedId}
        onChange={(event) => { setSelectedId(event.target.value); setShown(null); setErrorMessageText(""); }}
        className="flex h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
        disabled={loading || generating}>
        <option value="">{loading ? "Kraunama…" : "Pasirinkite raitelį…"}</option>
        {pending.map((item) => <option value={item.userId} key={item.userId}>
          {item.name}{item.challengeId ? " · Laukia kodo" : ""}
        </option>)}
      </select>
      {selected && !canGenerate && <p className="text-xs text-muted-foreground">
        Raitelis dar nelaukia kodo. Tegul prisijungia.
      </p>}
      {selected && canGenerate && <p className="text-xs text-muted-foreground">
        Laukia kodo. Ankstesnis kodas nebegalios.
      </p>}
      <Button variant="gold" disabled={!canGenerate || generating || loading} onClick={() => void generate()}>
        {generating ? "Kuriama…" : "Sukurti atsarginį kodą"}
      </Button>
    </div>
    <div><Button variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>
      {loading ? "Atnaujinama…" : "Atnaujinti"}
    </Button></div>

    {errorMessageText && <p className="text-sm text-destructive" role="alert">
      {errorMessageText}{" "}
      {errorMessageText.includes("2FA") && <Link className="underline text-gold" to="/saugumas">Atidaryti Saugumą</Link>}
    </p>}

    {shown && <div className="space-y-3 border-t border-gold/30 pt-4" role="status">
      <p className="text-sm font-medium">Atsarginis kodas: {shown.name}</p>
      <p className="select-all font-mono text-4xl font-bold tracking-[0.25em] text-gold" aria-label="Atsarginis kodas">{shown.code}</p>
      <p className="text-xs text-muted-foreground">
        Iki {new Date(shown.expiresAt).toLocaleTimeString("lt-LT", {hour:"2-digit",minute:"2-digit"})}. Vienkartinis kodas, 5 bandymai.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(shown.code).then(() => toast.success("Kodas nukopijuotas")).catch(() => toast.error("Nepavyko nukopijuoti"))}>Kopijuoti kodą</Button>
        <Button variant="ghost" onClick={() => setShown(null)}>Paslėpti kodą</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Kodą perduokite tik patvirtinę raitelio tapatybę.
      </p>
    </div>}
  </div>;
}
