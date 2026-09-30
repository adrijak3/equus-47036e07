import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authentication" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !anonKey || !resendApiKey) {
      console.error("Missing server configuration");
      return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace(/^Bearer\s+/, "");
    const { data: claimsData, error: claimsError } =
      await userClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims?.sub) {
      return json({ error: "Unauthorized" }, 401);
    }

    const callerId = claimsData.claims.sub as string;

    const { data: isAdmin, error: roleError } =
      await userClient.rpc("has_role", {
        _user_id: callerId,
        _role: "admin",
      });

    if (roleError) {
      console.error("Role check failed:", roleError.message);
      return json({ error: "ROLE_CHECK_FAILED" }, 500);
    }

    if (!isAdmin) {
      return json({ error: "ADMIN_REQUIRED" }, 403);
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Equus Jojimo Mokykla <onboarding@resend.dev>",
        to: ["delivered@resend.dev"],
        subject: "Equus – Resend test",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h1>🐎 Equus</h1>
            <p>Resend email integration is working.</p>
            <p>This is a technical test email.</p>
          </div>
        `,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend error:", resendData);
      return json({ error: "RESEND_FAILED", details: resendData }, 502);
    }

    console.log("Resend test email accepted:", resendData?.id);

    return json({
      ok: true,
      message_id: resendData?.id ?? null,
    });
  } catch (error) {
    console.error("send-test-resend-email failed:", error);
    return json({ error: "INTERNAL_ERROR" }, 500);
  }
});
