import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Factor = { id: string; status: string };
type LoginSession = { session_id: string; created_at: string; last_active_at: string; user_agent: string | null; ip_address: string | null };
const labelDevice = (ua: string | null) => {
  if (!ua) return "Nežinomas įrenginys";
  const os = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS/i.test(ua) ? "Mac" : "Įrenginys";
  const browser = /OPR\//i.test(ua) ? "Opera" : /Edg\//i.test(ua) ? "Edge" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "Naršyklė";
  return os + " · " + browser;
};


// Only freshly initiated logins request new-device verification.
// Existing sessions, including ones restored on page refresh, are not enrolled retroactively.
export const NEW_LOGIN_DEVICE_CHECK_KEY = "equus_pending_new_login_device_check_v2";
const DEVICE_STORAGE_KEY = "equus_trusted_device_token_v1";
function deviceToken() {
  let saved = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (saved && /^[0-9a-f]{64}$/.test(saved)) return saved;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  saved = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(DEVICE_STORAGE_KEY, saved);
  return saved;
}

export function NewDeviceGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [step, setStep] = useState<"checking" | "ready" | "code" | "error">("checking");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const invoke = async (action: "status" | "send" | "verify", entered?: string) => {
    const { data, error } = await supabase.functions.invoke("new-device-verification", {
      body: { action, deviceToken: deviceToken(), ...(entered ? {code: entered} : {}) },
    });
    if (error || (data as {error?:string}|null)?.error) throw new Error((data as {error?:string}|null)?.error ?? error?.message ?? "Nepavyko patikrinti");
    return data as {trusted?:boolean;ok?:boolean;queued?:boolean};
  };

  useEffect(() => {
    let active = true;
    if (loading) return;
    setStep("checking");
    setCheckedUserId(null);
    if (!user) {
      setStep("ready");
      return;
    }
    // Never retroactively challenge people who are already logged in.
    // A check is only requested when a new sign-in has explicitly started.
    if (sessionStorage.getItem(NEW_LOGIN_DEVICE_CHECK_KEY) !== "1") {
      setCheckedUserId(user.id);
      setStep("ready");
      return;
    }
    (async () => {
      try {
        const status = await invoke("status");
        if (!active) return;
        setCheckedUserId(user.id);
        if (status.trusted) {
          sessionStorage.removeItem(NEW_LOGIN_DEVICE_CHECK_KEY);
          setStep("ready");
        } else {
          setStep("code");
          try {
            await invoke("send");
            if (active) setMessage("Patikrinkite el. paštą. Laiškas gali vėluoti.");
          } catch {
            if (active) setMessage("Kodo išsiųsti nepavyko. Spauskite „Siųsti kodą“.");
          }
        }
      } catch {
        if (active) { setCheckedUserId(user.id); setStep("error"); }
      }
    })();
    return () => { active = false; };
  }, [user?.id, loading]);

  const resend = async () => {
    setBusy(true);
    try {
      await invoke("send");
      setMessage("Kodas išsiųstas. Patikrinkite ir šlamšto aplanką.");
    } catch {
      setMessage("Kodas nesiunčiamas. Bandykite po 90 sek.");
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    try {
      const response = await invoke("verify", code);
      if (!response.trusted) throw new Error("Verification did not succeed");
      setCode("");
      sessionStorage.removeItem(NEW_LOGIN_DEVICE_CHECK_KEY);
      setStep("ready");
    } catch {
      setMessage("Kodas neteisingas arba nebegalioja.");
    } finally { setBusy(false); }
  };

  if (loading || step==="checking" || (user && checkedUserId!==user.id)) {
    return <div className="container py-16 text-center">Tikrinamas įrenginys…</div>;
  }
  if (step==="ready") return <>{children}</>;
  return <main className="container max-w-md space-y-5 py-16">
    <h1 className="font-display text-3xl">Patvirtinkite įrenginį</h1>
    <p className="text-sm text-muted-foreground">
      Įveskite el. paštu gautą 6 skaitmenų kodą.
    </p>
    {step==="error" ?
      <p className="text-sm text-destructive">Saugumo patikros įkelti nepavyko. Bandykite atsijungti ir prisijungti iš naujo.</p> :
      <>
        <Input aria-label="El. paštu gautas kodas" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
        <Button variant="gold" className="w-full" disabled={busy || code.length!==6} onClick={confirm}>{busy?"Tikrinama…":"Patvirtinti įrenginį"}</Button>
        <Button variant="outline" className="w-full" disabled={busy} onClick={resend}>Siųsti kodą dar kartą</Button>
      </>}
    {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
    <Button variant="ghost" className="w-full" onClick={() => void supabase.auth.signOut({scope:"local"})}>Atsijungti</Button>
  </main>;
}

export function MfaGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [state, setState] = useState<"checking" | "ready" | "challenge" | "error">("checking");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState("checking");
    setCheckedUserId(null);
    const check = async () => {
      if (!user) { if (active) { setCheckedUserId(null); setState("ready"); } return; }
      const { data: levels, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!active) return;
      if (error || !levels) { setCheckedUserId(user.id); setState("error"); return; }
      if (levels.currentLevel === "aal1" && levels.nextLevel === "aal2") {
        const { data, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (!active) return;
        const verified = data?.totp?.find((f) => f.status === "verified");
        if (factorsError || !verified) { setCheckedUserId(user.id); setState("error"); return; }
        setFactorId(verified.id);
        setCheckedUserId(user.id);
        setState("challenge");
      } else { setCheckedUserId(user.id); setState("ready"); }
    };
    if (!loading) void check();
    return () => { active = false; };
  }, [user?.id, loading]);

  const confirm = async () => {
    if (!/^\d{6}$/.test(code) || !factorId) return;
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error || !data) { setBusy(false); toast.error("Nepavyko pradėti patikros."); return; }
    const verified = await supabase.auth.mfa.verify({ factorId, challengeId: data.id, code });
    setBusy(false);
    if (verified.error) { toast.error("Neteisingas arba nebegaliojantis kodas."); return; }
    setCode("");
    setState("ready");
  };

  if (loading || state === "checking" || (user && checkedUserId !== user.id)) return <div className="container py-20 text-center">Tikrinamas prisijungimas…</div>;
  if (state === "ready") return <NewDeviceGate>{children}</NewDeviceGate>;
  return <main className="container max-w-md space-y-5 py-16">
    <h1 className="font-display text-3xl">Prisijungimo patvirtinimas</h1>
    {state === "error" ? <p className="text-sm text-destructive">Nepavyko patikrinti saugumo nustatymų. Bandykite prisijungti iš naujo.</p> :
      <>
        <p className="text-sm text-muted-foreground">Įveskite 6 skaitmenų kodą iš autentifikatoriaus programėlės.</p>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
        <Button variant="gold" className="w-full" disabled={busy || code.length !== 6} onClick={confirm}>Patvirtinti</Button>
      </>}
    <Button variant="outline" className="w-full" onClick={() => void supabase.auth.signOut({ scope: "local" })}>Atsijungti</Button>
  </main>;
}

