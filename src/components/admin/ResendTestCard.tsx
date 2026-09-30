import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MailCheck, MailX, Loader2 } from "lucide-react";

export function ResendTestCard() {
  const [sending, setSending] = useState(false);

  const sendTestEmail = async () => {
    if (!confirm("Siųsti bandomąjį Resend el. laišką?")) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-test-resend-email", {
        body: {},
      });

      if (error) {
        let detail = error.message;
        try {
          const response = (error as any).context;
          if (response?.json) {
            const payload = await response.json();
            detail = payload?.error || payload?.message || detail;
          }
        } catch {
          // Keep the function error if the response body is unavailable.
        }
        toast.error(detail || "Nepavyko išsiųsti bandomojo el. laiško.");
        return;
      }

      if (!data?.ok) {
        toast.error(data?.error || "Nepavyko išsiųsti bandomojo el. laiško.");
        return;
      }

      toast.success("Resend priėmė bandomąjį el. laišką.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border border-gold/15 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MailCheck className="w-5 h-5 text-gold" />
        <h3 className="font-display text-xl">📧 Resend el. laiško testas</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Laikinas administratoriaus testas. Laiškas siunčiamas į Resend testinį gavėją
        <span className="font-mono"> delivered@resend.dev</span>.
      </p>
      <Button variant="gold" disabled={sending} onClick={sendTestEmail}>
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
        {sending ? "Siunčiama…" : "Siųsti Resend testą"}
      </Button>
    </div>
  );
}
