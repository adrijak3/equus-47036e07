import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastUndo } from "@/lib/undo";
import { formatTime, isValidTime } from "@/lib/equus";
import { ArrowRightLeft, CalendarX2, CheckCircle2, IdCard, Wallet } from "lucide-react";

export interface RiderTarget {
  bookingId: string;
  userId: string;
  name: string;
  isGuest: boolean;
  slotDate: string;
  slotTime: string;
}

/** Staff-only bottom-sheet with large tap targets for quick rider actions. */
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
  const [busy, setBusy] = useState(false);

  const openMove = () => {
    if (!target) return;
    setMoveDate(target.slotDate);
    setMoveTime(formatTime(target.slotTime));
    setMoveOpen(true);
  };

  const doMove = async () => {
    if (!target) return;
    if (!isValidTime(moveTime)) { toast.error("Įveskite teisingą laiką (HH:MM)"); return; }
    setBusy(true);
    const prev = { slot_date: target.slotDate, slot_time: target.slotTime };
    const { error } = await supabase
      .from("bookings")
      .update({ slot_date: moveDate, slot_time: `${moveTime}:00` })
      .eq("id", target.bookingId);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setMoveOpen(false);
    onClose();
    onChanged();
    toastUndo(`Rezervacija perkelta į ${moveDate} ${moveTime}.`, async () => {
      const { error: undoErr } = await supabase.from("bookings").update(prev).eq("id", target.bookingId);
      if (undoErr) throw undoErr;
      onChanged();
    });
  };

  const doCancel = async () => {
    if (!target) return;
    setBusy(true);
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", target.bookingId);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
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
    if (error) { toast.error(error.message); return; }
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

  /** Deep-link into Admin for this exact rider (by user id — display names are not unique). */
  const goAdmin = (section: "subs" | "users") => {
    if (!target) return;
    onClose();
    navigate(
      `/admin?section=${section}&uid=${encodeURIComponent(target.userId)}&open=1`,
      { state: { from: "grafikas" } },
    );
  };

  const actions = [
    { key: "move", label: "Perkelti", icon: ArrowRightLeft, onClick: openMove },
    { key: "cancel", label: "Atšaukti", icon: CalendarX2, onClick: doCancel, danger: true },
    { key: "attended", label: "Pažymėti dalyvavo", icon: CheckCircle2, onClick: doAttended },
    {
      key: "sub",
      label: "Abonementas",
      icon: Wallet,
      onClick: () => goAdmin("subs"),
    },
    {
      key: "profile",
      label: "Atidaryti profilį",
      icon: IdCard,
      onClick: () => goAdmin("users"),
    },
  ];

  return (
    <>
      <Drawer open={!!target && !moveOpen} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent className="border-gold/20 bg-gradient-card">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl text-gradient-gold">{target?.name}</DrawerTitle>
            <DrawerDescription>
              {target ? `${target.slotDate} · ${formatTime(target.slotTime)}` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-2 px-4 pb-8">
            {actions.map((a) => {
              const Icon = a.icon;
              const disabled = busy || (target?.isGuest && (a.key === "sub" || a.key === "profile"));
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={disabled}
                  onClick={a.onClick}
                  className={[
                    "flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 text-left text-base transition-colors disabled:opacity-40",
                    a.danger
                      ? "border-destructive/30 text-destructive hover:bg-destructive/10"
                      : "border-gold/20 text-foreground hover:border-gold/50 hover:bg-gold/5",
                  ].join(" ")}
                >
                  <Icon className="h-5 w-5 shrink-0 opacity-80" />
                  {a.label}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

      <Dialog open={moveOpen} onOpenChange={(o) => { if (!o) { setMoveOpen(false); onClose(); } }}>
        <DialogContent className="rounded-3xl border-gold/20 bg-gradient-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-gradient-gold">Perkelti rezervaciją</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="move-date">Data</Label>
              <Input id="move-date" type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="move-time">Laikas (HH:MM)</Label>
              <Input id="move-time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} placeholder="17:00" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setMoveOpen(false); onClose(); }}>Atgal</Button>
            <Button variant="gold" disabled={busy} onClick={doMove}>Perkelti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}