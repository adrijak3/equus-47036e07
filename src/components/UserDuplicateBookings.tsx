import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";

export function UserDuplicateBookings({userId}:{userId:string}){
 const [rows,setRows]=useState<any[]>([]); const [chosen,setChosen]=useState<any|null>(null); const load=async()=>{const {data,error}=await (supabase as any).rpc("get_possible_duplicate_bookings",{_user_id:userId});if(!error)setRows(data??[])}; useEffect(()=>{load()},[userId]);
 const cancel=async(id:string)=>{const {data,error}=await (supabase as any).rpc("cancel_possible_duplicate_booking",{_booking_id:id});if(error||data?.ok===false)toast.error(error?.message||data?.message||"Nepavyko");else{toast.success("Pasirinkta rezervacija pašalinta");setChosen(null);load()}};
 if(!rows.length)return null;
 return <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 text-amber-500"/><div><h3 className="font-semibold">Galimi pasikartojantys nuolatiniai laikai</h3><p className="mt-1 text-sm text-muted-foreground">Nieko nešaliname automatiškai. Peržiūrėkite kiekvieną atvejį ir pasirinkite patys.</p></div></div><div className="mt-4 space-y-3">{rows.map(r=><div key={r.suspect_booking_id} className="flex flex-col gap-3 rounded-xl border border-border bg-background/30 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-medium">{r.slot_date}</div><div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground"><Clock className="h-4 w-4"/>Nuolatinis: {String(r.permanent_time).slice(0,5)} · galimas senas laikas: {String(r.suspect_time).slice(0,5)}</div></div><Button variant="outline" onClick={()=>setChosen(r)}>Peržiūrėti</Button></div>)}</div>
 <Dialog open={!!chosen} onOpenChange={o=>!o&&setChosen(null)}><DialogContent><DialogHeader><DialogTitle>Pasirinkite, ką palikti</DialogTitle></DialogHeader>{chosen&&<div className="space-y-4"><p className="text-sm text-muted-foreground">Data: {chosen.slot_date}. Dabartinis nuolatinis laikas yra {String(chosen.permanent_time).slice(0,5)}. Kitas tos pačios dienos įrašas yra {String(chosen.suspect_time).slice(0,5)}.</p><Button variant="outline" className="w-full" onClick={()=>setChosen(null)}>Palikti abu</Button><Button variant="destructive" className="w-full" onClick={()=>cancel(chosen.suspect_booking_id)}>Pašalinti {String(chosen.suspect_time).slice(0,5)} rezervaciją</Button></div>}</DialogContent></Dialog>
 </div>
}
