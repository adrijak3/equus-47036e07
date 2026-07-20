import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, FileText, ShieldCheck, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export function WelcomeOnboarding() {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || isAdmin) return;
    (async () => {
      const { data, error } = await supabase.from("profiles" as any).select("onboarding_accepted_at").eq("id", user.id).maybeSingle() as any;
      if (!error && !data?.onboarding_accepted_at) setOpen(true);
    })();
  }, [user, isAdmin]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReadToEnd(true);
  };

  const finish = async () => {
    if (!user || !readToEnd || !accepted) return;
    setSaving(true);
    const { error } = await supabase.from("profiles" as any).update({ onboarding_accepted_at: new Date().toISOString(), rules_version: "2026-07" } as any).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error("Nepavyko išsaugoti sutikimo"); return; }
    toast.success("Ačiū! Sveiki atvykę į Equus 🐴");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent className="max-w-3xl overflow-hidden border-gold/30 bg-card p-0" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="border-b border-border bg-gradient-card px-6 py-5">
          <DialogTitle className="text-3xl font-display text-gradient-gold">Sveiki atvykę į Equus jojimo mokyklą!</DialogTitle>
          <p className="text-sm text-muted-foreground">Džiaugiamės, kad prisijungėte. Prieš registruojantis į treniruotes, susipažinkite su mūsų žirgyno taisyklėmis.</p>
        </DialogHeader>

        <div ref={scrollRef} onScroll={onScroll} className="max-h-[62vh] space-y-5 overflow-y-auto px-6 py-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <InfoCard icon={ShieldCheck} title="Atšaukimo tvarka">Atšakimas galimas 24 val. prieš treniruotę. Pavėluotai atšaukta treniruotė yra skaičiuojama kaip panaudota, jei priežastis nėra vieną iš šių - liga, force majeure atvejis.</InfoCard>
            <InfoCard icon={Tag} title="Kainos">Aktualios individualių, grupinių ir abonementinių treniruočių kainos visada pateikiamos skiltyje „Kainos“.</InfoCard>
            <InfoCard icon={FileText} title="Sutarties pasirašymas">Prieš pirmąją treniruotę nepamirškite pasirašyti jojimo sutarties.</InfoCard>
            <InfoCard icon={BookOpen} title="Žirgyno taisyklės">Atvykite ~30 min. prieš treniruotės laiką, dėvėkite tinkamą avalynę.</InfoCard>
          </section>

          <section className="rounded-xl border border-gold/20 bg-background/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h3 className="font-display text-xl">Sutarties ir taisyklių peržiūra</h3><p className="text-xs text-muted-foreground">Perskaitykite dokumentą iki apačios.</p></div>
              <a href="/equus-sutartis-ir-taisykles.pdf" target="_blank" rel="noreferrer" className="text-sm text-gold underline">Atidaryti PDF</a>
            </div>
            <iframe title="Equus sutarties peržiūra" src="/equus-sutartis-ir-taisykles.pdf#toolbar=0" className="h-[360px] w-full rounded-lg border bg-white" />
          </section>

          <section className="rounded-xl border border-border bg-background/30 p-4 text-sm leading-7">
            <h3 className="mb-2 font-display text-xl">Svarbu prieš pirmą treniruotę</h3>
            <p>Registruodamiesi pateikite teisingą telefono numerį ir el. paštą. Į treniruotę atvykite sutartu laiku. Už nepilnamečius atsako jų atstovai. Apie sveikatos būklę ar kitą svarbią informaciją praneškite treneriui iš anksto.</p>
            <p className="mt-3">Daugiau informacijos rasite čia.</p>
            <Link to="/informacija" target="_blank" className="mt-3 inline-flex text-gold underline">Peržiūrėti visą informaciją →</Link>
          </section>

          <div className="flex min-h-24 items-end justify-center text-center text-xs text-muted-foreground">
            {readToEnd ? <span className="flex items-center gap-1 text-emerald-500"><CheckCircle2 className="h-4 w-4"/> Perskaitėte iki galo</span> : "Slinkite žemyn iki pat pabaigos, kad galėtumėte sutikti."}
          </div>
        </div>

        <div className="border-t border-border bg-card px-6 py-4">
          <label className={`flex items-start gap-3 rounded-lg border p-3 ${readToEnd ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
            <Checkbox checked={accepted} disabled={!readToEnd} onCheckedChange={(v) => setAccepted(v === true)} />
            <span className="text-sm">Susipažinau su taisyklėmis, kainomis, atšaukimo tvarka ir sutarties pasirašymo priminimu.</span>
          </label>
          <Button variant="gold" className="mt-3 w-full" disabled={!readToEnd || !accepted || saving} onClick={finish}>{saving ? "Išsaugoma…" : "Sutinku ir tęsti"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoCard({ icon: Icon, title, children }: { icon: typeof ShieldCheck; title: string; children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-background/35 p-4"><Icon className="mb-2 h-5 w-5 text-gold"/><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p></div>;
}
