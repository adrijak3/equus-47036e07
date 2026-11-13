import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { TurnstileCaptcha, TURNSTILE_SITE_KEY } from "@/components/TurnstileCaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const OPTIONS = [
  { value: "group_single", name: "Grupinė jojimo pamoka", price: 40 },
  { value: "pair_single", name: "Jojimo pamoka po 2 (vienam asmeniui)", price: 45 },
  { value: "individual_single", name: "Individuali jojimo pamoka", price: 50 },
  { value: "group_4", name: "4 grupinės jojimo treniruotės", price: 150 },
  { value: "group_8", name: "8 grupinės jojimo treniruotės", price: 280 },
  { value: "dream_30", name: "Mažylio svajonė – 30 min.", price: 20 },
  { value: "dream_45", name: "Mažylio svajonė – 45 min.", price: 35 },
  { value: "photoshoot", name: "Fotosesija su žirgu", price: null },
] as const;

const phoneValid = (phone: string) => /^[+0-9() .-]{6,30}$/.test(phone.trim());
const emailValid = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export default function GiftVoucherRequest() {
  const [form, setForm] = useState({
    buyerName: "", buyerEmail: "", buyerPhone: "",
    recipientName: "", recipientPhone: "", service: "",
    notes: "", website: "",
  });
  const [agreed, setAgreed] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const selected = OPTIONS.find((option) => option.value === form.service);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !agreed || !emailValid(form.buyerEmail) ||
      !phoneValid(form.buyerPhone) || !phoneValid(form.recipientPhone) ||
      form.buyerName.trim().length < 2 || form.recipientName.trim().length < 2) {
      toast.error("Patikrinkite privalomus laukus.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error("Patvirtinkite, kad nesate robotas.");
      return;
    }
    setSending(true);
    const {data,error}=await supabase.functions.invoke("submit-gift-voucher-request", {
      body: { ...form, captchaToken },
    });
    setSending(false);
    setCaptchaToken("");
    setCaptchaNonce((previous) => previous + 1);
    if (error || !data?.ok) {
      toast.error(error?.message || "Nepavyko išsiųsti užklausos. Bandykite vėliau.");
      return;
    }
    setSubmitted(true);
  };

  return (
    <main className="container max-w-2xl py-9 sm:py-14">
      <Link className="text-sm text-gold hover:underline" to="/registracija">Registracija</Link>
      <h1 className="mt-3 font-display text-3xl sm:text-4xl">Dovanų kuponas</h1>
      {submitted ? (
        <div className="mt-8 space-y-4 border-t border-border/70 pt-7">
          <h2 className="text-xl font-semibold">Užklausa gauta</h2>
          <p>Susisieksime dėl apmokėjimo ir kupono paruošimo.</p>
          <p className="text-sm text-muted-foreground">Tai dar nėra apmokėtas ar išduotas kuponas. Patikrinkite el. paštą.</p>
          <Button asChild variant="outline"><Link to="/">Grįžti į pradžią</Link></Button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Išsirinkite paslaugą. Kuponas galios 12 mėnesių nuo išdavimo.
            Visoms paslaugoms būtina išankstinė registracija.
          </p>
          <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-7">
            <section className="space-y-4 border-t border-border/70 pt-5">
              <h2 className="text-lg font-semibold">Paslauga</h2>
              <div className="space-y-2">
                <Label htmlFor="gift-service">Kokią paslaugą dovanosite?</Label>
                <select id="gift-service" required value={form.service}
                  onChange={(e) => set("service")(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Pasirinkite paslaugą</option>
                  {OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.name} – {option.price === null ? "kaina derinama" : option.price + " €"}
                    </option>
                  ))}
                </select>
              </div>
              {selected && (
                <p className="text-base font-semibold text-foreground">
                  {selected.price === null ? "Fotosesijos kainą suderinsime susisiekę." : "Kaina: " + selected.price + " €"}
                </p>
              )}
            </section>
            <section className="space-y-4 border-t border-border/70 pt-5">
              <h2 className="text-lg font-semibold">Pirkėjo duomenys</h2>
              <div className="space-y-2"><Label htmlFor="gift-buyer-name">Vardas ir pavardė</Label>
                <Input id="gift-buyer-name" autoComplete="name" required minLength={2} maxLength={150}
                  value={form.buyerName} onChange={(e) => set("buyerName")(e.target.value)}/></div>
              <div className="space-y-2"><Label htmlFor="gift-buyer-email">El. paštas kuponui gauti</Label>
                <Input id="gift-buyer-email" type="email" autoComplete="email" required maxLength={254}
                  value={form.buyerEmail} onChange={(e) => set("buyerEmail")(e.target.value)}/></div>
              <div className="space-y-2"><Label htmlFor="gift-buyer-phone">Telefono numeris susisiekti</Label>
                <Input id="gift-buyer-phone" type="tel" autoComplete="tel" required maxLength={30}
                  value={form.buyerPhone} onChange={(e) => set("buyerPhone")(e.target.value)}/></div>
            </section>
            <section className="space-y-4 border-t border-border/70 pt-5">
              <h2 className="text-lg font-semibold">Kupono gavėjas</h2>
              <div className="space-y-2"><Label htmlFor="gift-recipient-name">Vardas ir pavardė</Label>
                <Input id="gift-recipient-name" required minLength={2} maxLength={150}
                  value={form.recipientName} onChange={(e) => set("recipientName")(e.target.value)}/></div>
              <div className="space-y-2"><Label htmlFor="gift-recipient-phone">Telefono numeris rezervacijai</Label>
                <Input id="gift-recipient-phone" type="tel" required maxLength={30}
                  value={form.recipientPhone} onChange={(e) => set("recipientPhone")(e.target.value)}/></div>
            </section>
            <section className="space-y-3 border-t border-border/70 pt-5">
              <Label htmlFor="gift-notes">Pastabos (neprivaloma)</Label>
              <Textarea id="gift-notes" rows={3} maxLength={1500} placeholder="Jei turite klausimų ar pageidavimų"
                value={form.notes} onChange={(e) => set("notes")(e.target.value)}/>
              <div className="sr-only" aria-hidden="true"><Label htmlFor="gift-website">Svetainė</Label>
                <Input id="gift-website" tabIndex={-1} autoComplete="off"
                  value={form.website} onChange={(e) => set("website")(e.target.value)}/></div>
              <p className="text-sm text-muted-foreground">Dizainą galėsite pasirinkti vėliau – kai turėsime visus variantus.</p>
            </section>
            <section className="border-t border-border/70 pt-5 space-y-4">
              <div className="flex items-start gap-3">
                <Checkbox id="gift-privacy" checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)}/>
                <Label htmlFor="gift-privacy" className="text-sm font-normal leading-6">
                  Sutinku, kad mano pateikti duomenys būtų naudojami kupono užklausai administruoti.
                  Susipažinau su <Link className="text-gold underline" to="/privatumo-politika">privatumo politika</Link>.
                </Label>
              </div>
              <TurnstileCaptcha key={captchaNonce} onToken={setCaptchaToken}/>
              <Button type="submit" variant="gold" className="w-full sm:w-auto" disabled={sending || !agreed || !selected}>
                {sending ? "Siunčiama…" : "Pateikti kupono užklausą"}
              </Button>
              <p className="text-xs text-muted-foreground">Apmokėjimą ir kupono išdavimą suderins administracija.</p>
            </section>
          </form>
        </>
      )}
    </main>
  );
}
