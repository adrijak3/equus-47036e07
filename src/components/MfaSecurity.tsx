import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Factor = { id: string; friendly_name?: string | null };
type PendingFactor = { id: string; qr: string; secret: string };

export function MfaSettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [pending, setPending] = useState<PendingFactor | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    setLoading(false);
    if (error) { toast.error("Nepavyko patikrinti apsaugos."); return; }
    setFactors(data?.totp?.filter((factor) => factor.status === "verified") ?? []);
  }, []);
  useEffect(() => { if (user) void refresh(); }, [user?.id, refresh]);

  const enable = async () => {
    setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Equus prisijungimo apsauga",
    });
    setBusy(false);
    if (error || !data?.totp) { toast.error("Nepavyko įjungti apsaugos."); return; }
    setPending({
      id: data.id,
      qr: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.totp.qr_code)}`,
      secret: data.totp.secret,
    });
  };
  const verify = async () => {
    if (!pending || !/^\d{6}$/.test(code)) { toast.error("Įveskite 6 skaitmenų kodą."); return; }
    setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: pending.id });
    if (challengeError || !challenge) { toast.error("Kodo patvirtinimas nepavyko."); setBusy(false); return; }
    const { error } = await supabase.auth.mfa.verify({
      factorId: pending.id, challengeId: challenge.id, code,
    });
    setBusy(false);
    if (error) { toast.error("Neteisingas kodas. Bandykite dar kartą."); return; }
    setCode("");
    setPending(null);
    toast.success("Prisijungimo apsauga įjungta.");
    void refresh();
  };
  const disable = async (factorId: string) => {
    if (!window.confirm("Išjungti papildomą prisijungimo apsaugą?")) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) { toast.error("Nepavyko išjungti apsaugos. Prisijunkite su kodu ir bandykite dar kartą."); return; }
    toast.success("Papildoma apsauga išjungta.");
    void refresh();
  };

  if (!user) return <Navigate to="/auth" replace />;
  return (
    <main className="container max-w-xl py-8 sm:py-14">
      <Button variant="ghost" size="sm" className="mb-5" onClick={() => navigate(-1)}>Grįžti</Button>
      <h1 className="text-2xl font-medium text-foreground sm:text-3xl">Prisijungimo apsauga</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Neprivaloma. Apsaugokite paskyrą 6 skaitmenų kodu iš nemokamos autentifikavimo programėlės.
      </p>
      <section className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5 sm:p-7">
        {loading ? <p className="text-sm text-muted-foreground">Tikrinama…</p> : factors.length > 0 ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-foreground"><ShieldCheck className="h-5 w-5" /> Apsauga įjungta</div>
            <p className="text-sm text-muted-foreground">Prisijungiant reikės kodo iš autentifikavimo programėlės.</p>
            {factors.map((factor) =>
              <Button key={factor.id} variant="outline" disabled={busy} onClick={() => void disable(factor.id)}>
                Išjungti apsaugą
              </Button>
            )}
          </>
        ) : pending ? (
          <>
            <p className="text-sm font-medium">1. Nuskenuokite kodą autentifikavimo programėle.</p>
            <img className="mx-auto h-48 w-48 rounded-lg bg-white p-2" src={pending.qr} alt="Autentifikavimo QR kodas" />
            <details className="break-all text-xs text-muted-foreground">
              <summary className="cursor-pointer">Negalite nuskenuoti? Rodyti rankinį kodą</summary>
              <code className="mt-2 block select-all rounded-md border p-2">{pending.secret}</code>
            </details>
            <label className="block text-sm font-medium" htmlFor="mfa-enroll-code">2. Įveskite 6 skaitmenų kodą</label>
            <Input id="mfa-enroll-code" type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || code.length !== 6} onClick={() => void verify()}>Patvirtinti</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setPending(null); setCode(""); }}>Atšaukti</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-5 w-5" /> Papildoma apsauga išjungta</div>
            <p className="text-sm text-muted-foreground">Galite naudoti Google Authenticator, Microsoft Authenticator ar kitą TOTP programėlę.</p>
            <Button disabled={busy} onClick={() => void enable()}>Įjungti nemokamai</Button>
          </>
        )}
      </section>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Pametus telefoną gali reikėti administratoriaus pagalbos. Prieš įjungdami išsisaugokite autentifikavimo programėlės atkūrimo informaciją.
      </p>
    </main>
  );
}

export function MfaGate({ children }: { children: React.ReactNode }) {
  const { user, session, loading, signOut } = useAuth();
  const [checking, setChecking] = useState(true);
  const [needsCode, setNeedsCode] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    if (!user) { setChecking(false); setNeedsCode(false); setFailed(false); return; }
    setChecking(true);
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) { setChecking(false); setFailed(true); return; }
    if (data.currentLevel === "aal1" && data.nextLevel === "aal2") {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError || !factors?.totp?.length) {
        setChecking(false); setFailed(true); return;
      }
      const verified = factors.totp.find((factor) => factor.status === "verified");
      if (!verified) { setChecking(false); setFailed(true); return; }
      setFactorId(verified.id);
      setNeedsCode(true);
    } else setNeedsCode(false);
    setChecking(false);
    setFailed(false);
  }, [user?.id]);

  useEffect(() => { if (!loading) void check(); }, [loading, user?.id, session?.access_token, check]);

  const verify = async () => {
    if (!/^\d{6}$/.test(code) || !factorId) return;
    setBusy(true);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setBusy(false); toast.error("Nepavyko išsiųsti patvirtinimo užklausos."); return;
    }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    setBusy(false);
    if (error) { toast.error("Neteisingas kodas."); return; }
    setCode("");
    setNeedsCode(false);
    void check();
  };
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Tikrinama paskyra…</div>;
  if (!user) return <>{children}</>;
  if (!checking && !needsCode && !failed) return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Patvirtinkite prisijungimą</h1>
        {checking ? <p className="mt-3 text-sm text-muted-foreground">Tikrinama paskyros apsauga…</p> :
          failed ? <>
            <p className="mt-3 text-sm text-muted-foreground">Nepavyko patikrinti apsaugos. Bandykite dar kartą.</p>
            <Button className="mt-4 w-full" onClick={() => void check()}>Bandyti dar kartą</Button>
          </> : <>
            <p className="mt-2 text-sm text-muted-foreground">Įveskite kodą iš autentifikavimo programėlės.</p>
            <Input className="mt-4" inputMode="numeric" type="text" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} aria-label="6 skaitmenų kodas" />
            <Button className="mt-3 w-full" disabled={busy || code.length !== 6} onClick={() => void verify()}>Patvirtinti</Button>
          </>
        }
        <Button variant="ghost" className="mt-2 w-full" onClick={() => void signOut()}>Atsijungti</Button>
      </section>
    </main>
  );
}
