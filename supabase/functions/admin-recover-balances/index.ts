import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"https://equusjm.pages.dev","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const result=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
function escapeHtml(v:unknown){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
function mime64(s:string){const bytes=new TextEncoder().encode(s);let str="";for(const byte of bytes)str+=String.fromCharCode(byte);return btoa(str).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");}
function dateLt(v:string|null){if(!v)return "Nenurodyta";const d=new Date(v);return Number.isNaN(d.getTime())?"Nenurodyta":new Intl.DateTimeFormat("lt-LT",{day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Vilnius"}).format(d);}
function emailShell(title: string, subtitle: string, inner: string) {
  return `
<!doctype html>
<html lang="lt">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Equus Jojimo Mokykla</title>
<style>
@media only screen and (max-width:620px) {
  .outer { padding:12px !important; }
  .email-card { padding:24px 20px !important; }
  .email-head { padding:26px 20px !important; }
  .email-title { font-size:26px !important; }
  .email-data { font-size:14px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F3F6FB;color:#2C4259;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div class="outer" style="max-width:620px;margin:0 auto;padding:32px 16px;">
  <div style="padding:0 4px 16px;text-align:center;font-size:11px;letter-spacing:3px;font-weight:700;color:#687467;">EQUUS <span style="font-weight:400;letter-spacing:2px;">JOJIMO MOKYKLA</span></div>
  <div style="overflow:hidden;border:1px solid #D4E1EE;border-radius:18px;background:#FFFFFF;">
    <div class="email-head" style="background:#E4EDF7;padding:34px 34px 30px;border-bottom:1px solid #D4E2F0;">
      <img src="https://equusjm.pages.dev/equus-logo-black.png" width="116" height="116" alt="Equus Jojimo Mokykla" style="display:block;width:116px;height:116px;border:0;border-radius:12px;margin:0 0 18px;background:#000000;" />
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#5D7793;margin-bottom:10px;">EQUUS • INFORMACIJA</div>
      <h1 class="email-title" style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:31px;line-height:1.18;letter-spacing:-.5px;color:#213F60;margin:0 0 12px;">${escapeHtml(title)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#536E89;">${escapeHtml(subtitle)}</p>
    </div>
    <div class="email-card" style="padding:32px 34px 28px;background:#FFFFFF;font-size:15px;line-height:1.7;color:#344B63;">
      ${inner}
      <div style="height:1px;background:#E2EAF3;margin:28px 0 18px;"></div>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#647C94;">Klausimai? Mielai padėsime:<br><a href="mailto:equusjojimomokykla@gmail.com" style="font-weight:600;color:#285C8A;text-decoration:underline;">equusjojimomokykla@gmail.com</a></p>
    </div>
  </div>
  <div style="padding:18px 10px 4px;text-align:center;color:#72869B;font-size:12px;line-height:1.7;">Equus Jojimo Mokykla <span style="color:#AABDCF;">•</span> Laiškas iš oficialios Equus sistemos</div>
</div>
</body></html>`;
}


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
   const body = `
     <p style="margin:0 0 8px;font-size:16px;color:#2D4763;">Sveiki, ${greeting}!</p>
     <p style="margin:0 0 22px;color:#5B748C;font-size:14px;line-height:1.8;">Siunčiame atnaujintą Jūsų abonemento informaciją. Tai nėra naujo pirkimo patvirtinimas.</p>
     <div style="background:#E8F1FA;border:1px solid #D9E6F4;border-radius:14px;padding:24px;text-align:center;margin-bottom:22px;">
       <div style="color:#5A7693;font-size:11px;font-weight:700;letter-spacing:2px;">LIKO TRENIRUOČIŲ</div>
       <div style="color:#264C76;font-size:48px;font-family:Georgia,serif;line-height:1.15;margin:8px 0 4px;">${remaining}</div>
       <div style="font-size:13px;color:#637F9C;">${Number(s.lessons_used||0)} panaudota iš ${Number(s.lessons_total)}</div>
     </div>
     <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;color:#344B63;" cellpadding="0" cellspacing="0">
       <tr><td style="padding:10px 0;border-bottom:1px solid #E4EBF3;color:#687D93;">Abonementas</td><td style="padding:10px 0;border-bottom:1px solid #E4EBF3;text-align:right;font-weight:700;">${escapeHtml(kind)}</td></tr>
       <tr><td style="padding:10px 0;border-bottom:1px solid #E4EBF3;color:#687D93;">Pirkimo data</td><td style="padding:10px 0;border-bottom:1px solid #E4EBF3;text-align:right;font-weight:700;">${escapeHtml(dateLt(s.purchase_date))}</td></tr>
       <tr><td style="padding:10px 0;border-bottom:1px solid #E4EBF3;color:#687D93;">Pirkimo suma</td><td style="padding:10px 0;border-bottom:1px solid #E4EBF3;text-align:right;font-weight:700;">${Number(s.price).toFixed(2)} €</td></tr>
       <tr><td style="padding:10px 0;color:#687D93;">Galioja iki</td><td style="padding:10px 0;text-align:right;font-weight:700;">${escapeHtml(dateLt(s.expires_at))}</td></tr>
     </table>
     <div style="margin-top:26px;text-align:center;">
       <a href="https://equusjm.pages.dev/grafikas" style="display:inline-block;background:#315E8B;color:#FFFFFF;text-decoration:none;padding:14px 25px;border-radius:8px;font-size:14px;font-weight:700;">Peržiūrėti grafiką</a>
     </div>`;
   const html = emailShell("Jūsų abonemento informacija", "Aktualus treniruočių likutis ir galiojimo informacija", body);
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
