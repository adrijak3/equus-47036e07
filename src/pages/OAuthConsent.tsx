import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Trūksta authorization_id");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await (supabase.auth as any).oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const oauth = (supabase.auth as any).oauth;
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      return setError("Autorizacijos serveris negrąžino nuorodos.");
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md p-8 text-center text-foreground">
        <h1 className="font-display text-xl mb-2">Nepavyko</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </main>
    );
  }

  if (!details) {
    return <main className="mx-auto max-w-md p-8 text-center text-muted-foreground">Kraunama…</main>;
  }

  const clientName = details.client?.name ?? "programa";

  return (
    <main className="mx-auto max-w-md p-8 text-foreground">
      <h1 className="font-display text-2xl mb-3">Prijungti „{clientName}“ prie jūsų paskyros</h1>
      <p className="text-sm text-muted-foreground mb-6">
        „{clientName}“ galės matyti jūsų Equus duomenis (treniruotes, abonementus, profilį) jūsų vardu.
      </p>
      <div className="flex gap-3">
        <Button disabled={busy} onClick={() => decide(true)}>
          Patvirtinti
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
          Atšaukti
        </Button>
      </div>
    </main>
  );
}
