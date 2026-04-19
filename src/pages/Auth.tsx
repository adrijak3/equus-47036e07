import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Vardas per trumpas").max(80),
  phone: z.string().trim().min(6, "Neteisingas telefono numeris").max(20),
  email: z.string().trim().email("Neteisingas el. paštas").max(255),
  password: z.string().min(8, "Slaptažodis turi būti bent 8 simbolių").max(128),
});

const signInSchema = z.object({
  email: z.string().trim().email("Neteisingas el. paštas"),
  password: z.string().min(1, "Įveskite slaptažodį"),
});

export default function Auth() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "signup" ? "signup" : "signin");
  const [loading, setLoading] = useState(false);

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
    const parsed = signInSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      toast.error("Neteisingas el. paštas arba slaptažodis");
      return;
    }
    toast.success("Sveiki sugrįžę!");
    navigate("/");
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
                <Label htmlFor="si-email">El. paštas</Label>
                <Input id="si-email" name="email" type="email" required autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="si-pw">Slaptažodis</Label>
                <Input id="si-pw" name="password" type="password" required autoComplete="current-password" />
              </div>
              <Button variant="gold" type="submit" className="w-full mt-6" disabled={loading}>
                {loading ? "Jungiamasi…" : "Prisijungti"}
              </Button>
              <p className="text-xs text-muted-foreground text-center pt-2">
                Pamiršote slaptažodį? Susisiekite su administracija.
              </p>
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
    </div>
  );
}
