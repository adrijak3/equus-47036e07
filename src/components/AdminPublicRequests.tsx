import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Copy, ExternalLink, Mail, MessageSquareText } from "lucide-react";
import { sendReservationStatus } from "@/lib/emailjs";

const SERVICE_NAMES: Record<string, string> = {
  mazylio_30: "Mažylio svajonė · 30 min.",
  mazylio_45: "Mažylio svajonė · 45 min.",
  sportine: "Sportinė jojimo treniruotė",
};

const EXPERIENCE_NAMES: Record<string, string> = {
  beginner: "Pradedantysis",
  intermediate: "Vidutiniškai pažengęs",
  advanced: "Pažengęs",
};

const STATUS_LT: Record<string, string> = {
  pending: "Naujas prašymas",
  proposed: "Pasiūlytas laikas",
  approved: "Patvirtinta administracijos",
  accepted: "Klientas priėmė",
  confirmed: "Klientas patvirtino · tvarkaraštyje",
  reschedule: "Klientas prašo kito laiko",
  rejected: "Atmesta",
  cancelled: "Atšaukta",
  completed: "Įvykdyta",
};

// Only closed requests can be cleaned up; active and confirmed registrations stay protected.
const isCleanupEligible = (row: any) =>
  ["rejected", "cancelled", "completed"].includes(row.status);

