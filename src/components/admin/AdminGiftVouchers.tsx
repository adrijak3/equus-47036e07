import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type GiftRequest = {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  service_type: string;
  quoted_price_eur: number | null;
  notes: string | null;
  status: "new" | "contacted" | "completed" | "cancelled";
  created_at: string;
};
const LABELS: Record<string,string> = {
  group_single:"Grupinė pamoka",
  pair_single:"Pamoka po 2",
  individual_single:"Individuali pamoka",
  group_4:"4 grupinės treniruotės",
  group_8:"8 grupinės treniruotės",
  dream_30:"Mažylio svajonė – 30 min.",
  dream_45:"Mažylio svajonė – 45 min.",
  photoshoot:"Fotosesija",
};
const STATUS: Record<string,string> = {
  new:"Nauja", contacted:"Susisiekta", completed:"Išduota", cancelled:"Atšaukta",
};
export function AdminGiftVouchers() {
  const [rows,setRows]=useState<GiftRequest[]>([]);
  const [loading,setLoading]=useState(true);
  const [updating,setUpdating]=useState<string|null>(null);
  const load=async () => {
    setLoading(true);
    const {data,error}=await (supabase as any).from("gift_voucher_requests")
      .select("id,buyer_name,buyer_email,buyer_phone,recipient_name,recipient_phone,service_type,quoted_price_eur,notes,status,created_at")
      .order("created_at",{ascending:false}).limit(250);
    setLoading(false);
    if(error) { toast.error("Nepavyko įkelti kuponų užklausų."); return; }
    setRows((data||[]) as GiftRequest[]);
  };
  useEffect(() => {void load();},[]);
  const change=async (row:GiftRequest,status:"contacted"|"cancelled") => {
    setUpdating(row.id);
    const {error}=await (supabase as any).from("gift_voucher_requests")
      .update({status,updated_at:new Date().toISOString()})
      .eq("id",row.id);
    setUpdating(null);
    if(error) {toast.error("Nepavyko pakeisti būsenos.");return;}
    setRows((previous)=>previous.map((item)=>item.id===row.id?{...item,status}:item));
    toast.success("Būsena atnaujinta.");
  };
  return <section className="mt-8 space-y-4 border-t border-border/70 pt-6">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="font-display text-xl">Dovanų kuponų užklausos</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pirkimą ir kupono išdavimą patvirtinkite atskirai.</p></div>
      <Button variant="outline" size="sm" onClick={()=>void load()} disabled={loading}>{loading?"Kraunama…":"Atnaujinti"}</Button>
    </div>
    {!loading && rows.length===0 && <p className="text-sm text-muted-foreground">Užklausų dar nėra.</p>}
    <div className="divide-y divide-border/60 border-t border-border/60">
      {rows.map((row)=><article key={row.id} className="space-y-2 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{row.recipient_name} · {LABELS[row.service_type]||row.service_type}</h3>
          <span className="text-xs text-muted-foreground">{STATUS[row.status]||row.status} · {new Date(row.created_at).toLocaleDateString("lt-LT")}</span>
        </div>
        <p className="text-sm">Kaina: {row.quoted_price_eur===null?"derinama":row.quoted_price_eur+" €"}</p>
        <p className="text-sm"><strong>Pirkėjas:</strong> {row.buyer_name} · <a className="text-gold underline" href={`mailto:${row.buyer_email}`}>{row.buyer_email}</a> · <a className="text-gold underline" href={`tel:${row.buyer_phone}`}>{row.buyer_phone}</a></p>
        <p className="text-sm"><strong>Gavėjas:</strong> {row.recipient_name} · <a className="text-gold underline" href={`tel:${row.recipient_phone}`}>{row.recipient_phone}</a></p>
        {row.notes && <p className="text-sm text-muted-foreground"><strong>Pastabos:</strong> {row.notes}</p>}
        {row.status==="new" && <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={updating===row.id} onClick={()=>void change(row,"contacted")}>Pažymėti „Susisiekta“</Button>
          <Button variant="ghost" size="sm" disabled={updating===row.id} onClick={()=>void change(row,"cancelled")}>Atšaukti</Button>
        </div>}
      </article>)}
    </div>
  </section>;
}
