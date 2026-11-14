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
  if (state === "ready") return <>{children}</>;
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
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const refreshFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { toast.error(error.message); return; }
    setFactor(data?.totp?.find((f) => f.status === "verified") ?? null);
  };
  const refreshSessions = async () => {
    const [{ data, error }, { data: authData }] = await Promise.all([
      supabase.rpc("list_my_auth_sessions" as never),
      supabase.auth.getSession(),
    ]);
    const jwt = authData.session?.access_token || "";
    try {
      const raw = jwt.split(".")[1] || "";
      const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
      const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
      setCurrentSessionId(typeof claims.session_id === "string" ? claims.session_id : null);
    } catch {
      setCurrentSessionId(null);
    }
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

  const signOut = async (scope: "local" | "global") => {
    const question = scope === "global"
      ? "Atsijungti visuose įrenginiuose, įskaitant šį?"
      : "Atsijungti tik šiame įrenginyje?";
    if (!window.confirm(question)) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope });
    if (error) {
      toast.error("Nepavyko atsijungti. " + error.message);
      setSigningOut(false);
      return;
    }
    window.location.assign("/auth?tab=signin");
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

    <section className="space-y-4 border-t border-border/60 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl">Kur esate prisijungę</h2>
        <Button variant="outline" size="sm" onClick={() => void refreshSessions()}>Atnaujinti</Button>
      </div>
      {sessionsError ? <p className="text-sm text-destructive">Nepavyko įkelti prisijungimų.</p>
        : sessions.length === 0 ? <p className="text-sm text-muted-foreground">Prisijungimų nerasta.</p>
        : <ul className="divide-y divide-border/60 border-y border-border/60">
          {sessions.map((session) => {
            const current = currentSessionId === session.session_id;
            return <li key={session.session_id} className="space-y-1 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{labelDevice(session.user_agent)}</span>
                {current && <span className="text-xs font-medium text-gold">Šis įrenginys</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Paskutinis aktyvumas: {new Date(session.last_active_at).toLocaleString("lt-LT")}
              </p>
              <p className="text-xs text-muted-foreground">
                IP: {session.ip_address || "Nežinomas"}
              </p>
            </li>;
          })}
        </ul>}
      <div className="flex flex-wrap gap-3 pt-2">
        <Button variant="outline" disabled={signingOut} onClick={() => void signOut("local")}>
          Atsijungti čia
        </Button>
        <Button variant="destructive" disabled={signingOut} onClick={() => void signOut("global")}>
          Atsijungti visur
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Atsijungus visur, kiti įrenginiai turės prisijungti iš naujo.
        Jų dabartiniai prieigos raktai gali galioti iki galiojimo pabaigos.
      </p>
    </section>
    <Link className="text-sm text-gold underline" to="/paskyra">Grįžti į paskyrą</Link>
  </main>;
}