export function AdminPublicRequests() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");

  const load = async () => {
    const { data, error } = await (supabase as any)
      .from("public_registration_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Nepavyko užkrauti registracijos prašymų");
      return;
    }

    const loadedRows = data ?? [];
    setRows(loadedRows);
    setSelectedIds((current) =>
      new Set(loadedRows.filter((row: any) => isCleanupEligible(row) && current.has(row.id)).map((row: any) => row.id)),
    );
  };

  useEffect(() => {
    void load();
  }, []);

  const notifyStatus = async (
    statusMessage: string,
    reservationDate?: string,
    reservationTime?: string,
  ) => {
    if (!selected) return;
    try {
      await sendReservationStatus({
        customer_email: selected.email,
        customer_name: `${selected.first_name} ${selected.last_name}`.trim(),
        reservation_date: reservationDate ?? selected.proposed_date ?? selected.requested_date ?? "",
        reservation_time: String(
          reservationTime ?? selected.proposed_time ?? selected.requested_time ?? "",
        ).slice(0, 5),
        service_name: SERVICE_NAMES[selected.service_type] ?? "Sportinė jojimo treniruotė",
        customer_link: selected.public_token
          ? `${location.origin}/registracija/${selected.public_token}`
          : location.origin,
        status_message: statusMessage,
      });
    } catch (error) {
      console.error("EmailJS status send failed:", error);
      toast.error("Būsena atnaujinta, bet el. laiško išsiųsti nepavyko.");
    }
  };

  const propose = async () => {
    if (!selected || !date || !time) return;

    const { error } = await (supabase as any).rpc(
      "admin_propose_public_registration_time",
      {
        _request_id: selected.id,
        _date: date,
        _time: time,
        _note: note || null,
      },
    );

    if (error) {
      toast.error(error.message);
    } else {
      await notifyStatus(
        `Administracija pasiūlė laiką: ${date} ${time}.${note ? ` ${note}` : ""}`,
        date,
        time,
      );
      toast.success("Pasiūlymas išsaugotas");
      setSelected(null);
      void load();
    }
  };

  const cleanableRows = rows.filter(isCleanupEligible);
  const selectedCleanableRows = cleanableRows.filter((row) => selectedIds.has(row.id));
  const allCleanableSelected =
    cleanableRows.length > 0 && selectedCleanableRows.length === cleanableRows.length;

  const toggleRowSelection = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllCleanable = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allCleanableSelected) cleanableRows.forEach((row) => next.delete(row.id));
      else cleanableRows.forEach((row) => next.add(row.id));
      return next;
    });
  };

  const deleteSelectedRequests = async () => {
    const ids = selectedCleanableRows.map((row) => row.id);
    if (!ids.length) return;
    if (!window.confirm(
      `Ištrinti ${ids.length} pasirinktus užbaigtus registracijos įrašus? Aktyvios ir patvirtintos registracijos nebus trinamos. Šio veiksmo atšaukti negalima.`,
    )) return;

    setCleaning(true);
    const { data, error } = await (supabase as any).rpc(
      "admin_delete_public_registration_requests",
      { _request_ids: ids },
    );
    setCleaning(false);

    if (error) {
      toast.error(error.message || "Nepavyko ištrinti registracijų");
      return;
    }

    const removed = Number(data ?? ids.length);
    toast.success(`Ištrinta ${removed} registracijos įrašų`);
    setSelectedIds(new Set());
    if (selected && ids.includes(selected.id)) setSelected(null);
    await load();
  };

  const clientUrl = selected?.public_token
    ? `${location.origin}/registracija/${selected.public_token}`
    : "";

  const clientMessage = selected
    ? `Sveiki, ${selected.first_name}!\n\nGavome Jūsų registracijos užklausą į Equus Jojimo Mokyklą.\n\nRegistracijos būseną ir administracijos siūlomą laiką galite peržiūrėti čia:\n${clientUrl}\n\n${selected.service_type === "mazylio_30" ? "Mažylio svajonė 30 min. kaina – 20 €." : "Vienos treniruotės kaina – 35 €."}\n\nPatvirtinus laiką taikomos Equus treniruočių atšaukimo taisyklės.\n\nJeigu turite klausimų, parašykite mums.\n\nSu pagarba,\nEquus Jojimo Mokykla`
    : "";

  const copyText = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(success);
    } catch {
      toast.error("Nepavyko nukopijuoti");
    }
  };

  const decide = async (status: string) => {
    if (!selected) return;

    const { error } = await (supabase as any).rpc(
      "admin_set_public_registration_status",
      {
        _request_id: selected.id,
        _status: status,
        _note: note || null,
      },
    );

    if (error) {
      toast.error(error.message);
    } else {
      await notifyStatus(
        status === "approved"
          ? `Jūsų registracija patvirtinta.${note ? ` ${note}` : ""}`
          : `Jūsų registracija atšaukta.${note ? ` ${note}` : ""}`,
      );
      toast.success("Būsena atnaujinta");
      setSelected(null);
      void load();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={toggleAllCleanable}
          disabled={cleanableRows.length === 0 || cleaning}
        >
          {allCleanableSelected ? "Atžymėti užbaigtas" : "Pažymėti užbaigtas"} ({cleanableRows.length})
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => void deleteSelectedRequests()}
          disabled={selectedCleanableRows.length === 0 || cleaning}
        >
          {cleaning ? "Trinama…" : `Ištrinti pasirinktus (${selectedCleanableRows.length})`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Galima išvalyti tik atmestas, atšauktas ar įvykdytas registracijas. Aktyvios ir patvirtintos lieka.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Registracijos prašymų nėra.</p>
      ) : (
        rows.map((row) => {
          const canClean = isCleanupEligible(row);
          return (
            <div
              key={row.id}
              className="flex items-stretch gap-2 rounded-xl border border-gold/15 bg-gradient-card"
            >
              <label
                className={`flex items-start p-4 ${canClean ? "cursor-pointer" : "cursor-not-allowed opacity-35"}`}
                title={canClean ? "Pažymėti ištrynimui" : "Aktyvios ir patvirtintos registracijos nešalinamos"}
              >
                <input
                  type="checkbox"
                  checked={canClean && selectedIds.has(row.id)}
                  disabled={!canClean || cleaning}
                  onChange={(event) => toggleRowSelection(row.id, event.target.checked)}
                  aria-label={`Pažymėti ${row.first_name} ${row.last_name} registraciją ištrynimui`}
                  className="mt-1 h-4 w-4 accent-[hsl(var(--gold))]"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setSelected(row);
                  setDate(row.proposed_date || row.requested_date || "");
                  setTime(
                    String(row.proposed_time || row.requested_time || "").slice(
                      0,
                      5,
                    ),
                  );
                  setNote(row.admin_note || "");
                }}
                className="min-w-0 flex-1 py-4 pr-4 text-left"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {row.first_name} {row.last_name}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {SERVICE_NAMES[row.service_type] ?? "Sportinė jojimo treniruotė"}
                      {row.service_type === "sportine" &&
                        ` · ${EXPERIENCE_NAMES[row.experience_level] ?? row.experience_level}`}
                      {` · ${row.phone} · ${row.email}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-gold">
                    {STATUS_LT[row.status] ?? row.status}
                  </span>
                </div>
              </button>
            </div>
          );
        })
      )}

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registracijos prašymas</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="space-y-1 rounded-xl bg-muted/30 p-4 text-sm">
                <p>
                  <b>
                    {selected.first_name} {selected.last_name}
                  </b>
                  , {selected.age} m.
                </p>
                <p>
                  {selected.phone} · {selected.email}
                </p>
                <p>
                  <b>Užsiėmimas:</b>{" "}
                  {SERVICE_NAMES[selected.service_type] ??
                    "Sportinė jojimo treniruotė"}
                </p>
                <p>
                  <b>Trukmė:</b> {selected.duration_minutes ?? 45} min.
                </p>
                <p>
                  <b>Kaina:</b> {selected.price_eur ?? 35} €
                </p>
                {selected.service_type === "sportine" && (
                  <p>
                    <b>Patirtis:</b>{" "}
                    {EXPERIENCE_NAMES[selected.experience_level] ??
                      selected.experience_level}
                  </p>
                )}
                <p>
                  {selected.experience_notes || "Papildomų pastabų nėra"}
                </p>
                <p>
                  <b>Skubus kontaktas:</b> {selected.emergency_contact}
                </p>
                <p>
                  <b>Facebook:</b> {selected.facebook_name || "—"}
                </p>
                <p>
                  <b>Pageidavimai:</b> {selected.preferred_times || "—"}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
                <Input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>

              <Textarea
                placeholder="Žinutė klientui"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />

              <div className="grid gap-2 sm:grid-cols-3">
                <Button variant="gold" onClick={propose}>
                  Pasiūlyti laiką
                </Button>
                <Button variant="outline" onClick={() => decide("approved")}>
                  Patvirtinti
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => decide("rejected")}
                >
                  Atmesti
                </Button>
              </div>

              {selected.public_token && (
                <div className="space-y-3 rounded-2xl border border-gold/15 bg-background/35 p-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Kliento nuoroda
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Input value={clientUrl} readOnly className="min-w-0" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Kopijuoti nuorodą"
                        onClick={() => copyText(clientUrl, "Nuoroda nukopijuota")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => window.open(clientUrl, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Atidaryti kliento puslapį
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => copyText(clientUrl, "Nuoroda nukopijuota")}
                    >
                      <Copy className="h-4 w-4" />
                      Kopijuoti nuorodą
                    </Button>
                  </div>

                  <div className="rounded-xl border border-border bg-card/60 p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <MessageSquareText className="h-4 w-4 text-gold" />
                      Paruošta žinutė klientui
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-muted-foreground">
                      {clientMessage}
                    </pre>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="gold"
                        onClick={() => copyText(clientMessage, "Žinutė nukopijuota")}
                      >
                        <Copy className="h-4 w-4" />
                        Kopijuoti žinutę
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const subject = encodeURIComponent("Equus registracijos užklausa");
                          const body = encodeURIComponent(clientMessage);
                          window.location.href = `mailto:${selected.email}?subject=${subject}&body=${body}`;
                        }}
                      >
                        <Mail className="h-4 w-4" />
                        Siųsti el. paštu
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