export default function Security() {
  const { user } = useAuth();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [pending, setPending] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [sessionsError, setSessionsError] = useState(false);
  const refreshFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { toast.error(error.message); return; }
    setFactor(data?.totp?.find((f) => f.status === "verified") ?? null);
  };
  const refreshSessions = async () => {
    const { data, error } = await supabase.rpc("list_my_auth_sessions" as never);
    setSessionsError(!!error);
    if (!error) setSessions((data ?? []) as LoginSession[]);
  };
  useEffect(() => { if (user) { void refreshFactors(); void refreshSessions(); } }, [user?.id]);

  const start = async () => {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Equus" });
    setBusy(false);
    if (error || !data?.totp) { toast.error(error?.message ?? "Nepavyko įjungti 2FA"); return; }
    setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const verify = async () => {
    if (!pending || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.challenge({ factorId: pending.id });
    if (error || !data) { setBusy(false); toast.error(error?.message ?? "Klaida"); return; }
    const result = await supabase.auth.mfa.verify({ factorId: pending.id, challengeId: data.id, code });
    setBusy(false);
    if (result.error) { toast.error("Kodas neteisingas"); return; }
    setPending(null); setCode(""); await refreshFactors();
    toast.success("Autentifikatoriaus kodai įjungti");
  };
  const disable = async () => {
    if (!factor || !confirm("Išjungti autentifikatoriaus patvirtinimą?")) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setFactor(null); toast.success("Autentifikatorius išjungtas");
  };

  const signOutOthers = async () => {
    if (!confirm("Atsijungti visuose kituose įrenginiuose?")) return;
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) toast.error(error.message);
    else { toast.success("Kitos sesijos atšauktos"); void refreshSessions(); }
  };
  return <main className="container max-w-2xl space-y-6 py-10">
    <header><p className="text-xs uppercase tracking-widest text-muted-foreground">Mano paskyra</p><h1 className="font-display text-4xl">Saugumas</h1></header>
    <section className="space-y-3 border-t border-border/60 pt-5">
      <h2 className="font-display text-xl">Autentifikatorius (2FA)</h2>
      <p className="text-sm text-muted-foreground">Papildoma apsauga per autentifikatoriaus programėlę. Neprivaloma.</p>
      {factor ? <><p className="text-sm text-gold">Įjungta ✓</p><Button variant="outline" disabled={busy} onClick={disable}>Išjungti 2FA</Button></> :
        pending ? <div className="space-y-3">
          <p className="text-sm">Nuskaitykite QR kodą su autentifikatoriaus programėle. Raktą laikykite paslaptyje.</p>
          <img src={pending.qr} alt="Autentifikatoriaus QR kodas" className="max-w-[220px] rounded bg-white p-2" />
          <details className="text-xs"><summary>Rodyti įvedimo raktą</summary><code className="break-all">{pending.secret}</code></details>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
          <div className="flex flex-wrap gap-2"><Button variant="gold" disabled={busy || code.length !== 6} onClick={verify}>Patvirtinti ir įjungti</Button><Button variant="outline" onClick={async () => { await supabase.auth.mfa.unenroll({ factorId: pending.id }); setPending(null); }}>Atšaukti</Button></div>
        </div> : <Button variant="gold" disabled={busy} onClick={start}>Įjungti autentifikatorių</Button>}
    </section>

    <section className="space-y-4 rounded-xl border border-border/70 bg-background/70 p-5">
      <h2 className="font-display text-xl">Prisijungę įrenginiai</h2>
      <p className="text-sm text-muted-foreground">Jūsų aktyvūs prisijungimai.</p>
      {sessionsError ? <p className="text-sm text-destructive">Nepavyko įkelti sesijų sąrašo.</p> : <ul className="divide-y divide-border/60">{sessions.map((session) => <li key={session.session_id} className="space-y-1 py-3">
        <div className="font-medium">{labelDevice(session.user_agent)}</div>
        <p className="text-xs text-muted-foreground">Aktyvumas: {new Date(session.last_active_at).toLocaleString("lt-LT")}</p>
        <p className="text-xs text-muted-foreground">IP: {session.ip_address || "Nėra"} · Prisijungta: {new Date(session.created_at).toLocaleString("lt-LT")}</p>
      </li>)}</ul>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void refreshSessions()}>Atnaujinti</Button><Button variant="outline" onClick={signOutOthers}>Atsijungti kituose įrenginiuose</Button></div>
    </section>
    <Link className="text-sm text-gold underline" to="/paskyra">Grįžti į paskyrą</Link>
  </main>;
}
