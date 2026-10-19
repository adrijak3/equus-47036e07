import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

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
    <div className="container max-w-md py-12 sm:py-20">
      <div className="bg-gradient-card border border-gold/15 rounded-lg p-6 sm:p-8 shadow-elegant">
        <div className="text-center mb-7">
          <KeyRound className="h-8 w-8 text-gold mx-auto mb-3" />
          <h1 className="text-3xl font-display text-gradient-gold">Atkurti slaptažodį</h1>
          <p className="text-sm text-muted-foreground mt-2">Įveskite el. paštu gautą vienkartinį kodą ir pasirinkite naują slaptažodį.</p>
        </div>
        <div className="space-y-4">
          <div>
            <Label htmlFor="reset-email">El. paštas</Label>
            <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="reset-code">Vienkartinis kodas iš el. pašto</Label>
            <Input id="reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="reset-password">Naujas slaptažodis</Label>
            <Input id="reset-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="reset-password-2">Pakartokite slaptažodį</Label>
            <Input id="reset-password-2" type="password" autoComplete="new-password" minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} required />
          </div>
          <Button variant="gold" className="w-full" onClick={savePassword} disabled={saving}>
            {saving ? "Tikrinama…" : "Patvirtinti kodą ir pakeisti slaptažodį"}
          </Button>
          <Button variant="outlineGold" className="w-full" onClick={() => navigate("/auth", { replace: true })} disabled={saving}>
            Grįžti į prisijungimą
          </Button>
        </div>
      </div>
    </div>
  );
}
