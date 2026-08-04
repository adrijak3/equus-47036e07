import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type DuplicateBookingRow = {
  user_id: string;
  profile_name: string | null;
  slot_date: string;
  booking_id: string;
  slot_time: string;
  is_current_permanent: boolean;
  permanent_times: string[] | null;
  total_bookings: number;
};

type DuplicateGroup = {
  key: string;
  userId: string;
  profileName: string;
  slotDate: string;
  permanentTimes: string[];
  bookings: DuplicateBookingRow[];
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

export function UserDuplicateBookings({
  userId,
  adminMode = false,
}: {
  userId?: string;
  adminMode?: boolean;
}) {
  const [rows, setRows] = useState<DuplicateBookingRow[]>([]);
  const [chosenGroup, setChosenGroup] = useState<DuplicateGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error } = await (supabase as any).rpc(
      "get_duplicate_booking_candidates",
      { _user_id: adminMode ? null : userId },
    );

    if (error) {
      console.error("Duplicate booking check failed:", error);
      toast.error("Nepavyko patikrinti galimų pasikartojančių laikų.");
      setRows([]);
    } else {
      setRows((data ?? []) as DuplicateBookingRow[]);
    }

    setLoading(false);
  }, [adminMode, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo<DuplicateGroup[]>(() => {
    const grouped = new Map<string, DuplicateGroup>();

    for (const row of rows) {
      const key = `${row.user_id}-${row.slot_date}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.bookings.push(row);
      } else {
        grouped.set(key, {
          key,
          userId: row.user_id,
          profileName: row.profile_name || "Vartotojas",
          slotDate: row.slot_date,
          permanentTimes: (row.permanent_times ?? []).map(shortTime),
          bookings: [row],
        });
      }
    }

    return [...grouped.values()].sort((a, b) => {
      const userCompare = a.profileName.localeCompare(b.profileName, "lt");
      if (adminMode && userCompare !== 0) return userCompare;
      return a.slotDate.localeCompare(b.slotDate);
    });
  }, [adminMode, rows]);

  const removableRows = useMemo(
    () => rows.filter((row) => !row.is_current_permanent),
    [rows],
  );

  const cancelOne = async (row: DuplicateBookingRow) => {
    setBusyId(row.booking_id);

    const { data, error } = await (supabase as any).rpc(
      "cancel_duplicate_booking_candidate",
      { _booking_id: row.booking_id },
    );

    if (error || data?.ok === false) {
      toast.error(error?.message || data?.message || "Nepavyko pašalinti rezervacijos.");
    } else {
      toast.success(`${shortTime(row.slot_time)} rezervacija pašalinta.`);
      setChosenGroup(null);
      await load();
    }

    setBusyId(null);
  };

  const cancelAllOld = async (targetUserId: string) => {
    setBulkBusy(true);

    const { data, error } = await (supabase as any).rpc(
      "cancel_all_nonpermanent_duplicate_candidates",
      { _user_id: targetUserId },
    );

    if (error || data?.ok === false) {
      toast.error(error?.message || data?.message || "Nepavyko pašalinti senesnių laikų.");
    } else {
      const removed = Number(data?.removed_count ?? 0);
      toast.success(
        removed === 1
          ? "Pašalinta 1 galima sena rezervacija."
          : `Pašalintos ${removed} galimos senos rezervacijos.`,
      );
      setChosenGroup(null);
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
            {adminMode
              ? "Galimi pasikartojantys vartotojų laikai"
              : "Galimi pasikartojantys ateities treniruočių laikai"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Nieko nešaliname automatiškai. Rodomos dienos, kuriose tas pats žmogus turi daugiau nei vieną aktyvią rezervaciją.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/30 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Tikrinami ateities laikai…
        </div>
      ) : groups.length === 0 ? (
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
        <div className="mt-5 space-y-3">
          {groups.map((group) => {
            const extraTimes = group.bookings
              .filter((booking) => !booking.is_current_permanent)
              .map((booking) => shortTime(booking.slot_time));

            return (
              <article
                key={group.key}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  {adminMode && (
                    <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                      <UserRound className="h-4 w-4 text-gold" />
                      {group.profileName}
                    </div>
                  )}

                  <div className="font-medium capitalize text-foreground">
                    {formatDate(group.slotDate)}
                  </div>

                  <div className="mt-2 grid gap-1.5 text-sm text-muted-foreground">
                    {group.permanentTimes.length > 0 && (
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        <span>
                          Dabartinis nuolatinis laikas: {group.permanentTimes.join(", ")}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span>
                        Kiti tos dienos laikai: {extraTimes.length > 0 ? extraTimes.join(", ") : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setChosenGroup(group)}
                >
                  Peržiūrėti
                </Button>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!chosenGroup} onOpenChange={(open) => !open && setChosenGroup(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Peržiūrėti tos dienos rezervacijas</DialogTitle>
            <DialogDescription>
              Dabartinis nuolatinis laikas pažymėtas ir per šį langą nebus pašalintas. Kitą laiką pašalinsite tik paspaudę konkretų mygtuką.
            </DialogDescription>
          </DialogHeader>

          {chosenGroup && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                {adminMode && (
                  <p className="mb-1 font-medium text-foreground">{chosenGroup.profileName}</p>
                )}
                <p className="capitalize text-foreground">{formatDate(chosenGroup.slotDate)}</p>
              </div>

              <div className="space-y-2">
                {chosenGroup.bookings
                  .slice()
                  .sort((a, b) => a.slot_time.localeCompare(b.slot_time))
                  .map((booking) => (
                    <div
                      key={booking.booking_id}
                      className={cn(
                        "flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
                        booking.is_current_permanent
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-amber-500/25 bg-amber-500/5",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Clock className="h-4 w-4 text-gold" />
                        <div>
                          <p className="font-semibold text-foreground">{shortTime(booking.slot_time)}</p>
                          <p className="text-xs text-muted-foreground">
                            {booking.is_current_permanent
                              ? "Dabartinis nuolatinis laikas — paliekamas"
                              : "Galimas papildomas arba senas laikas"}
                          </p>
                        </div>
                      </div>

                      {!booking.is_current_permanent && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busyId === booking.booking_id}
                          onClick={() => void cancelOne(booking)}
                        >
                          {busyId === booking.booking_id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Pašalinti {shortTime(booking.slot_time)}
                        </Button>
                      )}
                    </div>
                  ))}
              </div>

              <Button variant="outline" className="w-full" onClick={() => setChosenGroup(null)}>
                Palikti visus
              </Button>

              {chosenGroup.permanentTimes.length > 0 &&
                chosenGroup.bookings.some((booking) => !booking.is_current_permanent) && (
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={bulkBusy}
                    onClick={() => void cancelAllOld(chosenGroup.userId)}
                  >
                    {bulkBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Pašalinti visus galimus senesnius laikus
                  </Button>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {!loading && !adminMode && removableRows.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Kiekvienas pašalinimas atšaukia tik pasirinktą konkrečios datos rezervaciją. Nuolatinio laiko nustatymas nepakeičiamas.
        </p>
      )}
    </section>
  );
}
