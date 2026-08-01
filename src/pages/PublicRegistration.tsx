import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const LEVELS = [
  { value: "beginner", title: "Pradedantysis", text: "Niekada nejojo arba jojo tik 1–2 kartus pramogai. Savarankiškai dar nejoja risčia." },
  { value: "intermediate", title: "Vidutiniškai pažengęs", text: "Yra jojęs anksčiau, savarankiškai joja risčia, yra bandęs zovaduoti ir šokti nedidelius šuolius." },
  { value: "advanced", title: "Pažengęs", text: "Savarankiškai balnoja žirgą, užtikrintai joja visais aliūrais, šokinėja ir/ar yra dalyvavęs varžybose." },
] as const;

type Level = typeof LEVELS[number]["value"];
type Slot = { slot_date: string; slot_time: string; max_capacity: number; active_count: number; lesson_type: string };

export default function PublicRegistration() {
  const { token } = useParams();
  const [step, setStep] = useState(1);
  const [level, setLevel] = useState<Level | "">("");
  const [form, setForm] = useState({ firstName: "", lastName: "", phone: "", email: "", age: "", emergency: "", experienceNotes: "", preferredTimes: "", facebookName: "" });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [existing, setExisting] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data } = await (supabase as any).rpc("get_public_registration_request", { _token: token });
      setExisting(Array.isArray(data) ? data[0] : data);
    })();
  }, [token]);

  useEffect(() => {
    if (!level || level === "beginner") { setSlots([]); return; }
    (async () => {
      const { data, error } = await (supabase as any).rpc("get_public_registration_slots", { _days: 45 });
      if (error) { toast.error("Nepavyko užkrauti laikų"); return; }
      setSlots((data ?? []).filter((s: Slot) => s.max_capacity >= 2));
    })();
  }, [level]);

  const validInfo = form.firstName.trim() && form.lastName.trim() && form.phone.trim() && form.email.trim() && Number(form.age) > 0 && form.emergency.trim();
  const remaining = (s: Slot) => Math.max(0, s.max_capacity - s.active_count);
  const lessonType = (s: Slot) => s.max_capacity === 2 ? "Porinė" : "Grupinė";

  const submit = async () => {
    if (!level || !validInfo || !rules) return;
    if (level !== "beginner" && !selected) { toast.error("Pasirinkite pageidaujamą laiką"); return; }
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("submit_public_registration", {
      _first_name: form.firstName.trim(), _last_name: form.lastName.trim(), _phone: form.phone.trim(), _email: form.email.trim(),
      _age: Number(form.age), _emergency_contact: form.emergency.trim(), _experience_level: level,
      _experience_notes: form.experienceNotes.trim() || null, _preferred_times: form.preferredTimes.trim() || null,
      _requested_date: selected?.slot_date ?? null, _requested_time: selected?.slot_time ?? null,
      _facebook_name: form.facebookName.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.public_token) history.replaceState(null, "", `/registracija/${result.public_token}`);
    setDone(true);
  };

  if (token && existing) {
    const accept = async (yes: boolean) => {
      const { error } = await (supabase as any).rpc("respond_to_public_registration_proposal", { _token: token, _accept: yes });
      if (error) toast.error(error.message); else { toast.success(yes ? "Laikas patvirtintas" : "Pasiūlymas atmestas"); location.reload(); }
    };
    return <div className="container max-w-2xl py-12"><div className="rounded-3xl border border-gold/20 bg-gradient-card p-6 shadow-elegant">
      <h1 className="font-display text-3xl text-gradient-gold">Registracijos būsena</h1>
      <p className="mt-3 text-muted-foreground">{existing.first_name} {existing.last_name}</p>
      <div className="mt-5 rounded-xl border border-gold/15 bg-background/35 p-4">
        <p><b>Būsena:</b> {existing.status}</p>
        {existing.proposed_date && <p className="mt-2"><b>Pasiūlytas laikas:</b> {existing.proposed_date} · {String(existing.proposed_time).slice(0,5)}</p>}
        {existing.admin_note && <p className="mt-2 text-sm text-muted-foreground">{existing.admin_note}</p>}
      </div>
      {existing.status === "proposed" && <div className="mt-5 flex gap-3"><Button variant="gold" onClick={() => accept(true)}>Priimti laiką</Button><Button variant="outline" onClick={() => accept(false)}>Atmesti</Button></div>}
      {existing.status === "approved" && <p className="mt-5 text-emerald-500">Registracija patvirtinta. Jei negalėsite dalyvauti, taikomos įprastos Equus atšaukimo taisyklės.</p>}
    </div></div>;
  }

  if (done) return <div className="container max-w-xl py-16 text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500"/><h1 className="mt-4 font-display text-4xl text-gradient-gold">Registracija gauta!</h1><p className="mt-3 text-muted-foreground">Administracija peržiūrės prašymą ir susisieks su jumis. Vienos treniruotės kaina – 35 €.</p><Link to="/atsiliepimai" className="mt-6 inline-block text-gold underline">Peržiūrėti atsiliepimus</Link></div>;

  return <div className="container max-w-4xl py-10 sm:py-14">
    <header className="mb-8"><p className="text-xs uppercase tracking-[.25em] text-gold/70">Vieša registracija</p><h1 className="font-display text-4xl text-gradient-gold sm:text-5xl">Registruotis į treniruotę</h1><p className="mt-2 text-muted-foreground">Prašymą gali pateikti ir neturint paskyros.</p></header>
    <div className="mb-6 grid grid-cols-4 gap-2">{[1,2,3,4].map(n => <div key={n} className={cn("h-2 rounded-full", n <= step ? "bg-gold" : "bg-muted")}/>)}</div>
    <div className="rounded-3xl border border-gold/20 bg-gradient-card p-5 shadow-elegant sm:p-8">
      {step === 1 && <div><h2 className="font-display text-3xl">Jojimo patirtis</h2><div className="mt-5 grid gap-3">{LEVELS.map(x => <button key={x.value} onClick={() => setLevel(x.value)} className={cn("rounded-2xl border p-5 text-left transition-all", level === x.value ? "border-gold bg-gold/10 shadow-gold" : "border-border bg-background/30 hover:border-gold/40")}><div className="font-semibold">{x.title}</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{x.text}</p></button>)}</div></div>}
      {step === 2 && <div><h2 className="font-display text-3xl">Asmeninė informacija</h2><div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Vardas"><Input value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></Field><Field label="Pavardė"><Input value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></Field>
        <Field label="Telefonas"><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field><Field label="El. paštas"><Input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></Field>
        <Field label="Amžius"><Input type="number" min="4" max="90" value={form.age} onChange={e=>setForm({...form,age:e.target.value})}/></Field><Field label="Skubios pagalbos kontaktas"><Input value={form.emergency} onChange={e=>setForm({...form,emergency:e.target.value})}/></Field>
        <Field label="Papildomai apie jojimo patirtį" full><Textarea value={form.experienceNotes} onChange={e=>setForm({...form,experienceNotes:e.target.value})} placeholder="Trumpai parašykite, ką jau mokate arba kur esate joję."/></Field>
        <Field label="Facebook vardas ir pavardė (nebūtina)" full><Input value={form.facebookName} onChange={e=>setForm({...form,facebookName:e.target.value})} placeholder="Kad galėtume rasti ir pridėti į Messenger grupę"/></Field>
      </div></div>}
      {step === 3 && <div><h2 className="font-display text-3xl">Pageidaujamas laikas</h2>{level === "beginner" ? <div className="mt-5 rounded-2xl border border-gold/20 bg-gold/5 p-5"><p className="font-medium">Pradedantiesiems laiką parenka administracija.</p><p className="mt-2 text-sm text-muted-foreground">Darbo dienų laikų tiesiogiai pasirinkti negalima. Parašykite, kurios dienos ir valandos jums patogiausios.</p><Textarea className="mt-4" value={form.preferredTimes} onChange={e=>setForm({...form,preferredTimes:e.target.value})} placeholder="Pvz. šeštadieniais po 12 val. arba sekmadieniais ryte"/></div> : <div className="mt-5 grid gap-3 sm:grid-cols-2">{slots.map(s => { const left=remaining(s); return <button key={`${s.slot_date}-${s.slot_time}`} disabled={left<=0} onClick={()=>setSelected(s)} className={cn("rounded-2xl border p-4 text-left", selected?.slot_date===s.slot_date&&selected?.slot_time===s.slot_time ? "border-gold bg-gold/10" : "border-border bg-background/30", left<=0&&"opacity-50")}><div className="flex items-center justify-between"><span className="font-semibold">{s.slot_date}</span><span className={cn("rounded-full px-2 py-1 text-xs", left===0?"bg-red-500/15 text-red-500":left===1?"bg-amber-500/15 text-amber-500":"bg-emerald-500/15 text-emerald-500")}>{left===0?"Pilna":left===1?"Liko 1 vieta":`Liko ${left} vietos`}</span></div><div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Clock className="h-4 w-4"/>{s.slot_time.slice(0,5)}</span><span className="flex items-center gap-1"><Users className="h-4 w-4"/>{lessonType(s)}</span></div></button>})}</div>}</div>}
      {step === 4 && <div><h2 className="font-display text-3xl">Patvirtinimas</h2><div className="mt-5 space-y-2 rounded-2xl border border-border bg-background/30 p-5 text-sm"><p><b>Vardas:</b> {form.firstName} {form.lastName}</p><p><b>Patirtis:</b> {LEVELS.find(x=>x.value===level)?.title}</p><p><b>Laikas:</b> {selected ? `${selected.slot_date} · ${selected.slot_time.slice(0,5)} · ${lessonType(selected)}` : "Parinks administracija"}</p><p><b>Kaina:</b> 35 €</p></div><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-gold/20 p-4"><Checkbox checked={rules} onCheckedChange={v=>setRules(v===true)}/><span className="text-sm">Susipažinau, kad patvirtintai registracijai taikomos Equus treniruočių atšaukimo taisyklės.</span></label></div>}
      <div className="mt-8 flex justify-between"><Button variant="ghost" disabled={step===1} onClick={()=>setStep(s=>s-1)}><ChevronLeft className="h-4 w-4"/>Atgal</Button>{step<4?<Button variant="gold" disabled={(step===1&&!level)||(step===2&&!validInfo)} onClick={()=>setStep(s=>s+1)}>Toliau<ChevronRight className="h-4 w-4"/></Button>:<Button variant="gold" disabled={!rules||busy} onClick={submit}>{busy?"Siunčiama…":"Pateikti registraciją"}</Button>}</div>
    </div>
  </div>;
}

function Field({label,children,full=false}:{label:string;children:ReactNode;full?:boolean}){return <div className={full?"sm:col-span-2":""}><Label>{label}</Label><div className="mt-1.5">{children}</div></div>}
