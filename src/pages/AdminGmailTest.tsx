import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export default function AdminGmailTest() {
  const { user, isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const sendTest = async () => {
    if (busy || !isAdmin) return;
    setBusy(true);
    setResult(null);
    setSuccess(false);
    try {
      const { data, error } = await supabase.functions.invoke("admin-test-gmail", { body: {} });
      if (error || !data?.ok) {
        const detail = data?.error || error?.message || "Nepavyko išsiųsti bandomojo laiško.";
        setResult(String(detail));
      } else {
        setSuccess(true);
        setResult("Google priėmė bandomąjį laišką. Patikrinkite pašto dėžutę ir šlamšto aplanką.");
      }
    } catch {
      setResult("Nepavyko susisiekti su el. pašto sistema.");
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) return <div className="mx-auto max-w-xl p-6">Prieiga tik administratoriui.</div>;

  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <a href="/admin" className="text-sm underline underline-offset-4">← Grįžti į administravimą</a>
      <div className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Gmail patikrinimas</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Vienas bandomasis laiškas bus išsiųstas tik į jūsų administratoriaus paskyros el. paštą:
        </p>
        <p className="mt-2 break-all font-medium">{user?.email || "—"}</p>
        <button type="button" onClick={sendTest} disabled={busy || !user?.email}
          className="mt-6 rounded-xl bg-primary px-5 py-3 font-medium text-primary-foreground disabled:opacity-50">
          {busy ? "Siunčiama..." : "Siųsti bandomąjį laišką"}
        </button>
        {result && <p role="status" className={`mt-4 text-sm ${success ? "text-green-700" : "text-red-600"}`}>{result}</p>}
        <p className="mt-4 text-xs text-muted-foreground">
          Tai nekeičia abonementų, rezervacijų ar anksčiau nepavykusių laiškų.
        </p>
      </div>
    </main>
  );
}
