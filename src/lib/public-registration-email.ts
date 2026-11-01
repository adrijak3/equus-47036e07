import { supabase } from "@/integrations/supabase/client";

export async function sendPublicRegistrationEmail(
  requestId: string,
  action: "received" | "status",
  publicToken?: string,
) {
  const { data, error } = await supabase.functions.invoke("send-public-registration-email", {
    body: { request_id: requestId, action, ...(publicToken ? { public_token: publicToken } : {}) },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "Nepavyko išsiųsti el. laiško.");
  return data;
}
