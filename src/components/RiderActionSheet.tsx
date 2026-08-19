import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastUndo } from "@/lib/undo";
import {
  formatTime,
  isValidTime,
} from "@/lib/equus";
import {
  ArrowRightLeft,
  CalendarX2,
  CheckCircle2,
  IdCard,
  Wallet,
  Horse,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface RiderTarget {
  bookingId: string;
  userId: string;
  name: string;
  isGuest: boolean;
  slotDate: string;
  slotTime: string;
}

interface HorseOption {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  max_daily_rides: number;
}

interface HorseAssignment {
  id: string;
  booking_id: string | null;
  user_id: string | null;
  guest_name: string | null;
  slot_date: string;
  slot_time: string;
  horse_id: string;
}

export function RiderActionSheet({
  target,
  onClose,
  onChanged,
}: {
  target: RiderTarget | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [moveTime, setMoveTime] = useState("");

  const [horseOpen, setHorseOpen] = useState(false);
  const [horses, setHorses] = useState<HorseOption[]>([]);
  const [assignments, setAssignments] = useState<HorseAssignment[]>([]);
  const [selectedHorseId, setSelectedHorseId] = useState("");
  const [horseLoading, setHorseLoading] = useState(false);
  const [horseSaving, setHorseSaving] = useState(false);

  const [busy, setBusy] = useState(false);

  const openMove = () => {
    if (!target) return;

    setMoveDate(target.slotDate);
    setMoveTime(formatTime(target.slotTime));
    setMoveOpen(true);
  };

  const loadHorseData = async () => {
    if (!target) return;

    setHorseLoading(true);

    const [horsesRes, assignmentsRes] =
      await Promise.all([
        supabase
          .from("horses")
          .select(
            "id, name, notes, active, max_daily_rides",
          )
          .eq("active", true)
          .order("name"),

        supabase
          .from("horse_assignments")
          .select("*")
          .eq("slot_date", target.slotDate),
      ]);

    setHorseLoading(false);

    if (horsesRes.error) {
      toast.error(
        `Nepavyko įkelti žirgų: ${horsesRes.error.message}`,
      );
      return;
    }

    if (assignmentsRes.error) {
      toast.error(
        `Nepavyko įkelti paskyrimų: ${assignmentsRes.error.message}`,
      );
      return;
    }

    setHorses(
      (horsesRes.data ?? []) as HorseOption[],
    );

    setAssignments(
      (assignmentsRes.data ??
        []) as HorseAssignment[],
    );

    const current = (
      assignmentsRes.data ?? []
    ).find(
      (a: any) =>
        a.booking_id === target.bookingId,
    );

    setSelectedHorseId(
      current?.horse_id ?? "",
    );
  };

  const openHorse = async () => {
    if (!target) return;

    if (target.isGuest) {
      toast.error(
        "Svečiui žirgą pakeisti galima administruojant treniruotę.",
      );
      return;
    }

    setHorseOpen(true);
    await loadHorseData();
  };

  const currentAssignment = useMemo(() => {
    if (!target) return null;

    return (
      assignments.find(
        (a) =>
          a.booking_id === target.bookingId,
      ) ?? null
    );
  }, [assignments, target]);

  const usageFor = (
    horseId: string,
  ) => {
    return assignments.filter(
      (a) =>
        a.horse_id === horseId &&
        a.slot_date ===
          target?.slotDate &&
        a.id !==
          currentAssignment?.id,
    ).length;
  };

  const doChangeHorse = async () => {
    if (
      !target ||
      !selectedHorseId
    )
      return;

    setHorseSaving(true);

    const { error } =
      await supabase.rpc(
        "admin_set_booking_horse",
        {
          _booking_id:
            target.bookingId,
          _horse_id:
            selectedHorseId,
        },
      );

    setHorseSaving(false);

    if (error) {
      if (
        error.message.includes(
          "HORSE_LIMIT_REACHED",
        )
      ) {
        toast.error(
          "Šis žirgas jau pasiekė dienos limitą.",
        );
      } else if (
        error.message.includes(
          "NOT_ADMIN",
        )
      ) {
        toast.error(
          "Tik administratorius gali naudoti šią funkciją.",
        );
      } else {
        toast.error(error.message);
      }

      await loadHorseData();
      return;
    }

    toast.success(
      "Žirgas pakeistas.",
    );

    setHorseOpen(false);
    setSelectedHorseId("");
    onChanged();
  };

  const doMove = async () => {
    if (!target) return;

    if (!isValidTime(moveTime)) {
      toast.error(
        "Įveskite teisingą laiką (HH:MM)",
      );
      return;
    }

    setBusy(true);

    const prev = {
      slot_date:
        target.slotDate,
      slot_time:
        target.slotTime,
    };

    const { error } =
      await supabase
        .from("bookings")
        .update({
          slot_date: moveDate,
          slot_time: `${moveTime}:00`,
        })
        .eq(
          "id",
          target.bookingId,
        );

    setBusy(false);

    if (error) {
      toast.error(
        error.message,
      );
      return;
    }

    setMoveOpen(false);
    onClose();
    onChanged();

    toastUndo(
      `Rezervacija perkelta į ${moveDate} ${moveTime}.`,
      async () => {
        const {
          error: undoErr,
        } = await supabase
          .from("bookings")
          .update(prev)
          .eq(
            "id",
            target.bookingId,
          );

        if (undoErr)
          throw undoErr;

        onChanged();
      },
    );
  };

  const doCancel = async () => {
    if (!target) return;

    setBusy(true);

    const { error } =
      await supabase
        .from("bookings")
        .update({
          status:
            "cancelled",
        })
        .eq(
          "id",
          target.bookingId,
        );

    setBusy(false);

    if (error) {
      toast.error(
        error.message,
      );
      return;
    }

    onClose();
    onChanged();

    toastUndo(
      "Rezervacija atšaukta.",
      async () => {
        const {
          error: undoErr,
        } = await supabase
          .from("bookings")
          .update({
            status:
              "active",
          })
          .eq(
            "id",
            target.bookingId,
          );

        if (undoErr)
          throw undoErr;

        onChanged();
      },
    );
  };

  const doAttended = async () => {
    if (!target) return;

    setBusy(true);

    const { error } =
      await supabase
        .from("bookings")
        .update({
          status:
            "completed",
        })
        .eq(
          "id",
          target.bookingId,
        );

    setBusy(false);

    if (error) {
      toast.error(
        error.message,
      );
      return;
    }

    onClose();
    onChanged();

    toastUndo(
      "Pažymėta: dalyvavo.",
      async () => {
        const {
          error: undoErr,
        } = await supabase
          .from("bookings")
          .update({
            status:
              "active",
          })
          .eq(
            "id",
            target.bookingId,
          );

        if (undoErr)
          throw undoErr;

        onChanged();
      },
    );
  };

  const goAdmin = (
    section: "subs" | "users",
  ) => {
    if (!target) return;

    onClose();

    navigate(
      `/admin?section=${section}&uid=${encodeURIComponent(
        target.userId,
      )}&open=1`,
      {
        state: {
          from: "grafikas",
        },
      },
    );
  };

  const actions = [
    {
      key: "horse",
      label: "Pakeisti žirgą",
      icon: Horse,
      onClick: openHorse,
      disabled: target?.isGuest,
    },
    {
      key: "move",
      label: "Perkelti",
      icon: ArrowRightLeft,
      onClick: openMove,
    },
    {
      key: "cancel",
      label: "Atšaukti",
      icon: CalendarX2,
      onClick: doCancel,
      danger: true,
    },
    {
      key: "attended",
      label: "Pažymėti dalyvavo",
      icon: CheckCircle2,
      onClick: doAttended,
    },
    {
      key: "sub",
      label: "Abonementas",
      icon: Wallet,
      onClick: () =>
        goAdmin("subs"),
    },
    {
      key: "profile",
      label: "Atidaryti profilį",
      icon: IdCard,
      onClick: () =>
        goAdmin("users"),
    },
  ];

  return (
    <>
      {/* ================================================= */}
      {/* RIDER ACTION SHEET                               */}
      {/* ================================================= */}

      <Drawer
        open={
          !!target &&
          !moveOpen &&
          !horseOpen
        }
        onOpenChange={(open) =>
          !open && onClose()
        }
      >
        <DrawerContent className="border-gold/20 bg-gradient-card">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl text-gradient-gold">
              {target?.name}
            </DrawerTitle>

            <DrawerDescription>
              {target
                ? `${target.slotDate} · ${formatTime(
                    target.slotTime,
                  )}`
                : ""}
            </DrawerDescription>
          </DrawerHeader>

          <div className="grid gap-2 px-4 pb-8">
            {actions.map(
              (a) => {
                const Icon =
                  a.icon;

                const disabled =
                  busy ||
                  a.disabled;

                return (
                  <button
                    key={a.key}
                    type="button"
                    disabled={
                      disabled
                    }
                    onClick={
                      a.onClick
                    }
                    className={[
                      "flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 text-left text-base transition-colors disabled:opacity-40",
                      a.danger
                        ? "border-destructive/30 text-destructive hover:bg-destructive/10"
                        : "border-gold/20 text-foreground hover:border-gold/50 hover:bg-gold/5",
                    ].join(
                      " ",
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0 opacity-80" />
                    {a.label}
                  </button>
                );
              },
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* ================================================= */}
      {/* HORSE CHANGE DIALOG                              */}
      {/* ================================================= */}

      <Dialog
        open={horseOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHorseOpen(false);
            setSelectedHorseId("");
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-gold/20 bg-gradient-card">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold">
              Pakeisti žirgą
            </DialogTitle>

            <div className="text-sm text-muted-foreground">
              {target?.name}
              {target
                ? ` · ${target.slotDate} · ${formatTime(
                    target.slotTime,
                  )}`
                : ""}
            </div>
          </DialogHeader>

          {horseLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Kraunami žirgai…
            </div>
          ) : (
            <div className="space-y-2">
              {horses.map(
                (horse) => {
                  const used =
                    usageFor(
                      horse.id,
                    );

                  const isCurrent =
                    selectedHorseId ===
                    horse.id;

                  const limit = 2;

                  /*
                   * The staff member using this sheet
                   * may be trainer OR admin.
                   *
                   * Database decides whether a 3rd ride
                   * is actually allowed.
                   *
                   * We show 2/2 as full here; admin override
                   * is handled by the admin function.
                   */
                  const full =
                    used >=
                      limit &&
                    !isCurrent;

                  return (
                    <button
                      key={
                        horse.id
                      }
                      type="button"
                      disabled={
                        full &&
                        !isCurrent
                      }
                      onClick={() =>
                        setSelectedHorseId(
                          horse.id,
                        )
                      }
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-colors",
                        isCurrent
                          ? "border-gold bg-gold/10"
                          : full
                            ? "cursor-not-allowed border-border/50 opacity-50"
                            : "border-gold/15 hover:border-gold/40 hover:bg-gold/5",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            🐴{" "}
                            {
                              horse.name
                            }
                          </div>

                          {horse.notes && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {
                                horse.notes
                              }
                            </div>
                          )}
                        </div>

                        <span
                          className={cn(
                            "rounded-full px-2 py-1 text-xs font-semibold",
                            full
                              ? "bg-destructive/10 text-destructive"
                              : "bg-gold/10 text-gold",
                          )}
                        >
                          {
                            used
                          }
                          /2
                        </span>
                      </div>

                      {full && (
                        <div className="mt-1 text-[10px] text-destructive">
                          Dienos limitas pasiektas
                        </div>
                      )}
                    </button>
                  );
                },
              )}

              {horses.length ===
                0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Aktyvių žirgų nėra.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setHorseOpen(
                  false,
                );
                setSelectedHorseId(
                  "",
                );
              }}
            >
              Atgal
            </Button>

            <Button
              variant="gold"
              disabled={
                !selectedHorseId ||
                horseSaving
              }
              onClick={
                doChangeHorse
              }
            >
              {horseSaving
                ? "Išsaugoma…"
                : "Išsaugoti"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================= */}
      {/* MOVE DIALOG                                      */}
      {/* ================================================= */}

      <Dialog
        open={moveOpen}
        onOpenChange={(open) => {
          if (!open) {
            setMoveOpen(
              false,
            );
            onClose();
          }
        }}
      >
        <DialogContent className="rounded-3xl border-gold/20 bg-gradient-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-gradient-gold">
              Perkelti rezervaciją
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="move-date">
                Data
              </Label>

              <Input
                id="move-date"
                type="date"
                value={
                  moveDate
                }
                onChange={(e) =>
                  setMoveDate(
                    e.target
                      .value,
                  )
                }
              />
            </div>

            <div>
              <Label htmlFor="move-time">
                Laikas (HH:MM)
              </Label>

              <Input
                id="move-time"
                value={
                  moveTime
                }
                onChange={(e) =>
                  setMoveTime(
                    e.target
                      .value,
                  )
                }
                placeholder="17:00"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setMoveOpen(
                  false,
                );
                onClose();
              }}
            >
              Atgal
            </Button>

            <Button
              variant="gold"
              disabled={busy}
              onClick={
                doMove
              }
            >
              Perkelti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
