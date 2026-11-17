import { useState } from "react";
import { useLocation, useNavigate, useSearchParams, Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound, Chrome } from "lucide-react";
import { TurnstileCaptcha, TURNSTILE_SITE_KEY } from "@/components/TurnstileCaptcha";

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Vardas per trumpas").max(80),
  phone: z.string().trim().min(6, "Neteisingas telefono numeris").max(20),
  email: z.string().trim().email("Neteisingas el. paštas").max(255),
  password: z.string().min(8, "Slaptažodis turi būti bent 8 simbolių").max(128),
  experience_text: z
    .string()
    .trim()
    .min(30, "Aprašykite patirtį bent 30 simbolių")
    .max(500, "Aprašymas gali būti iki 500 simbolių"),
});

const EXPERIENCE_PLACEHOLDER =
  "Pvz.: jodinėju 2 metus, jaučiuosi užtikrintai žingsniu ir risčia, šuoliuoju prižiūrima trenerio, pati pasibalnoju ir pasivaldau žirgą. Varžybose nedalyvavau.";

const signInSchema = z.object({
  identifier: z.string().trim().min(3, "Įveskite el. paštą arba telefoną"),
  password: z.string().min(1, "Įveskite slaptažodį"),
});

const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s);

type AuthMessage = { heading: string; detail: string; code: string };

