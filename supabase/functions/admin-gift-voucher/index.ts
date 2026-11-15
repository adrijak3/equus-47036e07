import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const nameSafe=(name:string)=>name.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,75)||"gavejas";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond({error:"METHOD_NOT_ALLOWED"},405);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),anon=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!service||!anon)return respond({error:"CONFIG_MISSING"},500);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return respond({error:"UNAUTHORIZED"},401);
 const adminDb=createClient(url,service,{auth:{persistSession:false}});
 const {data:identity,error:identityError}=await adminDb.auth.getUser(token);
 if(identityError||!identity.user)return respond({error:"UNAUTHORIZED"},401);
 const {data:admin,error:roleError}=await adminDb.rpc("has_role",{_user_id:identity.user.id,_role:"admin"});
 if(roleError||admin!==true)return respond({error:"ADMIN_ONLY"},403);
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return respond({error:"INVALID_BODY"},400);}
 const requestId=String(body.requestId||""),action=String(body.action||"");
 if(!/^[0-9a-f-]{36}$/i.test(requestId)||!["payment","confirm","issue"].includes(action))return respond({error:"INVALID_ARGUMENTS"},400);
 const {data:r,error:lookupError}=await adminDb.from("gift_voucher_requests").select("*").eq("id",requestId).maybeSingle();
 if(lookupError||!r)return respond({error:"NOT_FOUND"},404);
 if(r.status==="cancelled")return respond({error:"CANCELLED"},409);
 const now=new Date().toISOString();
 if(action==="payment"){
   if(r.payment_instructions_sent_at)return respond({error:"PAYMENT_EMAIL_ALREADY_SENT"},409);
   const instructions=String(body.instructions||"").trim();
   if(instructions.length<15||instructions.length>1800)return respond({error:"PAYMENT_INSTRUCTIONS_REQUIRED"},400);
   const {error}=await adminDb.from("email_events").insert({
     event_key:"gift-payment-"+r.id,event_type:"gift_voucher_payment",
     email:r.buyer_email,payload:{request_id:r.id,buyer_name:r.buyer_name,service_type:r.service_type,
       price_eur:r.quoted_price_eur,payment_instructions:instructions,recipient_name:r.recipient_name},status:"pending"
   });
   if(error)return respond({error:"EMAIL_QUEUE_FAILED",details:error.code},500);
   const {error:upd}=await adminDb.from("gift_voucher_requests").update({payment_instructions_sent_at:now,status:"contacted",updated_at:now}).eq("id",r.id);
   if(upd)return respond({error:"SAVED_EMAIL_BUT_STATUS_FAILED"},500);
   return respond({ok:true,queued:true});
 }
 if(action==="confirm"){
   if(!r.payment_instructions_sent_at)return respond({error:"SEND_PAYMENT_INSTRUCTIONS_FIRST"},409);
   if(r.payment_confirmed_at)return respond({ok:true,alreadyConfirmed:true});
   if(body.confirmPaid!==true)return respond({error:"MANUAL_CONFIRMATION_REQUIRED"},400);
   const {error}=await adminDb.from("gift_voucher_requests").update({payment_confirmed_at:now,updated_at:now}).eq("id",r.id);
   return error?respond({error:"UPDATE_FAILED"},500):respond({ok:true});
 }
 if(!r.payment_confirmed_at)return respond({error:"PAYMENT_NOT_CONFIRMED"},409);
 if(r.delivery_queued_at||r.status==="completed")return respond({error:"VOUCHER_ALREADY_QUEUED"},409);
 if(!r.design_choice)return respond({error:"DESIGN_NOT_SELECTED"},409);
 const {data:design,error:designError}=await adminDb.from("gift_voucher_designs").select("id,label,image_path").eq("id",r.design_choice).eq("active",true).maybeSingle();
 if(designError||!design)return respond({error:"DESIGN_NOT_AVAILABLE"},409);
 const urlToImage=adminDb.storage.from("gift-voucher-designs").getPublicUrl(design.image_path).data.publicUrl;
 const filename="dovanu_kuponas_equus_"+nameSafe(r.recipient_name);
 const {error:queueError}=await adminDb.from("email_events").insert({
   event_key:"gift-issued-"+r.id,event_type:"gift_voucher_issued",
   email:r.buyer_email,payload:{request_id:r.id,buyer_name:r.buyer_name,recipient_name:r.recipient_name,
     service_type:r.service_type,price_eur:r.quoted_price_eur,image_url:urlToImage,image_filename:filename},status:"pending"
 });
 if(queueError)return respond({error:"EMAIL_QUEUE_FAILED",details:queueError.code},500);
 const {error:upd}=await adminDb.from("gift_voucher_requests").update({delivery_queued_at:now,updated_at:now}).eq("id",r.id);
 if(upd)return respond({error:"QUEUED_BUT_STATUS_FAILED"},500);
 return respond({ok:true,queued:true,filename});
});
