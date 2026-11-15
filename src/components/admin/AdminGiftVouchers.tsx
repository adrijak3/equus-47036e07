import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type VoucherRequest = {
 id:string;buyer_name:string;buyer_email:string;buyer_phone:string;
 recipient_name:string;recipient_phone:string;service_type:string;
 quoted_price_eur:number|null;notes:string|null;status:string;created_at:string;
 design_choice:string|null;payment_instructions_sent_at:string|null;
 payment_confirmed_at:string|null;delivery_queued_at:string|null;issued_at:string|null;
};
type Design={id:string;label:string;image_path:string;active:boolean};
const SERVICES:Record<string,string>={
 group_single:"Grupinė pamoka",pair_single:"Pamoka po 2",individual_single:"Individuali",
 group_4:"4 grupinės treniruotės",group_8:"8 grupinės treniruotės",
 dream_30:"Mažylio svajonė – 30 min.",dream_45:"Mažylio svajonė – 45 min.",
 photoshoot:"Fotosesija",
};
const STATE:Record<string,string>={
 new:"Nauja",contacted:"Laukiama apmokėjimo",completed:"Kuponas išduotas",cancelled:"Atšaukta",
};
const publicUrl=(path:string)=>supabase.storage.from("gift-voucher-designs").getPublicUrl(path).data.publicUrl;
export function AdminGiftVouchers(){
 const [rows,setRows]=useState<VoucherRequest[]>([]);
 const [designs,setDesigns]=useState<Design[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState<string|null>(null);
 const [instructions,setInstructions]=useState<Record<string,string>>({});
 const [designName,setDesignName]=useState("");
 const [file,setFile]=useState<File|null>(null);
 const [uploading,setUploading]=useState(false);
 const load=async()=>{
  setLoading(true);
  const [{data,error},{data:ds,error:designError}]=await Promise.all([
   (supabase as any).from("gift_voucher_requests").select("*").order("created_at",{ascending:false}).limit(250),
   (supabase as any).from("gift_voucher_designs").select("*").order("created_at",{ascending:true}),
  ]);
  setLoading(false);
  if(error)toast.error("Nepavyko įkelti kuponų užklausų.");
  else setRows((data||[]) as VoucherRequest[]);
  if(designError)toast.error("Nepavyko įkelti dizainų.");
  else setDesigns((ds||[]) as Design[]);
 };
 useEffect(()=>{void load();},[]);
 const upload=async()=>{
  if(!file||designName.trim().length<2){toast.error("Įveskite dizaino pavadinimą ir pasirinkite paveikslėlį.");return;}
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>8_000_000){
    toast.error("Galima įkelti PNG, JPG arba WEBP iki 8 MB.");return;
  }
  setUploading(true);
  const extension=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
  const imagePath=crypto.randomUUID()+"."+extension;
  const {error:storageError}=await supabase.storage.from("gift-voucher-designs").upload(imagePath,file,{
    contentType:file.type,upsert:false,
  });
  if(storageError){setUploading(false);toast.error(storageError.message);return;}
  const {error}=await (supabase as any).from("gift_voucher_designs")
    .insert({label:designName.trim(),image_path:imagePath,active:true});
  setUploading(false);
  if(error){toast.error("Paveikslėlis įkeltas, bet nepavyko išsaugoti dizaino.");return;}
  setDesignName("");setFile(null);toast.success("Dizainas paskelbtas pirkėjams.");void load();
 };
 const setDesign=async(row:VoucherRequest,designId:string)=>{
  setBusy(row.id);
  const {error}=await (supabase as any).from("gift_voucher_requests")
    .update({design_choice:designId,updated_at:new Date().toISOString()})
    .eq("id",row.id).is("delivery_queued_at",null);
  setBusy(null);
  if(error){toast.error("Nepavyko pasirinkti dizaino.");return;}
  setRows(old=>old.map(x=>x.id===row.id?{...x,design_choice:designId}:x));
 };
 const act=async(row:VoucherRequest,action:"payment"|"confirm"|"issue")=>{
  if(busy)return;
  if(action==="confirm"&&!window.confirm("Ar tikrai PATIKRINOTE, kad mokėjimas gautas?"))return;
  if(action==="issue"&&!window.confirm("Siųsti pasirinktą dovanų kuponą pirkėjui el. paštu?"))return;
  const inst=(instructions[row.id]||"").trim();
  if(action==="payment"&&inst.length<15){toast.error("Įrašykite tikrą mokėjimo informaciją (bent 15 simbolių).");return;}
  setBusy(row.id);
  const {data,error}=await supabase.functions.invoke("admin-gift-voucher",{body:{
    requestId:row.id,action,instructions:inst,confirmPaid:action==="confirm",
  }});
  setBusy(null);
  if(error||!data?.ok){toast.error(data?.error||error?.message||"Veiksmas nepavyko.");return;}
  toast.success(action==="payment"?"Mokėjimo informacija įtraukta į laiškų eilę."
    :action==="confirm"?"Apmokėjimas patvirtintas.":"Kupono paveikslėlis įtrauktas į siuntimo eilę.");
  void load();
 };
 const cancel=async(row:VoucherRequest)=>{
  if(!window.confirm("Atšaukti dovanų kupono užklausą?"))return;
  setBusy(row.id);
  const {error}=await (supabase as any).from("gift_voucher_requests")
    .update({status:"cancelled",updated_at:new Date().toISOString()})
    .eq("id",row.id).is("delivery_queued_at",null);
  setBusy(null);
  if(error){toast.error("Nepavyko atšaukti.");return;}
  void load();
 };
 return <section className="mt-8 space-y-6 border-t border-border/70 pt-6">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="font-display text-xl">Dovanų kuponai</h2>
    <p className="text-xs text-muted-foreground">Pirmiausia išsiųskite apmokėjimo informaciją, tada rankiniu būdu patvirtinkite mokėjimą ir išsiųskite kuponą.</p></div>
   <Button size="sm" variant="outline" onClick={()=>void load()} disabled={loading}>{loading?"Kraunama…":"Atnaujinti"}</Button>
  </div>
  <details className="border-b border-border/70 pb-5">
   <summary className="cursor-pointer font-semibold">Kuponų dizainų įkėlimas ({designs.filter(d=>d.active).length})</summary>
   <div className="mt-3 space-y-3">
    <p className="text-xs text-muted-foreground">Įkelkite savo galutinius dizainus – klientai galės juos peržiūrėti ir pasirinkti. Originalūs paveikslėliai bus siunčiami kaip priedas.</p>
    <div className="flex flex-wrap gap-2">
     <Input className="max-w-xs" placeholder="Pvz., 1 dizainas – klasikinis" value={designName} onChange={e=>setDesignName(e.target.value)} />
     <Input type="file" accept="image/png,image/jpeg,image/webp" className="max-w-xs" onChange={e=>setFile(e.target.files?.[0]||null)} />
     <Button onClick={()=>void upload()} disabled={uploading}>{uploading?"Įkeliama…":"Įkelti dizainą"}</Button>
    </div>
    {designs.length>0&&<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {designs.map(d=><div key={d.id} className="space-y-1">
       <img src={publicUrl(d.image_path)} alt={d.label} className="h-36 w-full rounded border border-border object-contain"/>
       <p className="text-xs">{d.label}</p>
       <Button size="sm" variant="outline" disabled={uploading} onClick={async()=>{
        const {error}=await (supabase as any).from("gift_voucher_designs").update({active:!d.active}).eq("id",d.id);
        if(error)toast.error(error.message);else void load();
       }}>{d.active?"Paslėpti":"Rodyti"}</Button>
      </div>)}
    </div>}
   </div>
  </details>
  {!loading&&rows.length===0&&<p className="text-sm text-muted-foreground">Užklausų dar nėra.</p>}
  <div className="divide-y divide-border/60 border-t border-border/60">
   {rows.map(row=><article key={row.id} className="space-y-3 py-5">
    <div className="flex flex-wrap justify-between gap-2">
     <h3 className="font-semibold">{row.recipient_name} · {SERVICES[row.service_type]||row.service_type}</h3>
     <span className="text-xs text-muted-foreground">{STATE[row.status]||row.status} · {new Date(row.created_at).toLocaleDateString("lt-LT")}</span>
    </div>
    <p className="text-sm"><strong>Kaina:</strong> {row.quoted_price_eur===null?"derinama":row.quoted_price_eur+" €"}</p>
    <p className="text-sm"><strong>Pirkėjas:</strong> {row.buyer_name} · <a className="underline" href={`mailto:${row.buyer_email}`}>{row.buyer_email}</a> · {row.buyer_phone}</p>
    <p className="text-sm"><strong>Gavėjas:</strong> {row.recipient_name} · {row.recipient_phone}</p>
    {row.notes&&<p className="text-sm text-muted-foreground">Pastabos: {row.notes}</p>}
    {row.status!=="completed"&&row.status!=="cancelled"&&<>
      {designs.length>0&&<div>
       <label className="text-sm font-medium" htmlFor={"voucher-design-"+row.id}>Kupono dizainas</label>
       <select id={"voucher-design-"+row.id} value={row.design_choice||""} disabled={Boolean(busy)||Boolean(row.delivery_queued_at)}
        onChange={e=>void setDesign(row,e.target.value)}
        className="mt-1 block h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm">
        <option value="">Pasirinkti dizainą</option>
        {designs.filter(d=>d.active).map(d=><option key={d.id} value={d.id}>{d.label}</option>)}
       </select>
      </div>}
      {!row.payment_instructions_sent_at&&<>
       <Textarea value={instructions[row.id]||""} onChange={e=>setInstructions(old=>({...old,[row.id]:e.target.value}))}
         rows={3} placeholder="Įrašykite tikrus mokėjimo rekvizitus ir mokėjimo paskirtį. Klientas atsakydamas į laišką atsiųs pavedimo patvirtinimą."/>
       <Button size="sm" disabled={busy===row.id} onClick={()=>void act(row,"payment")}>Siųsti mokėjimo informaciją</Button>
      </>}
      {row.payment_instructions_sent_at&&!row.payment_confirmed_at&&
       <Button size="sm" variant="outline" disabled={busy===row.id} onClick={()=>void act(row,"confirm")}>Patvirtinti gautą mokėjimą</Button>}
      {row.payment_confirmed_at&&!row.delivery_queued_at&&
       <Button size="sm" disabled={busy===row.id||!row.design_choice} onClick={()=>void act(row,"issue")}>Siųsti kuponą</Button>}
      {row.delivery_queued_at&&<p className="text-sm text-muted-foreground">Kuponas siuntimo eilėje. Būsena pasikeis, kai Gmail patvirtins išsiuntimą.</p>}
      {!row.payment_instructions_sent_at&&<Button variant="ghost" size="sm" onClick={()=>void cancel(row)}>Atšaukti užklausą</Button>}
    </>}
    {row.status==="completed"&&row.issued_at&&<p className="text-sm">Išduotas: {new Date(row.issued_at).toLocaleDateString("lt-LT")}; galioja 12 mėn. nuo išdavimo.</p>}
   </article>)}
  </div>
 </section>;
}
