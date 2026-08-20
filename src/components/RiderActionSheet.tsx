import { useState } from "react";
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
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { toastUndo } from "@/lib/undo";
import { formatTime, isValidTime } from "@/lib/equus";
import {
  ArrowRightLeft,
  CalendarX2,
  CheckCircle2,
  IdCard,
  Wallet,
} from "lucide-react";
import { Horse } from "@/components/icons/Horse";
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
  const { isAdmin, isTrainer } = useAuth();

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

  const canManageHorses = isAdmin || isTrainer;

  const openMove = () => {
    if (!target) return;
    setMoveDate(target.slotDate);
    setMoveTime(formatTime(target.slotTime));
    setMoveOpen(true);
  };

  const loadHorseData = async () => {
    if (!target) return;

    setHorseLoading(true);

    const [horsesRes, assignmentsRes] = await Promise.all([
      supabase
        .from("horses")
        .select("id, name, notes, active, max_daily_rides")
        .eq("active", true)
        .order("name"),

      supabase
        .from("horse_assignments")
        .select(
          "id, booking_id, user_id, guest_name, slot_date, slot_time, horse_id",
        )
        .eq("slot_date", target.slotDate),
    ]);

    setHorseLoading(false);

    if (horsesRes.error) {
      toast.error(`Nepavyko įkelti žirgų: ${horsesRes.error.message}`);
      return;
    }

    if (assignmentsRes.error) {
      toast.error(
        `Nepavyko įkelti paskyrimų: ${assignmentsRes.error.message}`,
      );
      return;
    }

    setHorses((horsesRes.data ?? []) as HorseOption[]);
    const assignmentData =
      (assignmentsRes.data ?? []) as HorseAssignment[];
    setAssignments(assignmentData);

    const current = assignmentData.find(
      (assignment) => assignment.booking_id === target.bookingId,
    );

    setSelectedHorseId(current?.horse_id ?? "");
  };

  const openHorse = async () => {
    if (!target) return;

    if (!canManageHorses) {
      toast.error("Neturite trenerio arba administratoriaus teisių.");
      return;
    }

    setHorseOpen(true);
    await loadHorseData();
  };

  const usageFor = (horseId: string) =>
    assignments.filter(
      (assignment) =>
        assignment.horse_id === horseId &&
        assignment.slot_date === target?.slotDate,
    ).length;

  const doChangeHorse = async () => {
    if (!target || !selectedHorseId) return;

    setHorseSaving(true);

    const { error } = await supabase.rpc("admin_set_booking_horse", {
      _booking_id: target.bookingId,
      _horse_id: selectedHorseId,
    });

    setHorseSaving(false);

    if (error) {
      if (error.message.includes("HORSE_LIMIT_REACHED")) {
        toast.error(
          isAdmin
            ? "Šis žirgas jau pasiekė 3 jojimų dienos limitą."
            : "Šis žirgas jau pasiekė 2 jojimų dienos limitą.",
        );
      } else if (error.message.includes("NOT_ALLOWED")) {
        toast.error("Neturite teisės keisti žirgų.");
      } else if (error.message.includes("HORSE_NOT_AVAILABLE")) {
        toast.error("Šis žirgas šiuo metu nepasiekiamas.");
      } else if (error.message.includes("BOOKING_NOT_FOUND")) {
        toast.error("Rezervacija nerasta.");
      } else {
        toast.error(error.message);
      }

      await loadHorseData();
      return;
    }

    toast.success("Žirgas pakeistas.");
    setHorseOpen(false);
    setSelectedHorseId("");
    onChanged();
  };

  const doMove = async () => {
    if (!target) return;

    if (!isValidTime(moveTime)) {
      toast.error("Įveskite teisingą laiką (HH:MM)");
      return;
    }

    setBusy(true);

    const prev = {
      slot_date: target.slotDate,
      slot_time: target.slotTime,
    };

    const { error } = await supabase
      .from("bookings")
      .update({
        slot_date: moveDate,
        slot_time: `${moveTime}:00`,
      })
      .eq("id", target.bookingId);

    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setMoveOpen(false);
    onClose();
    onChanged();

    toastUndo(`Rezervacija perkelta į ${moveDate} ${moveTime}.`, async () => {
      const { error: undoErr } = await supabase
        .from("bookings")
        .update(prev)
        .eq("id", target.bookingId);

      if (undoErr) throw undoErr;
      onChanged();
    });
  };

  const doCancel = async () => {
    if (!target) return;

    setBusy(true);

    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", target.bookingId);

    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    onClose();
    onChanged();

    toastUndo("Rezervacija atšaukta.", async () => {
      const { error: undoErr } = await supabase
        .from("bookings")
        .update({ status: "active" })
        .eq("id", target.bookingId);

      if (undoErr) throw undoErr;
      onChanged();
    });
  };

  const doAttended = async () => {
    if (!target) return;

    setBusy(true);

    const { error } = await supabase
      .from("bookings")
      .update({ status: "completed" })
      .eq("id", target.bookingId);

    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    onClose();
    onChanged();

    toastUndo("Pažymėta: dalyvavo.", async () => {
      const { error: undoErr } = await supabase
        .from("bookings")
        .update({ status: "active" })
        .eq("id", target.bookingId);

      if (undoErr) throw undoErr;
      onChanged();
    });
  };

  const goAdmin = (section: "subs" | "users") => {
    if (!target) return;

    onClose();

    navigate(
      `/admin?section=${section}&uid=${encodeURIComponent(target.userId)}&open=1`,
      { state: { from: "grafikas" } },
    );
  };

  const actions = [
    {
      key: "horse",
      label: "Pakeisti žirgą",
      icon: Horse,
      onClick: openHorse,
      disabled: !canManageHorses || target?.isGuest,
    },
    {
      key: "move",
      label: "Perkelti",
      icon: ArrowRightLeft,
      onClick: openMove,
      disabled: false,
    },
    {
      key: "cancel",
      label: "Atšaukti",
      icon: CalendarX2,
      onClick: doCancel,
      danger: true,
      disabled: false,
    },
    {
      key: "attended",
      label: "Pažymėti dalyvavo",
      icon: CheckCircle2,
      onClick: doAttended,
      disabled: false,
    },
    {
      key: "sub",
      label: "Abonementas",
      icon: Wallet,
      onClick: () => goAdmin("subs"),
      disabled: target?.isGuest ?? false,
    },
    {
      key: "profile",
      label: "Atidaryti profilį",
      icon: IdCard,
      onClick: () => goAdmin("users"),
      disabled: target?.isGuest ?? false,
    },
  ];

  return (
    <>
      <Drawer
        open={!!target && !moveOpen && !horseOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent className="border-gold/20 bg-gradient-card">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl text-gradient-gold">
              {target?.name}
            </DrawerTitle>
            <DrawerDescription>
              {target
                ? `${target.slotDate} · ${formatTime(target.slotTime)}`
                : ""}
            </DrawerDescription>
          </DrawerHeader>

          <div className="grid gap-2 px-4 pb-8">
            {actions.map((action) => {
              const Icon = action.icon;
              const disabled = busy || action.disabled;

              return (
                <button
                  key={action.key}
                  type="button"
                  disabled={disabled}
                  onClick={action.onClick}
                  className={[
                    "flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 text-left text-base transition-colors disabled:opacity-40",
                    action.danger
                      ? "border-destructive/30 text-destructive hover:bg-destructive/10"
                      : "border-gold/20 text-foreground hover:border-gold/50 hover:bg-gold/5",
                  ].join(" ")}
                >
                  <Icon className="h-5 w-5 shrink-0 opacity-80" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

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
            <DialogDescription>
              {target?.name}
              {target
                ? ` · ${target.slotDate} · ${formatTime(target.slotTime)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {horseLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Kraunami žirgai…
            </div>
          ) : (
            <div className="space-y-2">
              {horses.map((horse) => {
                const used = usageFor(horse.id);
                const isCurrent = selectedHorseId === horse.id;
                const allowedLimit = isAdmin ? 3 : 2;
                const full = used >= allowedLimit && !isCurrent;

                return (
                  <button
                    key={horse.id}
                    type="button"
                    disabled={full}
                    onClick={() => setSelectedHorseId(horse.id)}
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
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-medium">
                          <Horse size={16} />
                          <span>{horse.name}</span>
                        </div>

                        {horse.notes && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {horse.notes}
                          </div>
                        )}
                      </div>

                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-1 text-xs font-semibold",
                          full
                            ? "bg-destructive/10 text-destructive"
                            : "bg-gold/10 text-gold",
                        )}
                      >
                        {used}/{allowedLimit}
                      </span>
                    </div>

                    {full && (
                      <div className="mt-1 text-[10px] text-destructive">
                        Dienos limitas pasiektas
                      </div>
                    )}

                    {isAdmin && used === 2 && !isCurrent && (
                      <div className="mt-1 text-[10px] text-gold">
                        Administratoriaus 3-iasis jojimas galimas
                      </div>
                    )}
                  </button>
                );
              })}

              {horses.length === 0 && (
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
                setHorseOpen(false);
                setSelectedHorseId("");
              }}
            >
              Atgal
            </Button>

            <Button
              variant="gold"
              disabled={!selectedHorseId || horseSaving}
              onClick={doChangeHorse}
            >
              {horseSaving ? "Išsaugoma…" : "Išsaugoti"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveOpen}
        onOpenChange={(open) => {
          if (!open) {
            setMoveOpen(false);
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
              <Label htmlFor="move-date">Data</Label>
              <Input
                id="move-date"
                type="date"
                value={moveDate}
                onChange={(e) => setMoveDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="move-time">Laikas (HH:MM)</Label>
              <Input
                id="move-time"
                value={moveTime}
                onChange={(e) => setMoveTime(e.target.value)}
                placeholder="17:00"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setMoveOpen(false);
                onClose();
              }}
            >
              Atgal
            </Button>

            <Button variant="gold" disabled={busy} onClick={doMove}>
              Perkelti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
