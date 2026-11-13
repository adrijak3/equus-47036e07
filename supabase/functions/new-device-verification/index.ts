import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status,headers:cors});
const sha256 = async (value: string) => {
  const b = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
};
const hmac = async (key: string, value: string) => {
  const secret = await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig = await crypto.subtle.sign("HMAC",secret,new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(x=>x.toString(16).padStart(2,"0")).join("");
};
Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return reply({error:"METHOD_NOT_ALLOWED"},405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if(!url || !serviceKey) return reply({error:"SERVER_CONFIGURATION_ERROR"},500);
  const bearer = req.headers.get("authorization") || "";
  const jwt = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  if(!jwt) return reply({error:"UNAUTHORIZED"},401);
  const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") || serviceKey, {auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError} = await authClient.auth.getUser(jwt);
  if(userError || !user?.id) return reply({error:"UNAUTHORIZED"},401);
  const db = createClient(url, serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  let body: {action?:string;deviceToken?:string;code?:string} = {};
  try { body = await req.json(); } catch { return reply({error:"INVALID_JSON"},400); }
  const deviceToken = body.deviceToken || "";
  if(!/^[a-f0-9]{64}$/.test(deviceToken)) return reply({error:"INVALID_DEVICE_TOKEN"},400);
  const deviceHash=await sha256(deviceToken);
  const now=Date.now();
  const {data:device,error:deviceError}=await db.from("equus_trusted_devices").select("id,expires_at,revoked_at").eq("user_id",user.id).eq("device_hash",deviceHash).maybeSingle();
  if(deviceError) return reply({error:"DEVICE_LOOKUP_FAILED"},500);
  const trusted=!!device && !device.revoked_at && new Date(device.expires_at).getTime()>now;
  if(body.action==="status") return reply({trusted});
  if(body.action==="revoke") {
    await db.from("equus_trusted_devices").update({revoked_at:new Date().toISOString()}).eq("user_id",user.id).eq("device_hash",deviceHash);
    return reply({ok:true});
  }
  if(trusted) return reply({ok:true,trusted:true});
  if(body.action==="send") {
    if(!user.email) return reply({error:"NO_EMAIL"},400);
    const {data:recent,error:recentError}=await db.from("equus_device_challenges").select("created_at").eq("user_id",user.id).gte("created_at",new Date(now-3600000).toISOString()).order("created_at",{ascending:false}).limit(4);
    if(recentError) return reply({error:"RATE_CHECK_FAILED"},500);
    if((recent?.length||0)>=3) return reply({error:"TOO_MANY_REQUESTS"},429);
    if(recent?.[0] && now-new Date(recent[0].created_at).getTime()<90000) return reply({error:"WAIT_BEFORE_RESEND"},429);
    const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);
    const code=String(bytes[0]%1000000).padStart(6,"0");
    const codeHash=await hmac(serviceKey, user.id+":"+deviceHash+":"+code);
    const {data:challenge,error:insertError}=await db.from("equus_device_challenges").insert({
      user_id:user.id,device_hash:deviceHash,code_hash:codeHash,expires_at:new Date(now+20*60000).toISOString()
    }).select("id").single();
    if(insertError || !challenge) return reply({error:"CHALLENGE_CREATION_FAILED"},500);
    const {error:queueError}=await db.from("email_events").insert({
      event_key:"new-device-"+challenge.id,event_type:"new_device_login",user_id:user.id,email:user.email,
      payload:{code,expires_minutes:20},status:"pending"
    });
    if(queueError) {
      await db.from("equus_device_challenges").delete().eq("id",challenge.id);
      return reply({error:"EMAIL_QUEUE_FAILED"},500);
    }
    return reply({ok:true,queued:true,expires_minutes:20});
  }
  if(body.action==="verify") {
    const code=String(body.code||"");
    if(!/^\d{6}$/.test(code)) return reply({error:"INVALID_CODE"},400);
    // Multiple valid codes may still be in flight because email is queued.
    // Accept any unused, unexpired challenge for THIS user + THIS device,
    // not only the newest one. Limit attempts across the whole set.
    const {data:challenges,error:challengeError}=await db.from("equus_device_challenges")
      .select("id,code_hash,attempts,expires_at,consumed_at")
      .eq("user_id",user.id).eq("device_hash",deviceHash)
      .gt("expires_at",new Date(now).toISOString())
      .is("consumed_at",null).order("created_at",{ascending:false}).limit(5);
    if(challengeError || !challenges?.length) return reply({error:"EXPIRED_OR_LOCKED"},400);
    const newest=challenges[0];
    if(newest.attempts>=5) return reply({error:"EXPIRED_OR_LOCKED"},400);
    const {data:incremented,error:attemptError}=await db.from("equus_device_challenges")
      .update({attempts:newest.attempts+1}).eq("id",newest.id)
      .eq("attempts",newest.attempts).is("consumed_at",null).select("id").maybeSingle();
    if(attemptError || !incremented) return reply({error:"RETRY"},409);
    const actual=await hmac(serviceKey,user.id+":"+deviceHash+":"+code);
    if(!challenges.some(ch=>ch.code_hash===actual)) return reply({error:"INVALID_CODE"},400);
    const {error:trustError}=await db.from("equus_trusted_devices").upsert({
      user_id:user.id,device_hash:deviceHash,created_at:new Date().toISOString(),
      last_seen_at:new Date().toISOString(),
      expires_at:new Date(now+180*86400000).toISOString(),revoked_at:null
    },{onConflict:"user_id,device_hash"});
    if(trustError) return reply({error:"TRUST_SAVE_FAILED"},500);
    // Invalidate ALL outstanding codes after successful verification.
    await db.from("equus_device_challenges").update({consumed_at:new Date().toISOString()})
      .eq("user_id",user.id).eq("device_hash",deviceHash).is("consumed_at",null);
    return reply({ok:true,trusted:true});
  }
  return reply({error:"INVALID_ACTION"},400);
});
