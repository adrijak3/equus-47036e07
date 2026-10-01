import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (active) setReady(!!data.session);
    };
    checkSession();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const savePassword = async () => {
    if (password.length < 8) return toast.error("Slaptažodis turi būti bent 8 simbolių");
    if (password !== password2) return toast.error("Slaptažodžiai nesutampa");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error("Ši atkūrimo nuoroda nebegalioja arba jau buvo panaudota.");
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
          <h1 className="text-3xl font-display text-gradient-gold">Nustatyti naują slaptažodį</h1>
          <p className="text-sm text-muted-foreground mt-2">Pasirinkite naują slaptažodį savo Equus paskyrai.</p>
        </div>
        {!ready ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">Atkūrimo nuoroda negalioja arba dar nebuvo patvirtinta.</p>
            <Button variant="gold" className="w-full" onClick={() => navigate("/auth", { replace: true })}>Grįžti į prisijungimą</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="reset-password">Naujas slaptažodis</Label>
              <Input id="reset-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="reset-password-2">Pakartokite slaptažodį</Label>
              <Input id="reset-password-2" type="password" autoComplete="new-password" minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </div>
            <Button variant="gold" className="w-full" onClick={savePassword} disabled={saving}>
              {saving ? "Išsaugoma…" : "Nustatyti slaptažodį"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
