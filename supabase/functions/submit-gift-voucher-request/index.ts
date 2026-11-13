import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const respond = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:HEADERS});
const PRICES: Record<string,number|null> = {
  group_single:40, pair_single:45, individual_single:50,
  group_4:150, group_8:280, dream_30:20, dream_45:35, photoshoot:null,
};
const SERVICE_NAMES: Record<string,string> = {
  group_single:"Grupinė jojimo pamoka",
  pair_single:"Jojimo pamoka po 2 (vienam asmeniui)",
  individual_single:"Individuali jojimo pamoka",
  group_4:"4 grupinių treniruočių kuponas",
  group_8:"8 grupinių treniruočių kuponas",
  dream_30:"Mažylio svajonė – 30 min.",
  dream_45:"Mažylio svajonė – 45 min.",
  photoshoot:"Fotosesija su žirgu",
};
const hash = async (value:string) => {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
};
Deno.serve(async (request:Request) => {
  if(request.method==="OPTIONS") return new Response("ok",{headers:HEADERS});
  if(request.method!=="POST") return respond({error:"METHOD_NOT_ALLOWED"},405);
  if(Number(request.headers.get("content-length")||0)>14000) return respond({error:"TOO_LARGE"},413);
  const url=Deno.env.get("SUPABASE_URL");
  const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !secret) return respond({error:"SERVER_CONFIGURATION_ERROR"},500);
  let form:Record<string,unknown>;
  try { form=await request.json(); } catch { return respond({error:"INVALID_JSON"},400); }
  const read=(key:string,max=150) => typeof form[key]==="string" ? String(form[key]).trim().slice(0,max+1) : "";
  const buyerName=read("buyerName");
  const buyerEmail=read("buyerEmail",254).toLowerCase();
  const buyerPhone=read("buyerPhone",30);
  const recipientName=read("recipientName");
  const recipientPhone=read("recipientPhone",30);
  const service=read("service",60);
  const notes=read("notes",1500);
  const trap=read("website",100);
  if(trap) return respond({ok:true});
  if(!(service in PRICES) ||
     buyerName.length<2 || buyerName.length>150 ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail) ||
     !/^[+0-9() .-]{6,30}$/.test(buyerPhone) ||
     recipientName.length<2 || recipientName.length>150 ||
     !/^[+0-9() .-]{6,30}$/.test(recipientPhone) || notes.length>1500) {
    return respond({error:"INVALID_FIELDS"},400);
  }
  const captchaSecret=Deno.env.get("TURNSTILE_SECRET_KEY")||Deno.env.get("CLOUDFLARE_TURNSTILE_SECRET");
  if(captchaSecret) {
    const token=read("captchaToken",2100);
    if(!token) return respond({error:"CAPTCHA_REQUIRED"},400);
    const verification=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({secret:captchaSecret,response:token}),
    });
    const verdict=await verification.json().catch(()=>null);
    if(!verification.ok || !verdict?.success) return respond({error:"CAPTCHA_FAILED"},403);
  }
  const db=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const ip=request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for")||"").split(",")[0].trim() || "unknown";
  const ipHash=await hash(secret+":voucher:"+ip);
  const emailHash=await hash(secret+":voucher:"+buyerEmail);
  const [ipLimit,emailLimit]=await Promise.all([
    db.rpc("consume_equus_rate_limit",{_bucket:"gift-voucher-ip",_key_hash:ipHash,_max_attempts:5,_window_seconds:3600}),
    db.rpc("consume_equus_rate_limit",{_bucket:"gift-voucher-email",_key_hash:emailHash,_max_attempts:3,_window_seconds:3600}),
  ]);
  if(ipLimit.error || emailLimit.error) return respond({error:"RATE_LIMIT_UNAVAILABLE"},503);
  if(ipLimit.data!==true || emailLimit.data!==true) return respond({error:"TOO_MANY_REQUESTS"},429);
  const {data:created,error:insertError}=await db.from("gift_voucher_requests").insert({
    buyer_name:buyerName,buyer_email:buyerEmail,buyer_phone:buyerPhone,
    recipient_name:recipientName,recipient_phone:recipientPhone,service_type:service,
    quoted_price_eur:PRICES[service],notes:notes||null,status:"new",
  }).select("id").single();
  if(insertError || !created) {
    console.error("Gift request insertion failed:",insertError?.code);
    return respond({error:"SAVE_FAILED"},500);
  }
  const payload={
    buyer_name:buyerName,buyer_phone:buyerPhone,recipient_name:recipientName,
    recipient_phone:recipientPhone,service_label:SERVICE_NAMES[service],
    price_eur:PRICES[service],notes:notes||null,
  };
  // Both messages are acknowledgements, not voucher issuance or proof of payment.
  const {error:queueError}=await db.from("email_events").insert([
    {event_key:"gift-buyer-"+created.id,event_type:"gift_voucher_received",
      email:buyerEmail,payload,status:"pending"},
    {event_key:"gift-admin-"+created.id,event_type:"gift_voucher_admin",
      email:Deno.env.get("GIFT_ADMIN_EMAIL")||"equusjojimomokykla@gmail.com",
      payload:{...payload,buyer_email:buyerEmail},status:"pending"},
  ]);
  if(queueError) console.error("Gift email queue failed:",queueError.code);
  return respond({ok:true,requestId:created.id,emailQueued:!queueError});
});
