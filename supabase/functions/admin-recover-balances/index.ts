import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"https://equusjm.pages.dev","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const result=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
function escapeHtml(v:unknown){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function mime64(s:string){const bytes=new TextEncoder().encode(s);let str="";for(const byte of bytes)str+=String.fromCharCode(byte);return btoa(str).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
function dateLt(v:string|null){if(!v)return "Nenurodyta";const d=new Date(v);return Number.isNaN(d.getTime())?"Nenurodyta":new Intl.DateTimeFormat("lt-LT",{day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Vilnius"}).format(d);}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return result({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId=Deno.env.get("GOOGLE_CLIENT_ID"),clientSecret=Deno.env.get("GOOGLE_CLIENT_SECRET"),refresh=Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if(!url||!anon||!service||!clientId||!clientSecret||!refresh)return result({error:"CONFIGURATION_MISSING"},500);
  const jwt=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return result({error:"UNAUTHORIZED"},401);
  const auth=createClient(url,anon);
  const {data:{user},error:authError}=await auth.auth.getUser(jwt);
  if(authError||!user)return result({error:"UNAUTHORIZED"},401);
  const db=createClient(url,service);
  const {data:isAdmin,error:roleError}=await db.rpc("has_role",{_user_id:user.id,_role:"admin"});
  if(roleError||isAdmin!==true)return result({error:"ADMIN_REQUIRED"},403);
  const {data:events,error:eventsError}=await db.from("email_events")
    .select("id,event_type,user_id,email,subscription_id,created_at")
    .eq("status","failed").eq("event_type","subscription_purchase")
    .gte("created_at","2026-10-26T00:00:00Z").order("created_at",{ascending:true});
  if(eventsError)return result({error:"LOOKUP_FAILED"},500);
  const candidates=[];
  for(const ev of events||[]){
   const {data:s,error:e}=await db.from("subscriptions")
    .select("id,user_id,lessons_total,lessons_used,price,purchase_date,expires_at,paid,cancelled_at,package_type")
    .eq("id",ev.subscription_id).maybeSingle();
   if(e)return result({error:"SUBSCRIPTION_LOOKUP_FAILED"},500);
   if(s&&s.paid===true&&!s.cancelled_at&&s.expires_at&&new Date(s.expires_at).getTime()>=Date.now()&&s.user_id===ev.user_id)
     candidates.push({ev,s});
  }
  if(candidates.length!==10)return result({error:"CANDIDATE_SET_CHANGED",expected:10,found:candidates.length},409);
  const oauth=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:"refresh_token"})});
  const token=await oauth.json();
  if(!oauth.ok||!token.access_token)return result({error:"GMAIL_AUTH_FAILED"},502);
  const from=Deno.env.get("GMAIL_FROM_EMAIL")||"Equus Jojimo Mokykla <equusjojimomokykla@gmail.com>";
  const sent=[];const skipped=[];const failed=[];
  for(const {ev,s} of candidates){
   const key="balance_recovery_2026_11_06_"+s.id;
   const {error:reserveError}=await db.from("email_events").insert({
      event_key:key,event_type:"subscription_balance_recovery",user_id:ev.user_id,email:ev.email,
      subscription_id:s.id,status:"skipped",attempts:0,payload:{source_failed_event_id:ev.id,requested_by:user.id}
   });
   if(reserveError){if(reserveError.code==="23505"){skipped.push(s.id);continue;}failed.push({id:s.id,error:"RESERVATION_FAILED"});break;}
   let destination=String(ev.email||"");
   const {data:authUser}=await db.auth.admin.getUserById(ev.user_id);
   if(authUser?.user?.email)destination=authUser.user.email;
   if(!destination){failed.push({id:s.id,error:"RECIPIENT_MISSING"});break;}
   const {data:profile}=await db.from("profiles").select("full_name").eq("id",ev.user_id).maybeSingle();
   const greeting=escapeHtml(profile?.full_name||"Kliente");
   const remaining=Math.max(0,Number(s.lessons_total)-Number(s.lessons_used||0));
   const kind=s.package_type==="po2"?"Pamokos po du":s.package_type==="group"?"Grupinės pamokos":String(s.package_type||"Abonementas");
   const html=`<!doctype html><html lang="lt"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;background:#f5f2ec;color:#35342e;padding:24px"><div style="max-width:560px;margin:auto;background:white;padding:24px;border-radius:16px"><p style="font-size:12px;letter-spacing:2px">EQUUS JOJIMO MOKYKLA</p><h1>Jūsų abonemento informacija</h1><p>Sveiki, ${greeting}!</p><p>Siunčiame atnaujintą Jūsų abonemento informaciją. Šis laiškas nėra naujo pirkimo patvirtinimas.</p><p><b>Įsigyta:</b> ${escapeHtml(dateLt(s.purchase_date))}</p><p><b>Tipas:</b> ${escapeHtml(kind)}</p><p><b>Pirkimo suma:</b> ${Number(s.price).toFixed(2)} €</p><p><b>Iš viso treniruočių:</b> ${Number(s.lessons_total)}</p><p><b>Panaudota:</b> ${Number(s.lessons_used||0)}</p><p><b>Liko:</b> ${remaining}</p><p><b>Galioja iki:</b> ${escapeHtml(dateLt(s.expires_at))}</p><p>Aktualų grafiką ir rezervacijas rasite <a href="https://equusjm.pages.dev/grafikas">Equus sistemoje</a>.</p><p>Jei kyla klausimų, parašykite equusjojimomokykla@gmail.com.</p></div></body></html>`;
   const subject="Equus – atnaujinta abonemento informacija";
   const encodedSubject="=?UTF-8?B?"+btoa(String.fromCharCode(...new TextEncoder().encode(subject)))+"?=";
   const mime=[`From: ${from}`,`To: ${destination}`,`Subject: ${encodedSubject}`,"MIME-Version: 1.0","Content-Type: text/html; charset=UTF-8","",html].join("\r\n");
   const resp=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${token.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({raw:mime64(mime)})});
   const responseData=await resp.json().catch(()=>({}));
   if(!resp.ok){await db.from("email_events").update({status:"failed",last_error:`Gmail send failed HTTP ${resp.status}`}).eq("event_key",key);failed.push({id:s.id,error:"GMAIL_SEND_FAILED"});break;}
   await db.from("email_events").update({status:"sent",sent_at:new Date().toISOString(),resend_message_id:responseData.id||null}).eq("event_key",key);
   sent.push(s.id);
  }
  return result({ok:failed.length===0,sent_count:sent.length,skipped_count:skipped.length,failed_count:failed.length,remaining_action:failed.length?"CHECK_LOGS":"NONE"},failed.length?207:200);
 }catch(err){console.error("Balance recovery error:",err instanceof Error?err.message:"unknown");return result({error:"INTERNAL_ERROR"},500);}
});