function explainAuthError(
  error: { code?: string; status?: number; message?: string },
  context: "signin" | "signup",
): AuthMessage {
  const code = error.code || (error.status === 429 ? "rate_limit" : "unknown_error");
  const message = (error.message || "").toLowerCase();
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return {
      heading: "El. paštas dar nepatvirtintas",
      detail: "Patikrinkite savo el. pašto dėžutę (taip pat „Šlamštas“) ir paspauskite patvirtinimo nuorodą. Jei laiško nėra, susisiekite su Equus administracija.",
      code: "email_not_confirmed",
    };
  }
  if (code === "invalid_credentials") {
    return {
      heading: "Nepavyko prisijungti",
      detail: "Patikrinkite el. paštą arba telefono numerį ir slaptažodį. Jei jo nepamenate, pasirinkite „Pamiršote slaptažodį?“.",
      code,
    };
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || code === "rate_limit" || error.status === 429) {
    return {
      heading: "Per daug bandymų",
      detail: "Pasiektas laikinas prisijungimo arba laiškų siuntimo limitas. Palaukite keletą minučių ir bandykite dar kartą. Nekurkite naujos paskyros.",
      code,
    };
  }
  if (code === "captcha_failed" || code === "captcha_disabled" || code === "captcha_timeout" || /captcha|turnstile/i.test(message)) {
    return {
      heading: "Nepavyko patvirtinti saugumo patikros",
      detail: "Atlikite „Nesu robotas“ patikrą iš naujo ir bandykite dar kartą.",
      code: code === "unknown_error" ? "captcha_failed" : code,
    };
  }
  if (code === "email_exists" || code === "user_already_exists") {
    return {
      heading: "Paskyra jau egzistuoja",
      detail: "Bandykite prisijungti arba atkurti slaptažodį, užuot kūrę naują paskyrą.",
      code,
    };
  }
  if (code === "weak_password") {
    return {
      heading: "Slaptažodis per silpnas",
      detail: "Pasirinkite ilgesnį ir saugesnį slaptažodį.",
      code,
    };
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return { heading: "Patikrinkite įvestus duomenis", detail: "Pataisykite el. pašto adresą arba kitus laukus ir bandykite iš naujo.", code };
  }
  if (code === "email_address_not_authorized") {
    return {
      heading: "Nepavyksta išsiųsti el. laiško",
      detail: "Laiškų siuntimas šiam adresui neleidžiamas. Susisiekite su Equus administracija.",
      code,
    };
  }
  if (code === "user_banned") {
    return { heading: "Paskyros prieiga apribota", detail: "Susisiekite su Equus administracija.", code };
  }
  return {
    heading: context === "signin" ? "Prisijungti nepavyko" : "Paskyros sukurti nepavyko",
    detail: "Bandykite dar kartą. Jei problema kartojasi, praneškite Equus administracijai žemiau nurodytą klaidos kodą.",
    // Avoid exposing raw server messages, tokens or other private data in the UI.
    code: /^[a-z0-9_]{1,60}$/i.test(code) ? code : "unknown_error",
  };
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: unknown } | null)?.from;
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "signup" ? "signup" : "signin");
  const [loading, setLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<AuthMessage | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const renewCaptcha = () => { setCaptchaToken(""); setCaptchaNonce((n) => n + 1); };
  const [emailConfirmationSent, setEmailConfirmationSent] = useState(false);
  const confirmed = params.get("confirmed") === "1";

  // Forgot-password dialog state — email only; phone/password fields are intentionally removed.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpBusy, setFpBusy] = useState(false);

  // Sign-up extras
  const [parentPhone, setParentPhone] = useState(false);
  const [phone, setPhone] = useState("+370");
  const [experience, setExperience] = useState("");

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthMessage(null);
    const fd = new FormData(e.currentTarget);
    const parsed = signUpSchema.safeParse({
      full_name: fd.get("full_name"),
      phone: phone.trim(),
      email: fd.get("email"),
      password: fd.get("password"),
      experience_text: fd.get("experience_text"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Patvirtinkite, kad nesate robotas.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        captchaToken: captchaToken || undefined,
        emailRedirectTo: `${window.location.origin}/auth?confirmed=1`,
        data: {
          full_name: parsed.data.full_name,
          phone: parsed.data.phone,
          experience_text: parsed.data.experience_text,
          phone_is_parent: parentPhone,
        },
      },
    });
    setLoading(false);
    renewCaptcha();
    if (error) {
      const details = explainAuthError(error, "signup");
      setAuthMessage(details);
      toast.error(details.heading);
      return;
    }
    if (data.session) {
      toast.success("Sveiki atvykę į Equus!");
      navigate("/");
    } else {
      setEmailConfirmationSent(true);
      toast.success("Patikrinkite savo el. paštą ir patvirtinkite paskyrą.");
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // The callback route completes the PKCE exchange before navigating home.
      // Add this exact app URL to Supabase Auth > URL Configuration > Redirect URLs.
      // In Google Cloud, the authorized redirect URI is the Supabase project's
      // /auth/v1/callback URL (not this app callback URL).
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setLoading(false); toast.error(error.message); }
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({ identifier: fd.get("identifier"), password: fd.get("password") });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Patvirtinkite, kad nesate robotas.");
      return;
    }
    setLoading(true);
    let email = parsed.data.identifier;
    if (!isEmail(email)) {
      // Treat as phone — look up email
      const { data, error: lookupErr } = await supabase.functions.invoke("lookup-email-by-phone", {
        body: { phone: email },
      });
      if (lookupErr || (data as any)?.error || !(data as any)?.email) {
        setLoading(false);
        setAuthMessage({ heading: "Nepavyko prisijungti", detail: "Patikrinkite telefono numerį ir slaptažodį arba bandykite jungtis el. paštu.", code: "phone_lookup_failed" });
        toast.error("Nepavyko prisijungti");
        return;
      }
      email = (data as any).email;
    }
    // Explicitly mark this sign-in, so already signed-in users are never
    // suddenly asked for a new-device email code on page load.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
      options: { captchaToken: captchaToken || undefined },
    });
    setLoading(false);
    renewCaptcha();
    if (error) {
      const details = explainAuthError(error, "signin");
      setAuthMessage(details);
      toast.error(details.heading);
      return;
    }
    toast.success("Sveiki sugrįžę!");
    navigate(
      typeof redirectTo === "string" && redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/",
      { replace: true },
    );
  };

  const submitForgot = async () => {
    const email = fpEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Įveskite el. paštą");
      return;
    }

    setFpBusy(true);
    const { error } = await supabase.functions.invoke("request-password-reset-email", {
      body: { email },
    });
    setFpBusy(false);

    if (error) {
      toast.error("Nepavyko išsiųsti laiško. Bandykite dar kartą.");
      return;
    }

    toast.success("Jei paskyra su šiuo el. paštu egzistuoja, netrukus gausite atkūrimo kodą.");
    setForgotOpen(false);
    setFpEmail("");
    navigate(`/reset-password?email=${encodeURIComponent(email)}`);
  };

  return (
    <div className="container max-w-md py-12 sm:py-20">
      <div className="text-center mb-10 animate-fade-up">
        <Link to="/" className="inline-block">
          <h1 className="text-5xl font-display text-gradient-gold mb-2">Equus</h1>
        </Link>
        <p className="text-sm tracking-[0.2em] uppercase text-muted-foreground">jojimo mokykla</p>
        <div className="gold-divider mt-6 max-w-[120px] mx-auto" />
      </div>

      <div className="bg-gradient-card border border-gold/15 rounded-lg p-6 sm:p-8 shadow-elegant animate-fade-up">
        <Tabs value={tab} onValueChange={(value) => { setTab(value); setAuthMessage(null); renewCaptcha(); }}>
          <TabsList className="grid grid-cols-2 w-full bg-background/50 mb-6">
            <TabsTrigger value="signin">Prisijungti</TabsTrigger>
            <TabsTrigger value="signup">Registruotis</TabsTrigger>
          </TabsList>

          {authMessage && (
            <div role="alert" aria-live="assertive" className="mb-5 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm">
              <p className="font-semibold text-foreground">{authMessage.heading}</p>
              <p className="mt-1 leading-6 text-foreground">{authMessage.detail}</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">Klaidos kodas: {authMessage.code}</p>
            </div>
          )}

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <Label htmlFor="si-id">El. paštas arba telefonas</Label>
                <Input id="si-id" name="identifier" type="text" required autoComplete="username" placeholder="vardas@email.lt arba +370…" />
              </div>
              <div>
                <Label htmlFor="si-pw">Slaptažodis</Label>
                <Input id="si-pw" name="password" type="password" required autoComplete="current-password" />
              </div>
              <TurnstileCaptcha key={`signin-${captchaNonce}`} onToken={setCaptchaToken} />
              <Button variant="gold" type="submit" className="w-full mt-6" disabled={loading}>
                {loading ? "Jungiamasi…" : "Prisijungti"}
              </Button>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gold/10" /></div>
                <div className="relative flex justify-center"><span className="bg-gradient-card px-3 text-xs text-muted-foreground">arba</span></div>
              </div>
              <Button type="button" variant="outlineGold" className="w-full" onClick={handleGoogle} disabled={loading}>
                <Chrome className="h-4 w-4" /> Tęsti su Google
              </Button>
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="w-full text-xs text-gold/80 hover:text-gold underline-offset-4 hover:underline pt-2 transition-colors"
              >
                Pamiršote slaptažodį?
              </button>
            </form>
          </TabsContent>

          {(emailConfirmationSent || confirmed) && (
            <div className="mb-6 rounded-lg border border-gold/20 bg-background/40 p-4 text-sm">
              <p className="font-medium text-gold">Patvirtinkite savo el. paštą</p>
              <p className="mt-1 text-muted-foreground">
                {confirmed
                  ? "El. paštas patvirtintas. Dabar galite prisijungti prie Equus."
                  : "Į jūsų el. paštą išsiuntėme patvirtinimo nuorodą. Atidarykite ją ir tada prisijunkite."}
              </p>
              {emailConfirmationSent && !confirmed && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Negavote laiško? Patikrinkite šlamštą.
                </p>
              )}
            </div>
          )}

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <Label htmlFor="su-name">Vardas ir pavardė</Label>
                <Input id="su-name" name="full_name" required maxLength={80} placeholder="Vardenis Pavardenis" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Įrašykite raitelio vardą ir pavardę, ne tėvų.
                </p>
              </div>
              <div>
                <Label htmlFor="su-phone">Telefono numeris</Label>
                <Input
                  id="su-phone"
                  name="phone"
                  type="tel"
                  required
                  maxLength={20}
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setPhone(digits.startsWith("370") ? "+" + digits : digits.startsWith("8") ? "+370" + digits.slice(1) : "+370" + digits);
                  }}
                  placeholder="+370 6…"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Kad galėtume susisiekti dėl treniruočių.
                </p>
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={parentPhone}
                    onChange={(e) => setParentPhone(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[hsl(var(--gold))]"
                  />
                  <span>Tai tėvų / globėjo numeris (raitelis – vaikas)</span>
                </label>
              </div>
              <div>
                <Label htmlFor="su-exp">Jojimo patirtis</Label>
                <Textarea
                  id="su-exp"
                  name="experience_text"
                  required
                  minLength={30}
                  maxLength={500}
                  rows={4}
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder={EXPERIENCE_PLACEHOLDER}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Bent 30 simbolių ({experience.trim().length}/500).
                </p>
              </div>
              <div>
                <Label htmlFor="su-email">El. paštas</Label>
                <Input id="su-email" name="email" type="email" required autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="su-pw">Slaptažodis</Label>
                <Input id="su-pw" name="password" type="password" required minLength={8} autoComplete="new-password" />
              </div>
              <p className="text-xs text-muted-foreground">
                Sukurdami paskyrą sutinkate su{" "}
                <a href="/privatumo-politika" target="_blank" rel="noopener noreferrer" className="text-gold underline underline-offset-4">
                  Privatumo politika
                </a>{" "}
                ir{" "}
                <a href="/taisykles-ir-salygos" target="_blank" rel="noopener noreferrer" className="text-gold underline underline-offset-4">
                  Taisyklėmis ir sąlygomis
                </a>.
              </p>
              <TurnstileCaptcha key={`signup-${captchaNonce}`} onToken={setCaptchaToken} />
              <Button variant="gold" type="submit" className="w-full mt-6" disabled={loading}>
                {loading ? "Kuriama…" : "Sukurti paskyrą"}
              </Button>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gold/10" /></div>
                <div className="relative flex justify-center"><span className="bg-gradient-card px-3 text-xs text-muted-foreground">arba</span></div>
              </div>
              <Button type="button" variant="outlineGold" className="w-full" onClick={handleGoogle} disabled={loading}>
                <Chrome className="h-4 w-4" /> Registruotis su Google
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        <details className="mt-5 border-t border-border/70 pt-4 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">Dažniausi klausimai</summary>
          <div className="mt-3 space-y-3 text-muted-foreground">
            <p><strong className="text-foreground">Negavote patvirtinimo laiško?</strong> Patikrinkite šlamšto aplanką.</p>
            <p><strong className="text-foreground">Pamiršote slaptažodį?</strong> Pasirinkite „Pamiršote slaptažodį?“.</p>
            <p><strong className="text-foreground">Nebeturite prieigos prie el. pašto?</strong> Susisiekite su Equus administracija dėl paskyros atkūrimo.</p>
          </div>
        </details>
      </div>

      {/* Forgot password dialog */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-gold" /> Pamiršote slaptažodį?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Įveskite paskyros el. paštą. Į jį gausite saugią vienkartinę nuorodą,
              kuri leis nustatyti naują slaptažodį.
            </p>
            <div>
              <Label htmlFor="fp-email">El. paštas</Label>
              <Input id="fp-email" type="email" value={fpEmail}
                onChange={(e) => setFpEmail(e.target.value)}
                autoComplete="email" placeholder="vardas@email.lt" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForgotOpen(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={submitForgot} disabled={fpBusy}>
              {fpBusy ? "Siunčiama…" : "Siųsti atkūrimo nuorodą"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
