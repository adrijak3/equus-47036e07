import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type PendingDevice = {
  challengeId: string;
  userId: string;
  name: string;
  createdAt: string;
  expiresAt: string;
};
type ApiResponse = {
  pending?: PendingDevice[];
  code?: string;
  expiresAt?: string;
  error?: string;
};

const errorMessage = (error?: string) => {
  switch (error) {
    case "ADMIN_MFA_REQUIRED": return "Norėdami išduoti kodą, pirma įjunkite autentifikatoriaus 2FA savo paskyroje ir patvirtinkite jį.";
    case "ADMIN_ONLY": return "Ši funkcija skirta tik nuolatiniams administratoriams.";
    case "NO_ACTIVE_CHALLENGE": return "Raitelio patvirtinimas nebegalioja. Paprašykite iš naujo prisijungti.";
    case "CHALLENGE_REPLACED": return "Raitelis jau gavo kitą kodą. Atnaujinkite sąrašą.";
    case "RATE_LIMITED": return "Šiam raiteliui per pastarąją valandą jau išduoti 2 atsarginiai kodai.";
    default: return "Nepavyko atlikti veiksmo. Atnaujinkite sąrašą ir bandykite dar kartą.";
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
    const details = (data as ApiResponse | null)?.error;
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
  const selected = pending.find((item) => item.challengeId === selectedId);

  const refresh = async () => {
    setLoading(true);
    setShown(null);
    setErrorMessageText("");
    try {
      const result = await callAdmin("list");
      setPending(result.pending ?? []);
      setSelectedId("");
    } catch (error) {
      setErrorMessageText(errorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setLoading(false);
    }
  };

  const generate = async () => {
    if (!selected || generating) return;
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
    <div className="space-y-2">
      <h3 className="font-display text-lg">Naujo įrenginio atsarginis kodas</h3>
      <p className="text-sm text-muted-foreground">
        Kai laiškas vėluoja, galite išduoti vienkartinį kodą raiteliui, kuris jau laukia naujo įrenginio patvirtinimo.
        Saugumo sumetimais šis veiksmas leidžiamas tik nuolatiniam administratoriui su įjungtu autentifikatoriumi (2FA).
      </p>
      <Button variant="outlineGold" disabled={loading || generating} onClick={() => void refresh()}>
        {loading ? "Ieškoma…" : "Rodyti laukiančius raitelius"}
      </Button>
    </div>

    {pending.length > 0 && <div className="space-y-2">
      <label htmlFor="pending-device-user" className="text-sm font-medium">Pasirinkite raitelį</label>
      <select id="pending-device-user" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShown(null); }}
        className="flex h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground">
        <option value="">Pasirinkite…</option>
        {pending.map((item) => <option value={item.challengeId} key={item.challengeId}>
          {item.name} · {new Date(item.createdAt).toLocaleTimeString("lt-LT", {hour:"2-digit",minute:"2-digit"})} · {item.userId.slice(0,8)}
        </option>)}
      </select>
      <Button variant="gold" disabled={!selected || generating} onClick={() => void generate()}>
        {generating ? "Kuriama…" : "Sukurti atsarginį kodą"}
      </Button>
    </div>}

    {!loading && !pending.length && !errorMessageText && <p className="text-xs text-muted-foreground">
      Spauskite „Rodyti laukiančius raitelius“. Matysite tik aktyvius, dar nepatvirtintus prisijungimus.
    </p>}

    {errorMessageText && <p className="text-sm text-destructive" role="alert">
      {errorMessageText}{" "}
      {errorMessageText.includes("2FA") && <Link className="underline text-gold" to="/saugumas">Atidaryti Saugumą</Link>}
    </p>}

    {shown && <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 space-y-3" role="status">
      <p className="text-sm font-medium">Atsarginis kodas: {shown.name}</p>
      <p className="select-all font-mono text-4xl font-bold tracking-[0.25em] text-gold" aria-label="Atsarginis kodas">{shown.code}</p>
      <p className="text-xs text-muted-foreground">
        Galioja iki {new Date(shown.expiresAt).toLocaleTimeString("lt-LT", {hour:"2-digit",minute:"2-digit"})}. Galima panaudoti tik vieną kartą, ne daugiau kaip 5 bandymai.
        Kodas nebus rodomas pakartotinai.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(shown.code).then(() => toast.success("Kodas nukopijuotas")).catch(() => toast.error("Nepavyko nukopijuoti"))}>Kopijuoti kodą</Button>
        <Button variant="ghost" onClick={() => setShown(null)}>Paslėpti kodą</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Kodą perduokite tik patikrinę, kad bendraujate su pačiu raiteliu. Anksčiau el. paštu išsiųstas kodas po pakeitimo nebegalioja.
      </p>
    </div>}
  </div>;
}
