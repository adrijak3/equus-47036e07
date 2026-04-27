import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Star, Clock, Users, X, Loader2, AlertCircle, FileText, Plus, ExternalLink, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  WEEKDAYS_LT, MONTHS_LT, addDays, dbDayOfWeek, formatDateISO, formatTime,
  formatBookedName, hoursUntil, startOfWeek,
} from "@/lib/equus";
import { WEEKDAYS_LT_SHORT } from "@/lib/equus";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
interface ProfileLite { id: string; full_name: string; }
interface DayNote {
  id: string;
  note_date: string;
  link: string;
  label: string | null;
  added_by: string;
}

export default function Grafikas() {
  const { user, profile, isAdmin } = useAuth();
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
  // Permanent-cancel choice dialog
  const [permCancelDialog, setPermCancelDialog] = useState<{ booking: Booking } | null>(null);
  // Simple confirm dialog (replaces window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; description?: string; onConfirm: () => void } | null>(null);
  // Admin manage-slot dialog
  const [adminSlotDialog, setAdminSlotDialog] = useState<{ date: Date; time: string } | null>(null);
  const [allProfiles, setAllProfiles] = useState<ProfileLite[]>([]);
  const [adminAddUserId, setAdminAddUserId] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  // Day notes
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [notesDialog, setNotesDialog] = useState<{ date: Date } | null>(null);
  const [newNoteLink, setNewNoteLink] = useState("");
  const [newNoteLabel, setNewNoteLabel] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

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

    // Load day notes for this week (and a buffer day on each side)
    const { data: notes } = await supabase
      .from("day_notes")
      .select("*")
      .gte("note_date", startISO)
      .lte("note_date", endISO)
      .order("created_at", { ascending: true });
    setDayNotes((notes ?? []) as DayNote[]);

    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  // Load all profiles once for admin user-picker
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("profiles").select("id, full_name").order("full_name").then(({ data }) => {
      setAllProfiles(data ?? []);
    });
  }, [isAdmin]);

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

  const cancelSingleBooking = async (booking: Booking) => {
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", booking.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pamoka atšaukta");
    loadData();
  };

  const removePermanentForever = async (booking: Booking) => {
    if (!user) return;
    const dow = dbDayOfWeek(new Date(`${booking.slot_date}T${booking.slot_time}`));
    const { data: ps } = await supabase
      .from("permanent_slots").select("id")
      .eq("user_id", user.id).eq("day_of_week", dow).eq("slot_time", booking.slot_time)
      .maybeSingle();
    if (ps?.id) await supabase.from("permanent_slots").delete().eq("id", ps.id);
    await supabase.from("bookings").update({ status: "cancelled" })
      .eq("user_id", user.id).eq("slot_time", booking.slot_time)
      .gte("slot_date", booking.slot_date).eq("status", "active");
    toast.success("Nuolatinis laikas pašalintas. Visos būsimos pamokos atšauktos.");
    loadData();
  };

  /** Admin: bump capacity by +1 for this specific date+time */
  const adminAddOneSeat = async (date: Date, time: string, currentCap: number) => {
    const dateISO = formatDateISO(date);
    const existing = overrides.find((o) => o.slot_date === dateISO && o.slot_time === time);
    if (existing) {
      const { error } = await supabase.from("slot_overrides")
        .update({ max_capacity: existing.max_capacity + 1 })
        .eq("slot_date", dateISO).eq("slot_time", time);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("slot_overrides")
        .insert({ slot_date: dateISO, slot_time: time, max_capacity: currentCap + 1 });
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Vieta pridėta (+1)");
    loadData();
  };

  /** Admin: remove the +1 override (back to default capacity) */
  const adminRemoveOverride = async (date: Date, time: string) => {
    const dateISO = formatDateISO(date);
    const { error } = await supabase.from("slot_overrides")
      .delete()
      .eq("slot_date", dateISO).eq("slot_time", time);
    if (error) { toast.error(error.message); return; }
    toast.success("Papildoma vieta pašalinta");
    loadData();
  };

  /** Admin: force-add a user to a slot */
  const adminAddUserToSlot = async (date: Date, time: string, userId: string) => {
    if (!userId) { toast.error("Pasirinkite vartotoją"); return; }
    setAdminBusy(true);
    const { error } = await supabase.from("bookings").insert({
      user_id: userId, slot_date: formatDateISO(date), slot_time: time, status: "active",
    });
    setAdminBusy(false);
    if (error) {
      toast.error(error.code === "23505" ? "Vartotojas jau užregistruotas" : error.message);
      return;
    }
    toast.success("Pridėta");
    setAdminAddUserId("");
    loadData();
  };

  /** Admin: force-remove a booking */
  const adminRemoveBooking = async (bookingId: string) => {
    setAdminBusy(true);
    const { error } = await supabase.from("bookings")
      .update({ status: "cancelled" }).eq("id", bookingId);
    setAdminBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta");
    loadData();
  };

  /** Day notes: add */
  const addDayNote = async () => {
    if (!user) { toast.error("Pirma prisijunkite"); return; }
    if (!notesDialog) return;
    const link = newNoteLink.trim();
    if (!/^https?:\/\//i.test(link)) { toast.error("Įveskite pilną nuorodą (https://...)"); return; }
    setNoteBusy(true);
    const { error } = await supabase.from("day_notes").insert({
      note_date: formatDateISO(notesDialog.date),
      link,
      label: newNoteLabel.trim() || null,
      added_by: user.id,
    });
    setNoteBusy(false);
    if (error) {
      if (error.message.includes("MAX_15_LINKS_REACHED")) toast.error("Pasiekta 15 nuorodų riba");
      else toast.error(error.message);
      return;
    }
    setNewNoteLink(""); setNewNoteLabel("");
    toast.success("Pridėta");
    loadData();
  };

  const removeDayNote = async (id: string) => {
    const { error } = await supabase.from("day_notes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta");
    loadData();
  };

  const getDayNotes = (date: Date) =>
    dayNotes.filter((n) => n.note_date === formatDateISO(date));

  const handleCancelClick = async (booking: Booking) => {
    const perm = isPermanentBooking(booking);
    const hours = hoursUntil(booking.slot_date, booking.slot_time);

    // Permanent booking → ask via dialog whether single or forever
    if (perm) {
      setPermCancelDialog({ booking });
      return;
    }

    if (hours > 48) {
      setConfirmDialog({
        title: "Atšaukti pamoką?",
        description: "Pamoka bus pažymėta kaip atšaukta.",
        onConfirm: () => cancelSingleBooking(booking),
      });
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
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const rangeLabel = sameMonth
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${MONTHS_LT[weekStart.getMonth()].toLowerCase()} ${weekStart.getFullYear()}`
    : `${weekStart.getDate()} ${MONTHS_LT[weekStart.getMonth()].toLowerCase()} – ${weekEnd.getDate()} ${MONTHS_LT[weekEnd.getMonth()].toLowerCase()} ${weekEnd.getFullYear()}`;

  return (
    <div className="container max-w-[1400px] py-8 sm:py-14 relative">
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
      <div className="flex items-center justify-between gap-3 mb-6 sm:mb-8 flex-wrap">
        <div className="flex items-center gap-2 rounded-md border border-gold/20 bg-card/40 px-2 py-1.5">
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Praėjusi savaitė">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="font-display text-base sm:text-lg text-gradient-gold capitalize px-2 min-w-[180px] text-center">
            {rangeLabel}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Kita savaitė">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <Button variant="outlineGold" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          📅 Šiandien
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
        <>
          {/* Horizontal weekly grid: 7 day columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 sm:gap-3">
            {days.map((date, idx) => {
              const daySlots = getDaySlots(date);
              const isToday = date.getTime() === today.getTime();
              const isPast = date.getTime() < today.getTime();
              const dow = dbDayOfWeek(date);

              return (
                <div key={idx} className={cn("flex flex-col gap-2 relative", isPast && "opacity-60")}>
                  {/* Mobile-only separator between days */}
                  {idx > 0 && (
                    <div
                      aria-hidden
                      className="sm:hidden flex items-center justify-center -mt-1 mb-2 select-none"
                    >
                      <div className="flex-1 h-px bg-gold/20" />
                      <div className="px-2 text-gold/40 text-xs">•</div>
                      <div className="flex-1 h-px bg-gold/20" />
                    </div>
                  )}
                  {/* Day header */}
                  <div
                    className={cn(
                      "rounded-md border px-3 py-2.5 bg-gradient-card relative",
                      isToday ? "border-gold/50 shadow-gold" : "border-gold/15",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-1">
                      <div className="text-sm sm:text-[11px] uppercase tracking-[0.18em] text-gold font-bold">
                        <span className="sm:hidden xl:inline">{WEEKDAYS_LT[idx]}</span>
                        <span className="hidden sm:inline xl:hidden">{WEEKDAYS_LT_SHORT[idx]}</span>
                      </div>
                      {isToday && (
                        <span className="text-[9px] uppercase tracking-[0.15em] text-gold bg-gold/10 px-1.5 py-0.5 rounded-sm">
                          Šiandien
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-1.5">
                      <div className="font-display text-2xl text-gradient-gold leading-none tabular-nums">
                        {date.getDate()} <span className="text-base text-gold/70">{MONTHS_LT[date.getMonth()].toLowerCase().slice(0, 3)}.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setNotesDialog({ date }); setNewNoteLink(""); setNewNoteLabel(""); }}
                        className="relative inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold border border-gold/20 hover:border-gold/50 rounded px-1.5 py-0.5 transition-colors"
                        aria-label="Dienos nuorodos"
                        title="Dienos nuorodos"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Nuorodos</span>
                        {getDayNotes(date).length > 0 && (
                          <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-gold text-background text-[9px] font-bold px-1">
                            {getDayNotes(date).length}
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Weekend banners */}
                  {dow === 7 && (
                    <div className="rounded-md border border-gold/15 bg-gold/5 px-3 py-2 text-xs italic text-foreground/75 leading-snug">
                      Treniruotės pas Jolitą 12–15 val., pas Jovitą 16:30 val.
                    </div>
                  )}

                  {daySlots.length === 0 && (
                    <div className="rounded-md border border-gold/10 bg-card/30 px-3 py-6 text-xs text-muted-foreground text-center italic">
                      {dow === 7 ? "Individualus" : "Treniruočių nėra"}
                    </div>
                  )}

                  {/* Slot cards stacked vertically */}
                  {daySlots.map((slot) => {
                    const slotBookings = getSlotBookings(date, slot.slot_time);
                    const cap = getCapacity(date, slot.slot_time, slot.max_capacity);
                    const isFull = slotBookings.length >= cap;
                    const myBooking = slotBookings.find((b) => isMyBooking(b));
                    const slotWaiting = getWaitingFor(date, slot.slot_time);
                    const iAmWaiting = amIWaiting(date, slot.slot_time);
                    const slotPast = new Date(`${formatDateISO(date)}T${slot.slot_time}`).getTime() < Date.now();

                    return (
                      <div
                        key={slot.id}
                        className={cn(
                          "rounded-md border bg-gradient-card overflow-hidden transition-colors",
                          myBooking ? "border-gold/50" : "border-gold/15 hover:border-gold/30",
                        )}
                      >
                        {/* Slot header */}
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/10">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-gold/60" />
                            <span className="font-display text-xl sm:text-2xl tabular-nums text-foreground">
                              {formatTime(slot.slot_time)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Users className="w-3 h-3" />
                              <span className={cn(isFull && "text-blush")}>{slotBookings.length}/{cap}</span>
                            </div>
                            {isAdmin && !slotPast && (
                              <button
                                type="button"
                                onClick={() => adminAddOneSeat(date, slot.slot_time, cap)}
                                className="ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-gold/30 text-gold hover:bg-gold/10 transition-colors text-[11px] leading-none"
                                title="Pridėti +1 vietą šiai treniruotei"
                                aria-label="Pridėti vietą"
                              >
                                +1
                              </button>
                            )}
                            {isAdmin && !slotPast && overrides.some((o) => o.slot_date === formatDateISO(date) && o.slot_time === slot.slot_time) && (
                              <button
                                type="button"
                                onClick={() => adminRemoveOverride(date, slot.slot_time)}
                                className="ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-blush/40 text-blush hover:bg-blush/10 transition-colors text-[11px] leading-none"
                                title="Pašalinti papildomą vietą (atstatyti į numatytą)"
                                aria-label="Pašalinti papildomą vietą"
                              >
                                −1
                              </button>
                            )}
                            {isAdmin && !slotPast && (
                              <button
                                type="button"
                                onClick={() => { setAdminSlotDialog({ date, time: slot.slot_time }); setAdminAddUserId(""); }}
                                className="ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-gold/30 text-gold hover:bg-gold/10 transition-colors text-[11px] leading-none"
                                title="Valdyti dalyvius (admin)"
                                aria-label="Valdyti"
                              >
                                ⚙
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Booked names */}
                        {slotBookings.length > 0 && (
                          <ul className="px-3 py-2 space-y-1">
                            {slotBookings.map((b) => {
                              const perm = isPermanentBooking(b);
                              const mine = isMyBooking(b);
                              return (
                                <motion.li
                                  key={b.id}
                                  initial={{ opacity: 0, x: -4 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ duration: 0.25 }}
                                  className={cn(
                                    "flex items-center gap-1.5 text-base leading-snug",
                                    mine ? "text-gold" : "text-foreground/85",
                                    perm && "font-bold",
                                  )}
                                >
                                  <span className={cn("text-sm leading-none", mine ? "text-gold" : "text-gold/40")}>•</span>
                                  {perm && <Star className="w-2.5 h-2.5 text-gold fill-gold flex-shrink-0" />}
                                  <span className="truncate">{formatBookedName(b.profile_name ?? "—")}</span>
                                  {mine && !slotPast && (
                                    <button
                                      onClick={() => handleCancelClick(b)}
                                      className="ml-auto text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                                      aria-label="Atšaukti"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </motion.li>
                              );
                            })}
                          </ul>
                        )}

                        {/* Action button */}
                        {!slotPast && user && !myBooking && (
                          <div className="px-2 pb-2 pt-1">
                            {!isFull ? (
                              <Button
                                variant="ghostGold"
                                size="sm"
                                className="w-full h-8 text-xs"
                                disabled={busy === `book-${formatDateISO(date)}-${slot.slot_time}`}
                                onClick={() => handleBook(date, slot.slot_time)}
                              >
                                + Registruotis
                              </Button>
                            ) : iAmWaiting ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full h-8 text-[11px]"
                                onClick={() => handleLeaveWaiting(date, slot.slot_time)}
                              >
                                Iš laukiančiųjų ({slotWaiting.findIndex((w) => w.user_id === user.id) + 1})
                              </Button>
                            ) : (
                              <Button
                                variant="ghostGold"
                                size="sm"
                                className="w-full h-8 text-[11px]"
                                disabled={busy === `wait-${formatDateISO(date)}-${slot.slot_time}`}
                                onClick={() => handleJoinWaiting(date, slot.slot_time)}
                              >
                                + Laukiantis {slotWaiting.length > 0 && `(${slotWaiting.length})`}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gold" /> Jūsų rezervacija</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border border-gold/40" /> Kiti</span>
            <span className="flex items-center gap-1.5"><Star className="w-3 h-3 fill-gold text-gold" /> Pastovi vieta (paryškintas vardas)</span>
            <span className="flex items-center gap-1.5"><span className="text-blush">●</span> Pilnas / Laukimų sąrašas</span>
          </div>
        </>
      )}

      {/* Permanent cancel choice dialog */}
      <Dialog open={!!permCancelDialog} onOpenChange={(o) => !o && setPermCancelDialog(null)}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold flex items-center gap-2">
              <Star className="w-5 h-5 fill-gold text-gold" /> Nuolatinis laikas
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Tai jūsų nuolatinis laikas. Ką norite daryti?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <button
              onClick={() => {
                const b = permCancelDialog!.booking;
                setPermCancelDialog(null);
                const hours = hoursUntil(b.slot_date, b.slot_time);
                if (hours > 48) {
                  setConfirmDialog({
                    title: "Atšaukti tik šią pamoką?",
                    description: "Nuolatinis laikas išliks ateities savaitėms.",
                    onConfirm: () => cancelSingleBooking(b),
                  });
                } else {
                  setCancelDialog({ booking: b });
                  setCancelReason("");
                  setCancelSickness(false);
                }
              }}
              className="w-full text-left p-4 rounded-md border border-gold/20 hover:border-gold/50 hover:bg-gold/5 transition-colors"
            >
              <div className="font-medium text-foreground">Atšaukti tik šią pamoką</div>
              <div className="text-xs text-muted-foreground mt-1">Vienkartinis atšaukimas — kitos savaitės liks.</div>
            </button>
            <button
              onClick={() => {
                const b = permCancelDialog!.booking;
                setPermCancelDialog(null);
                setConfirmDialog({
                  title: "Pašalinti nuolatinį laiką VISAM laikui?",
                  description: "Visos jūsų būsimos pamokos šiuo laiku bus atšauktos. Šio veiksmo atšaukti negalėsite.",
                  onConfirm: () => removePermanentForever(b),
                });
              }}
              className="w-full text-left p-4 rounded-md border border-destructive/20 hover:border-destructive/50 hover:bg-destructive/5 transition-colors"
            >
              <div className="font-medium text-destructive">Pašalinti nuolatinį laiką visam laikui</div>
              <div className="text-xs text-muted-foreground mt-1">Visos būsimos pamokos šiuo laiku bus atšauktos.</div>
            </button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPermCancelDialog(null)}>Atgal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generic confirm dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={(o) => !o && setConfirmDialog(null)}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-gradient-gold">{confirmDialog?.title}</DialogTitle>
            {confirmDialog?.description && (
              <DialogDescription className="text-muted-foreground">{confirmDialog.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>Atgal</Button>
            <Button variant="gold" onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}>
              Patvirtinti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Admin: manage slot participants */}
      <Dialog open={!!adminSlotDialog} onOpenChange={(o) => !o && setAdminSlotDialog(null)}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold">
              Valdyti dalyvius
            </DialogTitle>
            <DialogDescription className="text-muted-foreground tabular-nums">
              {adminSlotDialog && `${formatDateISO(adminSlotDialog.date)} · ${formatTime(adminSlotDialog.time)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Užsiregistravę</Label>
              {adminSlotDialog && (() => {
                const list = getSlotBookings(adminSlotDialog.date, adminSlotDialog.time);
                if (list.length === 0) {
                  return <p className="text-sm italic text-muted-foreground mt-2">Nėra užsiregistravusių</p>;
                }
                return (
                  <ul className="mt-2 space-y-1.5">
                    {list.map((b) => (
                      <li key={b.id} className="flex items-center justify-between text-sm border border-gold/10 rounded px-3 py-2">
                        <span className="text-foreground/85">{b.profile_name ?? "—"}</span>
                        <button
                          onClick={() => adminRemoveBooking(b.id)}
                          disabled={adminBusy}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          aria-label="Pašalinti"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pridėti vartotoją</Label>
              <div className="flex gap-2 mt-2">
                <select
                  value={adminAddUserId}
                  onChange={(e) => setAdminAddUserId(e.target.value)}
                  className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">— pasirinkite —</option>
                  {allProfiles
                    .filter((p) => {
                      if (!adminSlotDialog) return true;
                      const booked = getSlotBookings(adminSlotDialog.date, adminSlotDialog.time);
                      return !booked.some((b) => b.user_id === p.id);
                    })
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                </select>
                <Button
                  variant="gold"
                  size="sm"
                  disabled={adminBusy || !adminAddUserId}
                  onClick={() => adminSlotDialog && adminAddUserToSlot(adminSlotDialog.date, adminSlotDialog.time, adminAddUserId)}
                >
                  Pridėti
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 italic">
                Talpos limitas ignoruojamas. Norint pridėti +1 vietą, naudokite +1 mygtuką.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdminSlotDialog(null)}>Uždaryti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Day notes dialog */}
      <Dialog open={!!notesDialog} onOpenChange={(o) => !o && setNotesDialog(null)}>
        <DialogContent className="bg-gradient-card border-gold/20 max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold flex items-center gap-2">
              <FileText className="w-5 h-5 text-gold" /> Dienos nuorodos
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {notesDialog && (
                <>
                  {notesDialog.date.toLocaleDateString("lt-LT", { weekday: "long", day: "numeric", month: "long" })}
                  {" · "}
                  <span className="text-[11px] italic">nuorodos automatiškai ištrinamos po 2 dienų</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {notesDialog && (() => {
              const list = getDayNotes(notesDialog.date);
              if (list.length === 0) {
                return <p className="text-sm italic text-muted-foreground py-2">Nuorodų dar nėra</p>;
              }
              return (
                <ul className="space-y-2 max-h-80 overflow-auto">
                  {list.map((n) => {
                    const canDelete = user && (n.added_by === user.id || isAdmin);
                    return (
                      <li
                        key={n.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-gold/15 bg-background/40 px-3 py-2"
                      >
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm text-gold hover:underline truncate flex-1 min-w-0"
                          title={n.link}
                        >
                          <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">{n.label?.trim() || n.link}</span>
                        </a>
                        {canDelete && (
                          <button
                            onClick={() => removeDayNote(n.id)}
                            className="text-muted-foreground hover:text-destructive flex-shrink-0"
                            aria-label="Pašalinti"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}

            {user ? (
              <div className="space-y-2 pt-2 border-t border-gold/10">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pridėti nuorodą</Label>
                <Input
                  value={newNoteLink}
                  onChange={(e) => setNewNoteLink(e.target.value)}
                  placeholder="https://wetransfer.com/…"
                  type="url"
                />
                <Input
                  value={newNoteLabel}
                  onChange={(e) => setNewNoteLabel(e.target.value)}
                  placeholder="Pavadinimas (neprivaloma)"
                  maxLength={80}
                />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {notesDialog ? `${getDayNotes(notesDialog.date).length}/15 nuorodų` : ""}
                  </span>
                  <Button variant="gold" size="sm" disabled={noteBusy || !newNoteLink.trim()} onClick={addDayNote}>
                    <Plus className="w-3.5 h-3.5" /> Pridėti
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic pt-2 border-t border-gold/10">
                Prisijunkite, kad galėtumėte pridėti nuorodą.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotesDialog(null)}>Uždaryti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
