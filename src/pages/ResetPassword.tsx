import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Clock3, KeyRound } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") || "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [saving, setSaving] = useState(false);

  const savePassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const recoveryCode = code.trim();
    if (!/\S+@\S+\.\S+/.test(normalizedEmail)) {
      toast.error("Įveskite teisingą el. pašto adresą");
      return;
    }
    if (!recoveryCode) {
      toast.error("Įveskite el. paštu gautą kodą");
      return;
    }
    if (password.length < 8) {
      toast.error("Slaptažodis turi būti bent 8 simbolių");
      return;
    }
    if (password !== password2) {
      toast.error("Slaptažodžiai nesutampa");
      return;
    }

    setSaving(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: recoveryCode,
      type: "recovery",
    });
    if (verifyError) {
      setSaving(false);
      toast.error("Kodas neteisingas arba nebegalioja. Paprašykite naujo kodo.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      toast.error("Nepavyko pakeisti slaptažodžio. Pabandykite dar kartą.");
      return;
    }

    await supabase.auth.signOut();
    toast.success("Slaptažodis pakeistas. Galite prisijungti.");
    navigate("/auth", { replace: true });
  };

  return (
    <main className="container mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="w-full max-w-xl">
        <header className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center justify-center">
            <span className="font-display text-4xl sm:text-5xl text-gradient-gold">Equus</span>
          </Link>
          <div className="mx-auto my-4 h-px w-14 bg-border" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Paskyros saugumas
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">
            Susikurkite naują slaptažodį
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            Įveskite el. paštu gautą vienkartinį kodą ir pasirinkite slaptažodį, kurį naudosite prisijungdami prie Equus.
          </p>
        </header>

        <section className="rounded-2xl border border-border bg-card/95 p-5 shadow-soft sm:p-8">
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-secondary/60 px-4 py-3">
            <KeyRound className="h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm leading-5 text-muted-foreground">
              Naudokite kodą iš laiško. Jūsų dabartinis slaptažodis nepasikeis, kol nepatvirtinsite pakeitimo.
            </p>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="reset-email">El. paštas</Label>
              <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-code">Vienkartinis kodas</Label>
              <Input id="reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Įveskite kodą iš laiško" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password">Naujas slaptažodis</Label>
              <Input id="reset-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Bent 8 simboliai" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-password-2">Pakartokite naują slaptažodį</Label>
              <Input id="reset-password-2" type="password" autoComplete="new-password" minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} placeholder="Įveskite slaptažodį dar kartą" required />
            </div>

            <Button variant="gold" className="w-full" onClick={savePassword} disabled={saving}>
              {saving ? "Tikrinama…" : "Pakeisti slaptažodį"}
            </Button>
            <Button variant="outlineGold" className="w-full" onClick={() => navigate("/auth", { replace: true })} disabled={saving}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Grįžti į prisijungimą
            </Button>
          </div>

          <div className="mt-6 flex items-start gap-3 border-t border-border pt-5">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">
              Jei laiškas dar neatėjo, palaukite kelias minutes ir patikrinkite šlamšto aplanką.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
