import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Vardas per trumpas").max(80),
  phone: z.string().trim().min(6, "Neteisingas telefono numeris").max(20),
  email: z.string().trim().email("Neteisingas el. paštas").max(255),
  password: z.string().min(8, "Slaptažodis turi būti bent 8 simbolių").max(128),
});

const signInSchema = z.object({
  identifier: z.string().trim().min(3, "Įveskite el. paštą arba telefoną"),
  password: z.string().min(1, "Įveskite slaptažodį"),
});

const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s);

export default function Auth() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "signup" ? "signup" : "signin");
  const [loading, setLoading] = useState(false);

  // Forgot-password dialog state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpPhone, setFpPhone] = useState("");
  const [fpPw, setFpPw] = useState("");
  const [fpPw2, setFpPw2] = useState("");
  const [fpBusy, setFpBusy] = useState(false);

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = signUpSchema.safeParse({
      full_name: fd.get("full_name"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      password: fd.get("password"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: parsed.data.full_name, phone: parsed.data.phone },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message.includes("already") ? "Toks vartotojas jau egzistuoja" : error.message);
      return;
    }
    toast.success("Sveiki atvykę į Equus!");
    navigate("/");
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({ identifier: fd.get("identifier"), password: fd.get("password") });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
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
        toast.error("Neteisingas telefonas arba slaptažodis");
        return;
      }
      email = (data as any).email;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });
    setLoading(false);
    if (error) {
      toast.error("Neteisingas el. paštas arba slaptažodis");
      return;
    }
    toast.success("Sveiki sugrįžę!");
    navigate("/");
  };

  const submitForgot = async () => {
    if (!fpEmail.trim()) { toast.error("Įveskite el. paštą"); return; }
    if (!fpPhone.trim()) { toast.error("Įveskite telefono numerį"); return; }
    if (fpPw.length < 8) { toast.error("Slaptažodis turi būti bent 8 simbolių"); return; }
    if (fpPw !== fpPw2) { toast.error("Slaptažodžiai nesutampa"); return; }
    setFpBusy(true);
    const { data, error } = await supabase.functions.invoke("reset-password-by-phone", {
      body: { email: fpEmail.trim(), phone: fpPhone.trim(), new_password: fpPw },
    });
    setFpBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success("Slaptažodis pakeistas. Galite prisijungti.");
    setForgotOpen(false);
    setFpEmail(""); setFpPhone(""); setFpPw(""); setFpPw2("");
  };

  return (
    <div className="container max-w-md py-12 sm:py-20">
      <div className="text-center mb-10 animate-fade-up">
        <Link to="/" className="inline-block">
          <h1 className="text-5xl font-display text-gradient-gold mb-2">Equus</h1>
        </Link>
        <p className="text-sm tracking-[0.2em] uppercase text-muted-foreground">jojimo klubas</p>
        <div className="gold-divider mt-6 max-w-[120px] mx-auto" />
      </div>

      <div className="bg-gradient-card border border-gold/15 rounded-lg p-6 sm:p-8 shadow-elegant animate-fade-up">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 w-full bg-background/50 mb-6">
            <TabsTrigger value="signin">Prisijungti</TabsTrigger>
            <TabsTrigger value="signup">Registruotis</TabsTrigger>
          </TabsList>

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
              <Button variant="gold" type="submit" className="w-full mt-6" disabled={loading}>
                {loading ? "Jungiamasi…" : "Prisijungti"}
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

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <Label htmlFor="su-name">Vardas ir pavardė</Label>
                <Input id="su-name" name="full_name" required maxLength={80} placeholder="Vardenis Pavardenis" />
              </div>
              <div>
                <Label htmlFor="su-phone">Telefono numeris</Label>
                <Input id="su-phone" name="phone" type="tel" required maxLength={20} placeholder="+370" />
              </div>
              <div>
                <Label htmlFor="su-email">El. paštas</Label>
                <Input id="su-email" name="email" type="email" required autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="su-pw">Slaptažodis</Label>
                <Input id="su-pw" name="password" type="password" required minLength={8} autoComplete="new-password" />
              </div>
              <Button variant="gold" type="submit" className="w-full mt-6" disabled={loading}>
                {loading ? "Kuriama…" : "Sukurti paskyrą"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
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
              Įveskite paskyros el. paštą ir telefono numerį. Jei jie sutaps su paskyra –
              galėsite iškart nustatyti naują slaptažodį.
            </p>
            <div>
              <Label htmlFor="fp-email">El. paštas</Label>
              <Input id="fp-email" type="email" value={fpEmail} onChange={(e) => setFpEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fp-phone">Telefono numeris</Label>
              <Input id="fp-phone" type="tel" value={fpPhone} onChange={(e) => setFpPhone(e.target.value)} placeholder="+370" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="fp-pw">Naujas slaptažodis</Label>
                <Input id="fp-pw" type="password" value={fpPw} onChange={(e) => setFpPw(e.target.value)} minLength={8} />
              </div>
              <div>
                <Label htmlFor="fp-pw2">Pakartokite</Label>
                <Input id="fp-pw2" type="password" value={fpPw2} onChange={(e) => setFpPw2(e.target.value)} minLength={8} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForgotOpen(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={submitForgot} disabled={fpBusy}>
              {fpBusy ? "Keičiama…" : "Pakeisti slaptažodį"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
