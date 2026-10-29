import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bug, Check, Clipboard, RefreshCw } from "lucide-react";

type BugReport = {
  id: string;
  fingerprint: string;
  error_name: string;
  error_message: string;
  error_code: string | null;
  page_path: string;
  stack_trace: string | null;
  occurrence_count: number;
  user_id: string | null;
  user_agent: string | null;
  status: string;
  created_at: string;
};

export function AdminBugReports() {
  const [rows, setRows] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("bug_reports")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error("Nepavyko įkelti klaidų pranešimų: " + error.message);
      return;
    }
    setRows(data ?? []);
  };

  useEffect(() => { void load(); }, []);

  const setStatus = async (id: string, status: string) => {
    const { error } = await (supabase as any).from("bug_reports").update({ status }).eq("id", id);
    if (error) toast.error("Nepavyko pakeisti būsenos: " + error.message);
    else {
      toast.success("Klaidos būsena atnaujinta");
      await load();
    }
  };

  const copyReport = async (row: BugReport) => {
    const report = [
      "EQUUS KLAIDOS PRANEŠIMAS",
      "ID: " + row.id,
      "Data: " + new Date(row.created_at).toLocaleString("lt-LT"),
      "Būsena: " + row.status,
      "Klaida: " + row.error_name,
      "Klaidos kodas: " + (row.error_code || "nenurodytas"),
      "Puslapis: " + row.page_path,
      "Pasikartojimai: " + row.occurrence_count,
      "Naudotojo ID: " + (row.user_id || "neprisijungęs"),
      "Įrenginys / naršyklė: " + (row.user_agent || "nenurodyta"),
      "Pranešimas: " + row.error_message,
      "Techninė informacija:\n" + (row.stack_trace || "Nėra"),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      toast.success("Klaidos informacija nukopijuota");
    } catch {
      toast.error("Nepavyko nukopijuoti klaidos informacijos");
    }
  };

  const openCount = rows.filter((row) => row.status !== "resolved").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Automatiškai pateikti techninių klaidų pranešimai.</p>
          <p className="mt-1 text-sm">Neišspręsta: <b>{openCount}</b> · Iš viso: <b>{rows.length}</b></p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Atnaujinti</Button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Kraunama...</p> : rows.length === 0 ? (
        <div className="rounded-xl border border-gold/15 p-6 text-center text-sm text-muted-foreground">
          <Bug className="mx-auto mb-2 h-6 w-6" /> Pranešimų apie klaidas dar nėra.
        </div>
      ) : rows.map((row) => (
        <article key={row.id} className="space-y-3 rounded-xl border border-gold/15 bg-gradient-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{row.error_name}{row.error_code ? " · " + row.error_code : ""}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString("lt-LT")} · {row.page_path}</p>
            </div>
            <span className="rounded-full border border-gold/20 px-2 py-1 text-xs">{row.status === "resolved" ? "Išspręsta" : row.status === "investigating" ? "Tiriama" : "Nauja"}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{row.error_message}</p>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <p>Pasikartojimai: {row.occurrence_count}</p>
            <p>Naudotojo ID: {row.user_id || "Neprisijungęs"}</p>
            <p className="sm:col-span-2 break-all">Įrenginys: {row.user_agent || "Nenurodyta"}</p>
          </div>
          {row.stack_trace && (
            <details className="rounded-lg bg-background/50 p-3">
              <summary className="cursor-pointer text-sm">Techninė informacija</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{row.stack_trace}</pre>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyReport(row)}><Clipboard className="mr-1 h-4 w-4" /> Kopijuoti pranešimą</Button>
            <Button size="sm" variant="outline" onClick={() => void setStatus(row.id, "investigating")}>Tiriama</Button>
            <Button size="sm" variant="gold" onClick={() => void setStatus(row.id, "resolved")}><Check className="mr-1 h-4 w-4" /> Išspręsta</Button>
          </div>
        </article>
      ))}
    </div>
  );
}
