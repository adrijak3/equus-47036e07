import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Star, Clock, Users, X, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  WEEKDAYS_LT, MONTHS_LT, addDays, dbDayOfWeek, formatDateISO, formatTime,
  formatBookedName, hoursUntil, startOfWeek,
} from "@/lib/equus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FloralAccent, HorseFlourish } from "@/components/Decorations";

interface TimeSlot {
  id: string;
  day_of_week: number;
  slot_time: string;
  max_capacity: number;
  is_permanent_for: string | null;
}
interface Booking {
  id: string;
  user_id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  profile_name?: string;
}
interface SlotOverride {
  slot_date: string;
  slot_time: string;
  max_capacity: number;
}
interface WaitingEntry {
  id: string;
  user_id: string;
  slot_date: string;
  slot_time: string;
  profile_name?: string;
}
interface PermanentSlot {
  user_id: string;
  day_of_week: number;
  slot_time: string;
}

export default function Grafikas() {
  const { user, profile } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [overrides, setOverrides] = useState<SlotOverride[]>([]);
  const [waiting, setWaiting] = useState<WaitingEntry[]>([]);
  const [permanents, setPermanents] = useState<PermanentSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Cancel dialog state
  const [cancelDialog, setCancelDialog] = useState<{ booking: Booking } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSickness, setCancelSickness] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];

  const loadData = async () => {
    setLoading(true);
    const startISO = formatDateISO(weekStart);
    const endISO = formatDateISO(weekEnd);

    // Materialise any missing permanent bookings for this week (idempotent, server-side)
    await supabase.rpc("materialize_permanent_bookings", { _start: startISO, _end: endISO });

    const [slotsRes, bookingsRes, overridesRes, waitingRes, permRes] = await Promise.all([
      supabase.from("time_slots").select("*").eq("active", true).order("slot_time"),
      supabase.from("bookings").select("id, user_id, slot_date, slot_time, status")
        .gte("slot_date", startISO).lte("slot_date", endISO).eq("status", "active"),
      supabase.from("slot_overrides").select("*").gte("slot_date", startISO).lte("slot_date", endISO),
      supabase.from("waiting_list").select("*").gte("slot_date", startISO).lte("slot_date", endISO),
      supabase.from("permanent_slots").select("user_id, day_of_week, slot_time"),
    ]);

    const userIds = new Set<string>();
    (bookingsRes.data ?? []).forEach((b) => userIds.add(b.user_id));
    (waitingRes.data ?? []).forEach((w) => userIds.add(w.user_id));

    let nameMap: Record<string, string> = {};
    if (userIds.size > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(userIds));
      nameMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    }

    setSlots(slotsRes.data ?? []);
    setBookings((bookingsRes.data ?? []).map((b) => ({ ...b, profile_name: nameMap[b.user_id] })));
    setOverrides(overridesRes.data ?? []);
    setWaiting((waitingRes.data ?? []).map((w) => ({ ...w, profile_name: nameMap[w.user_id] })));
    setPermanents(permRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  const isPermanentBooking = (b: Booking) => {
    const dow = dbDayOfWeek(new Date(`${b.slot_date}T${b.slot_time}`));
    return permanents.some(
      (p) => p.user_id === b.user_id && p.day_of_week === dow &&
             p.slot_time.slice(0, 5) === b.slot_time.slice(0, 5),
    );
  };

  const getDaySlots = (date: Date) => {
    const dow = dbDayOfWeek(date);
    return slots.filter((s) => s.day_of_week === dow);
  };

  const getCapacity = (date: Date, time: string, baseCapacity: number) => {
    const dateISO = formatDateISO(date);
    const o = overrides.find((x) => x.slot_date === dateISO && x.slot_time === time);
    return o ? o.max_capacity : baseCapacity;
  };

  const getSlotBookings = (date: Date, time: string) => {
    const dateISO = formatDateISO(date);
    return bookings.filter((b) => b.slot_date === dateISO && b.slot_time === time);
  };

  const getWaitingFor = (date: Date, time: string) => {
    const dateISO = formatDateISO(date);
    return waiting.filter((w) => w.slot_date === dateISO && w.slot_time === time);
  };

  const isMyBooking = (b: Booking) => user && b.user_id === user.id;
  const amIWaiting = (date: Date, time: string) =>
    user ? getWaitingFor(date, time).some((w) => w.user_id === user.id) : false;

  const handleBook = async (date: Date, time: string) => {
    if (!user) {
      toast.error("Pirma prisijunkite");
      return;
    }
    if (date.getTime() < new Date().setHours(0, 0, 0, 0)) {
      toast.error("Negalima registruotis į praeities pamokas");
      return;
    }
    const key = `book-${formatDateISO(date)}-${time}`;
    setBusy(key);
    const { error } = await supabase.from("bookings").insert({
      user_id: user.id,
      slot_date: formatDateISO(date),
      slot_time: time,
      status: "active",
    });
    setBusy(null);
    if (error) {
      toast.error(error.code === "23505" ? "Jūs jau užregistruoti į šią pamoką" : "Klaida: " + error.message);
      return;
    }
    toast.success("Užregistruota!");
    loadData();
  };

  const handleJoinWaiting = async (date: Date, time: string) => {
    if (!user) { toast.error("Pirma prisijunkite"); return; }
    const key = `wait-${formatDateISO(date)}-${time}`;
    setBusy(key);
    const { error } = await supabase.from("waiting_list").insert({
      user_id: user.id,
      slot_date: formatDateISO(date),
      slot_time: time,
    });
    setBusy(null);
    if (error) {
      toast.error(error.code === "23505" ? "Jau esate laukiančiųjų sąraše" : error.message);
      return;
    }
    toast.success("Pridėta į laukiančiųjų sąrašą");
    loadData();
  };

  const handleLeaveWaiting = async (date: Date, time: string) => {
    if (!user) return;
    const entry = getWaitingFor(date, time).find((w) => w.user_id === user.id);
    if (!entry) return;
    const { error } = await supabase.from("waiting_list").delete().eq("id", entry.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta iš laukiančiųjų");
    loadData();
  };

  const handleCancelClick = async (booking: Booking) => {
    const perm = isPermanentBooking(booking);
    const hours = hoursUntil(booking.slot_date, booking.slot_time);

    // Permanent booking: ask whether to cancel just this one or remove the standing slot
    if (perm) {
      const choice = window.prompt(
        "Tai NUOLATINIS laikas.\n\nĮrašykite:\n  1 — atšaukti tik šią pamoką\n  2 — pašalinti nuolatinį laiką VISAM laikui (visos būsimos pamokos bus atšauktos)",
        "1",
      );
      if (choice !== "1" && choice !== "2") return;

      if (choice === "2") {
        // Find permanent slot row
        const dow = dbDayOfWeek(new Date(`${booking.slot_date}T${booking.slot_time}`));
        const { data: ps } = await supabase
          .from("permanent_slots")
          .select("id")
          .eq("user_id", user!.id)
          .eq("day_of_week", dow)
          .eq("slot_time", booking.slot_time)
          .maybeSingle();
        if (ps?.id) await supabase.from("permanent_slots").delete().eq("id", ps.id);
        // Cancel this + all future bookings of same user/dow/time
        await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("user_id", user!.id)
          .eq("slot_time", booking.slot_time)
          .gte("slot_date", booking.slot_date)
          .eq("status", "active");
        toast.success("Nuolatinis laikas pašalintas");
        loadData();
        return;
      }
      // choice === "1" → fall through to single-cancel
    }

    if (hours > 48) {
      if (!confirm("Atšaukti pamoką?")) return;
      const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Pamoka atšaukta");
      loadData();
    } else {
      setCancelDialog({ booking });
      setCancelReason("");
      setCancelSickness(false);
    }
  };

  const submitLateCancel = async () => {
    if (!cancelDialog || !user) return;
    if (!cancelSickness && cancelReason.trim().length < 3) {
      toast.error("Įveskite atšaukimo priežastį");
      return;
    }
    // Free slot immediately, mark booking cancelled, log request for admin decision
    const { error: e1 } = await supabase.from("bookings")
      .update({ status: "cancelled" }).eq("id", cancelDialog.booking.id);
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from("cancellation_requests").insert({
      booking_id: cancelDialog.booking.id,
      user_id: user.id,
      reason: cancelSickness ? "Liga" : cancelReason.trim(),
      sickness: cancelSickness,
      status: cancelSickness ? "approved" : "pending",
      admin_decision_counts: cancelSickness ? false : null,
    });
    if (e2) { toast.error(e2.message); return; }
    toast.success(cancelSickness ? "Atšaukta. Pamoka neskaičiuos." : "Atšaukta. Laukia administracijos sprendimo.");
    setCancelDialog(null);
    loadData();
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthLabel = `${MONTHS_LT[weekStart.getMonth()]} ${weekStart.getFullYear()}`;

  return (
    <div className="container max-w-5xl py-8 sm:py-14 relative">
      {/* Decorative floral accents */}
      <FloralAccent className="absolute -top-8 -left-12 hidden md:block" size={180} delay={0.2} rotate={-15} />
      <FloralAccent className="absolute top-32 -right-16 hidden md:block" size={150} delay={0.5} rotate={20} />
      <HorseFlourish className="absolute top-4 right-4 sm:right-12" size={70} />

      {/* Hero */}
      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="text-center mb-10 relative"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-gold/70 mb-3">Equus jojimo klubas</p>
        <h1 className="text-4xl sm:text-6xl font-display text-gradient-gold leading-tight mb-3">
          Mylintiems žirgus<br className="sm:hidden" /> ir laisvę
        </h1>
        <div className="gold-divider max-w-[140px] mx-auto" />
      </motion.header>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        <Button variant="outlineGold" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Praėjusi savaitė">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Tvarkaraštis</div>
          <div className="font-display text-xl sm:text-2xl text-gradient-gold capitalize">{monthLabel.toLowerCase()}</div>
        </div>
        <Button variant="outlineGold" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Kita savaitė">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {!user && (
        <div className="mb-6 p-4 bg-gold/5 border border-gold/20 rounded-md text-sm text-center">
          <Link to="/auth" className="text-gold hover:underline font-medium">Prisijunkite</Link>{" "}
          arba <Link to="/auth?tab=signup" className="text-gold hover:underline font-medium">susikurkite paskyrą</Link>{" "}
          norėdami registruotis į pamokas.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gold/60">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((date, idx) => {
            const daySlots = getDaySlots(date);
            const isToday = date.getTime() === today.getTime();
            const isPast = date.getTime() < today.getTime();
            const dow = dbDayOfWeek(date); // 1..7

            return (
              <section
                key={idx}
                className={cn(
                  "bg-gradient-card border rounded-lg overflow-hidden transition-all",
                  isToday ? "border-gold/40 shadow-gold" : "border-gold/10",
                  isPast && "opacity-60",
                )}
              >
                <div className="flex items-baseline justify-between px-5 sm:px-6 py-4 border-b border-gold/10">
                  <div>
                    <h3 className="font-display text-2xl text-gold">{WEEKDAYS_LT[idx]}</h3>
                    <p className="text-xs text-muted-foreground tracking-wide mt-0.5">
                      {date.getDate()} {MONTHS_LT[date.getMonth()].toLowerCase()}
                    </p>
                  </div>
                  {isToday && <span className="text-[10px] uppercase tracking-[0.2em] text-gold/80">Šiandien</span>}
                </div>

                <div className="divide-y divide-gold/5">
                  {/* Weekend training info banners */}
                  {dow === 6 && (
                    <div className="px-5 sm:px-6 py-3 bg-gold/5 text-sm italic text-foreground/80">
                      Treniruotės pas Jolitą 10–13 val., pas Jovitą 15 val.
                    </div>
                  )}
                  {dow === 7 && (
                    <div className="px-5 sm:px-6 py-3 bg-gold/5 text-sm italic text-foreground/80">
                      Treniruotės pas Jolitą 12–15 val., pas Jovitą 16:30 val.
                    </div>
                  )}

                  {daySlots.length === 0 && (
                    <div className="px-5 sm:px-6 py-6 text-sm text-muted-foreground text-center italic">
                      {dow === 7 ? "Sekmadienio tvarkaraštis nustatomas individualiai" : "Pamokų nėra"}
                    </div>
                  )}

                  {daySlots.map((slot) => {
                    const slotBookings = getSlotBookings(date, slot.slot_time);
                    const cap = getCapacity(date, slot.slot_time, slot.max_capacity);
                    const isFull = slotBookings.length >= cap;
                    const myBooking = slotBookings.find((b) => isMyBooking(b));
                    const slotWaiting = getWaitingFor(date, slot.slot_time);
                    const iAmWaiting = amIWaiting(date, slot.slot_time);
                    const slotPast = new Date(`${formatDateISO(date)}T${slot.slot_time}`).getTime() < Date.now();

                    return (
                      <div key={slot.id} className="px-5 sm:px-6 py-4 hover:bg-gold/5 transition-colors">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3">
                            <Clock className="w-4 h-4 text-gold/60" />
                            <span className="font-display text-xl tabular-nums text-foreground">
                              {formatTime(slot.slot_time)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Users className="w-3.5 h-3.5" />
                            <span className={cn(isFull && "text-blush")}>{slotBookings.length}/{cap}</span>
                          </div>
                        </div>

                        {/* Booked names — bullet list */}
                        {slotBookings.length > 0 && (
                          <ul className="pl-7 mb-2 space-y-1">
                            {slotBookings.map((b) => {
                              const perm = isPermanentBooking(b);
                              const mine = isMyBooking(b);
                              return (
                                <motion.li
                                  key={b.id}
                                  initial={{ opacity: 0, x: -6 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ duration: 0.3 }}
                                  className={cn(
                                    "flex items-center gap-2 text-sm",
                                    mine ? "text-gold" : "text-foreground/85",
                                    perm && "font-bold",
                                  )}
                                >
                                  <span className={cn("text-base leading-none", mine ? "text-gold" : "text-gold/40")}>
                                    •
                                  </span>
                                  {perm && <Star className="w-3 h-3 text-gold fill-gold" />}
                                  <span>{formatBookedName(b.profile_name ?? "—")}</span>
                                  {mine && !slotPast && (
                                    <button
                                      onClick={() => handleCancelClick(b)}
                                      className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                                      aria-label="Atšaukti"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </motion.li>
                              );
                            })}
                          </ul>
                        )}

                        {/* Action button */}
                        {!slotPast && user && !myBooking && (
                          <div className="pl-7 mt-2">
                            {!isFull ? (
                              <Button
                                variant="ghostGold"
                                size="sm"
                                disabled={busy === `book-${formatDateISO(date)}-${slot.slot_time}`}
                                onClick={() => handleBook(date, slot.slot_time)}
                              >
                                + Registruotis
                              </Button>
                            ) : iAmWaiting ? (
                              <Button variant="ghost" size="sm" onClick={() => handleLeaveWaiting(date, slot.slot_time)}>
                                Pašalinti iš laukiančiųjų ({slotWaiting.findIndex((w) => w.user_id === user.id) + 1} eilėje)
                              </Button>
                            ) : (
                              <Button
                                variant="ghostGold"
                                size="sm"
                                disabled={busy === `wait-${formatDateISO(date)}-${slot.slot_time}`}
                                onClick={() => handleJoinWaiting(date, slot.slot_time)}
                              >
                                + Į laukiančiųjų sąrašą {slotWaiting.length > 0 && `(${slotWaiting.length})`}
                              </Button>
                            )}
                          </div>
                        )}

                        {!user && !slotPast && !isFull && (
                          <div className="pl-7 text-xs text-muted-foreground italic">
                            Prisijunkite norėdami registruotis
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Late cancel dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={(o) => !o && setCancelDialog(null)}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold">Atšaukimas <span className="text-base text-blush">&lt; 48 val.</span></DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Slot atsilaisvins iš karto. Administracija nuspręs, ar pamoka skaičiuojama abonemente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gold/15 hover:border-gold/30 transition-colors">
              <Checkbox checked={cancelSickness} onCheckedChange={(v) => setCancelSickness(!!v)} />
              <div>
                <div className="font-medium text-foreground flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-gold" /> Liga
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Pamoka NEbus skaičiuojama</div>
              </div>
            </label>

            {!cancelSickness && (
              <div>
                <Label htmlFor="reason">Priežastis</Label>
                <Textarea
                  id="reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  maxLength={500}
                  placeholder="Trumpai aprašykite..."
                  rows={3}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelDialog(null)}>Atgal</Button>
            <Button variant="gold" onClick={submitLateCancel}>Patvirtinti atšaukimą</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
