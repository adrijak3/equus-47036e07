import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, FileText, ShieldCheck, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEquusTheme, type EquusTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const themes: {value:EquusTheme;label:string;preview:string}[]=[
 {value:"automatic",label:"Automatinė",preview:"from-pink-200 via-amber-200 to-slate-700"},
 {value:"spring",label:"Pavasaris",preview:"from-[#f6c4d9] via-[#dc87ae] to-[#9f4674]"},
 {value:"summer",label:"Vasara",preview:"from-[#FFEED6] via-[#A5AF79] to-[#E8A07C]"},
 {value:"autumn",label:"Ruduo",preview:"from-[#2a1712] via-[#72412a] to-[#d08a4c]"},
 {value:"winter",label:"Žiema",preview:"from-[#07111f] via-[#102b49] to-[#7cbcff]"},
];

export function WelcomeOnboarding(){
 const {user,isAdmin,profile,refreshProfile}=useAuth(); const {theme,setTheme}=useEquusTheme();
 const [open,setOpen]=useState(false); const [step,setStep]=useState(1); const [displayName,setDisplayName]=useState("");
 const [notifyReminders,setNotifyReminders]=useState(true); const [notifyChanges,setNotifyChanges]=useState(true); const [notifyNews,setNotifyNews]=useState(true);
 const [readToEnd,setReadToEnd]=useState(false); const [accepted,setAccepted]=useState(false); const [saving,setSaving]=useState(false); const scrollRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!user||isAdmin)return;(async()=>{const{data,error}=await (supabase as any).from("profiles").select("onboarding_accepted_at,display_name,full_name").eq("id",user.id).maybeSingle();if(!error&&!data?.onboarding_accepted_at){setDisplayName(data?.display_name||recommended(data?.full_name||profile?.full_name||""));setOpen(true)}})()},[user,isAdmin]);
 const onScroll=()=>{const el=scrollRef.current;if(el&&el.scrollTop+el.clientHeight>=el.scrollHeight-12)setReadToEnd(true)};
 const finish=async()=>{if(!user||!readToEnd||!accepted||!displayName.trim())return;setSaving(true);const{error}=await (supabase as any).from("profiles").update({display_name:displayName.trim(),onboarding_accepted_at:new Date().toISOString(),rules_version:"2026-08",notify_lesson_reminders:notifyReminders,notify_schedule_changes:notifyChanges,notify_school_news:notifyNews}).eq("id",user.id);setSaving(false);if(error){toast.error("Nepavyko išsaugoti");return}await refreshProfile();toast.success("Sveiki atvykę į Equus 🐴");setOpen(false)};
 return <Dialog open={open} onOpenChange={()=>undefined}><DialogContent className="grid h-[100dvh] max-h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-gold/30 bg-card p-0 sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:rounded-2xl" onEscapeKeyDown={e=>e.preventDefault()} onPointerDownOutside={e=>e.preventDefault()}>
  <DialogHeader className="border-b border-border bg-gradient-card px-4 py-4 pr-10 sm:px-6"><DialogTitle className="font-display text-2xl text-gradient-gold sm:text-3xl">Sveiki atvykę į Equus jojimo mokyklą!</DialogTitle><div className="mt-3 grid grid-cols-4 gap-2">{[1,2,3,4].map(n=><div key={n} className={cn("h-1.5 rounded-full",n<=step?"bg-gold":"bg-muted")}/>)}</div></DialogHeader>
  <div ref={scrollRef} onScroll={onScroll} className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
   {step===1&&<div><h3 className="font-display text-2xl">Kaip rodyti jūsų vardą grafike?</h3><p className="mt-2 text-sm text-muted-foreground">Rekomenduojamas formatas: vardas ir pirma pavardės raidė, pvz. Adrija K.</p><Input className="mt-5" value={displayName} onChange={e=>setDisplayName(e.target.value)} maxLength={40}/></div>}
   {step===2&&<div><h3 className="font-display text-2xl">Pasirinkite svetainės temą</h3><div className="mt-5 grid gap-3 sm:grid-cols-2">{themes.map(t=><button key={t.value} onClick={()=>setTheme(t.value)} className={cn("rounded-2xl border p-3 text-left",theme===t.value?"border-gold bg-gold/10":"border-border")}><div className={cn("h-16 rounded-xl bg-gradient-to-br",t.preview)}/><div className="mt-2 font-semibold">{t.label}</div></button>)}</div></div>}
   {step===3&&<div><h3 className="font-display text-2xl">Pranešimai</h3><p className="mt-2 text-sm text-muted-foreground">Pasirinkite, kokius svarbius pranešimus norite gauti. Tai nėra reklama.</p><div className="mt-5 space-y-3">{[[notifyReminders,setNotifyReminders,"Treniruotės priminimai"],[notifyChanges,setNotifyChanges,"Grafiko pakeitimai"],[notifyNews,setNotifyNews,"Svarbios mokyklos naujienos"]].map(([v,setter,label]:any)=><label key={label} className="flex cursor-pointer items-center gap-3 rounded-xl border p-4"><Checkbox checked={v} onCheckedChange={x=>setter(x===true)}/><span>{label}</span></label>)}</div></div>}
   {step===4&&<div><div className="grid gap-3 sm:grid-cols-2"><Card icon={ShieldCheck} title="Atšaukimo tvarka">Atšaukimas galimas 24 val. prieš treniruotę. Pavėluotai atšaukta treniruotė skaičiuojama kaip panaudota, išskyrus ligą ar force majeure.</Card><Card icon={Tag} title="Kainos">Aktualios kainos pateikiamos skiltyje „Kainos“.</Card><Card icon={FileText} title="Sutartis">Prieš pirmą treniruotę nepamirškite pasirašyti jojimo sutarties.</Card><Card icon={BookOpen} title="Žirgyno taisyklės">Atvykite maždaug 30 min. anksčiau ir dėvėkite tinkamą avalynę.</Card></div><div className="mt-4 rounded-2xl border border-gold/20 p-4"><div className="mb-3 flex justify-between"><div><h3 className="font-display text-xl">Sutartis ir taisyklės</h3><p className="text-xs text-muted-foreground">Perskaitykite iki apačios.</p></div><a href="/equus-sutartis-ir-taisykles.pdf" target="_blank" className="text-sm text-gold underline">Atidaryti PDF</a></div><iframe title="Sutartis" src="/equus-sutartis-ir-taisykles.pdf#toolbar=0" className="h-[260px] w-full rounded-lg border bg-white sm:h-[360px]"/></div><p className="mt-5 text-sm">Daugiau informacijos rasite <Link to="/informacija" target="_blank" className="text-gold underline">Informacijos puslapyje</Link>.</p><div className="min-h-20 pt-8 text-center text-xs text-muted-foreground">{readToEnd?<span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 className="h-4 w-4"/>Perskaitėte iki galo</span>:"Slinkite iki pat pabaigos."}</div></div>}
  </div>
  <div className="border-t border-border bg-card px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6">{step===4&&<label className={cn("mb-3 flex items-start gap-3 rounded-lg border p-3",!readToEnd&&"opacity-50")}><Checkbox checked={accepted} disabled={!readToEnd} onCheckedChange={v=>setAccepted(v===true)}/><span className="text-sm">Susipažinau su taisyklėmis, kainomis, atšaukimo tvarka ir sutarties priminimu.</span></label>}<div className="flex justify-between"><Button variant="ghost" disabled={step===1} onClick={()=>setStep(s=>s-1)}><ChevronLeft className="h-4 w-4"/>Atgal</Button>{step<4?<Button variant="gold" disabled={step===1&&!displayName.trim()} onClick={()=>setStep(s=>s+1)}>Toliau<ChevronRight className="h-4 w-4"/></Button>:<Button variant="gold" disabled={!readToEnd||!accepted||saving} onClick={finish}>{saving?"Išsaugoma…":"Sutinku ir tęsiu"}</Button>}</div></div>
 </DialogContent></Dialog>
}
function recommended(full:string){const parts=full.trim().split(/\s+/);return parts.length>1?`${parts[0]} ${parts[parts.length-1][0]}.`:parts[0]||""}
function Card({icon:Icon,title,children}:{icon:any;title:string;children:ReactNode}){return <div className="rounded-2xl border bg-background/35 p-4"><Icon className="mb-2 h-5 w-5 text-gold"/><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p></div>}
