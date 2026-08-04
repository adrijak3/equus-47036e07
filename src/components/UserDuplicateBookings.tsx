import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

type PossibleDuplicate = {
  suspect_booking_id: string;
  slot_date: string;
  suspect_time: string;
  permanent_time: string;
  proper_booking_id: string;
};

function shortTime(value: string) {
  return String(value).slice(0, 5);
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("lt-LT", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function UserDuplicateBookings({ userId }: { userId: string }) {
  const [rows, setRows] = useState<PossibleDuplicate[]>([]);
  const [chosen, setChosen] = useState<PossibleDuplicate | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error } = await (supabase as any).rpc(
      "get_possible_duplicate_bookings",
      { _user_id: userId },
    );

    if (error) {
      console.error("Duplicate booking check failed:", error);
      toast.error("Nepavyko patikrinti galimų pasikartojančių laikų.");
      setRows([]);
    } else {
      setRows((data ?? []) as PossibleDuplicate[]);
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedDates = useMemo(
    () => new Set(rows.map((row) => row.slot_date)).size,
    [rows],
  );

  const cancelOne = async (row: PossibleDuplicate) => {
    setBusyId(row.suspect_booking_id);

    const { data, error } = await (supabase as any).rpc(
      "cancel_possible_duplicate_booking",
      { _booking_id: row.suspect_booking_id },
    );

    if (error || data?.ok === false) {
      toast.error(error?.message || data?.message || "Nepavyko pašalinti rezervacijos.");
    } else {
      toast.success(`${shortTime(row.suspect_time)} rezervacija pašalinta.`);
      setChosen(null);
      await load();
    }

    setBusyId(null);
  };

  const cancelAll = async () => {
    setBulkBusy(true);

    const { data, error } = await (supabase as any).rpc(
      "cancel_all_possible_duplicate_bookings",
      { _user_id: userId },
    );

    if (error || data?.ok === false) {
      toast.error(error?.message || data?.message || "Nepavyko pašalinti senesnių laikų.");
    } else {
      const removed = Number(data?.removed_count ?? 0);
      toast.success(
        removed === 1
          ? "Pašalinta 1 sena rezervacija."
          : `Pašalintos ${removed} senos rezervacijos.`,
      );
      setShowBulkConfirm(false);
      await load();
    }

    setBulkBusy(false);
  };

  return (
    <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-500/10 p-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Galimi pasikartojantys ateities treniruočių laikai
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Nieko nešaliname automatiškai. Kiekvieną atvejį galite peržiūrėti ir nuspręsti patys.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/30 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Tikrinami ateities laikai…
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
          <div>
            <p className="font-medium text-foreground">Pasikartojančių laikų nerasta</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Šiuo metu visi būsimi laikai atrodo tvarkingi.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {rows.map((row) => (
              <article
                key={row.suspect_booking_id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium capitalize text-foreground">
                    {formatDate(row.slot_date)}
                  </div>
                  <div className="mt-2 grid gap-1.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gold" />
                      <span>
                        Dabartinis nuolatinis laikas: {shortTime(row.permanent_time)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span>
                        Galimas senas laikas: {shortTime(row.suspect_time)}
                      </span>
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setChosen(row)}
                >
                  Peržiūrėti
                </Button>
              </article>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-foreground">
                  Pašalinti visus galimus senesnius laikus
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Bus pašalintos tik aukščiau parodytos {rows.length} galimos senos rezervacijos per {groupedDates} datas. Dabartiniai nuolatiniai laikai liks.
                </p>
              </div>

              <Button
                variant="destructive"
                className="w-full flex-shrink-0 sm:w-auto"
                onClick={() => setShowBulkConfirm(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Pašalinti visus senesnius laikus
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={!!chosen} onOpenChange={(open) => !open && setChosen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Peržiūrėti galimą pasikartojimą</DialogTitle>
            <DialogDescription>
              Niekas nebus pakeista, kol nepasirinksite pašalinimo mygtuko.
            </DialogDescription>
          </DialogHeader>

          {chosen && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
                <p className="font-medium capitalize text-foreground">
                  {formatDate(chosen.slot_date)}
                </p>
                <p className="mt-3 text-muted-foreground">
                  Dabartinis nuolatinis laikas: <strong className="text-foreground">{shortTime(chosen.permanent_time)}</strong>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Galimas senas laikas: <strong className="text-foreground">{shortTime(chosen.suspect_time)}</strong>
                </p>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setChosen(null)}
              >
                Palikti abu
              </Button>

              <Button
                variant="destructive"
                className="w-full"
                disabled={busyId === chosen.suspect_booking_id}
                onClick={() => void cancelOne(chosen)}
              >
                {busyId === chosen.suspect_booking_id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Pašalinti {shortTime(chosen.suspect_time)} rezervaciją
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pašalinti visus parodytus senesnius laikus?</DialogTitle>
            <DialogDescription>
              Šis veiksmas paliks dabartinius nuolatinius laikus ir atšauks tik šiuo metu kaip galimus senus dublikatus parodytas rezervacijas.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
            {rows.map((row) => (
              <div
                key={row.suspect_booking_id}
                className="flex items-center justify-between gap-3 rounded-lg bg-background/50 px-3 py-2 text-sm"
              >
                <span className="capitalize text-muted-foreground">
                  {formatDate(row.slot_date)}
                </span>
                <span className="whitespace-nowrap font-medium text-destructive">
                  pašalinti {shortTime(row.suspect_time)}
                </span>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              disabled={bulkBusy}
              onClick={() => setShowBulkConfirm(false)}
            >
              Atgal
            </Button>
            <Button
              variant="destructive"
              disabled={bulkBusy || rows.length === 0}
              onClick={() => void cancelAll()}
            >
              {bulkBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Patvirtinti ir pašalinti {rows.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
