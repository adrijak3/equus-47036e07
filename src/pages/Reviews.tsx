import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Star } from "lucide-react";
import { toast } from "sonner";

export default function Reviews(){
 const [items,setItems]=useState<any[]>([]); const [open,setOpen]=useState(false); const [rating,setRating]=useState(5); const [body,setBody]=useState(""); const [name,setName]=useState(""); const [showName,setShowName]=useState(true);
 const load=async()=>{const {data}=await (supabase as any).rpc("get_approved_reviews");setItems(data??[])}; useEffect(()=>{load()},[]);
 const submit=async()=>{if(body.trim().length<5){toast.error("Parašykite trumpą atsiliepimą");return} const {error}=await (supabase as any).rpc("submit_public_review",{_rating:rating,_body:body.trim(),_author_name:name.trim()||null,_show_name:showName}); if(error)toast.error(error.message);else{toast.success("Ačiū! Atsiliepimas išsiųstas patvirtinimui.");setOpen(false);setBody("")}};
 return <div className="container max-w-5xl py-12"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs uppercase tracking-[.25em] text-gold/70">Equus bendruomenė</p><h1 className="font-display text-5xl text-gradient-gold">Atsiliepimai</h1><p className="mt-2 text-muted-foreground">Palikite atsiliepimą tik tada, kai patys norite.</p></div><Button variant="gold" onClick={()=>setOpen(true)}>Palikti atsiliepimą</Button></div>
 <div className="mt-8 grid gap-4 md:grid-cols-2">{items.length===0?<p className="text-muted-foreground">Patvirtintų atsiliepimų dar nėra.</p>:items.map(x=><article key={x.id} className="rounded-2xl border border-gold/15 bg-gradient-card p-5"><div className="flex gap-1">{Array.from({length:5}).map((_,i)=><Star key={i} className={`h-4 w-4 ${i<x.rating?"fill-gold text-gold":"text-muted"}`}/>)}</div><p className="mt-3 leading-7">{x.body}</p><p className="mt-3 text-sm text-muted-foreground">— {x.show_name?(x.author_name||"Equus lankytojas"):"Anonimiškai"}</p></article>)}</div>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Palikti atsiliepimą</DialogTitle></DialogHeader><div className="space-y-4"><div className="flex gap-2">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setRating(n)}><Star className={`h-7 w-7 ${n<=rating?"fill-gold text-gold":"text-muted"}`}/></button>)}</div><Input placeholder="Jūsų vardas (nebūtina)" value={name} onChange={e=>setName(e.target.value)}/><Textarea placeholder="Jūsų atsiliepimas" value={body} onChange={e=>setBody(e.target.value)}/><label className="flex items-center gap-2 text-sm"><Checkbox checked={showName} onCheckedChange={v=>setShowName(v===true)}/>Rodyti mano vardą viešai</label><Button variant="gold" className="w-full" onClick={submit}>Išsiųsti</Button></div></DialogContent></Dialog>
 </div>
}
