import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Clock,
  X,
  Loader2,
  AlertCircle,
  FileText,
  Plus,
  ExternalLink,
  Trash2,
  MessageSquare,
  Grid2X2,
  List,
  CircleCheckBig,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  WEEKDAYS_LT,
  MONTHS_LT,
  addDays,
  dbDayOfWeek,
  formatDateISO,
  formatTime,
  formatBookedName,
  hoursUntil,
  startOfWeek,
  isValidTime,
} from "@/lib/equus";
import { WEEKDAYS_LT_SHORT } from "@/lib/equus";
import { TimeInput } from "@/components/TimeInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FloralAccent, HorseFlourish } from "@/components/Decorations";
import { VacationBanner } from "@/components/VacationsPanel";
import { useLanguage } from "@/contexts/LanguageContext";
import { AvailabilityBadge } from "@/components/AvailabilityBadge";
import {
  RiderActionSheet,
  type RiderTarget,
} from "@/components/RiderActionSheet";
import { RiderLevelBadge } from "@/components/RiderLevelBadge";
import { GuestRiderDialog } from "@/components/GuestRiderDialog";
import {
  levelOf,
  trainerGroupState,
  blockReason,
  type RidingLevel,
} from "@/lib/levels";

interface TimeSlot {
  id: string;
  day_of_week: number;
  slot_time: string;
  max_capacity: number;
  is_permanent_for: string | null;
  one_off_date?: string | null;
  trainer_name?: string | null;
}

interface Booking {
  id: string;
  user_id: string | null;
  slot_date: string;
  slot_time: string;
  status: string;
  profile_name?: string;
  display_name?: string | null;
  riding_level?: string | null;
  is_guest?: boolean;
  guest_name?: string | null;
  is_individual?: boolean;
  guest_rider_id?: string | null;
  trainer_name?: string | null;
  is_newcomer?: boolean;
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

interface HorseAssignment {
  id: string;
  booking_id: string | null;
  user_id: string | null;
  guest_name: string | null;
  slot_date: string;
  slot_time: string;
  horse_id: string;
  horse_name?: string;
}

interface HorseOption {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  max_daily_rides: number;
}

interface ProfileLite {
  id: string;
  full_name: string;
  riding_level?: string | null;
}

interface DayNote {
  id: string;
  note_date: string;
  link: string;
  label: string | null;
  added_by: string;
}

interface SlotNote {
  id: string;
  note_date: string;
  slot_time: string | null;
  note: string;
  recurrence?: "once" | "weekly";
  day_of_week?: number | null;
}

export default function Grafikas() {
  const { user, isAdmin, isTrainer } = useAuth();
  const [riderTarget, setRiderTarget] = useState<RiderTarget | null>(null);
  const { language, t } = useLanguage();

  const [calendarView, setCalendarView] = useState<"week" | "list">(() => {
    const saved = localStorage.getItem("equus_calendar_view");
    return saved === "list" ? "list" : "week";
  });

  const changeCalendarView = (view: "week" | "list") => {
    setCalendarView(view);
    localStorage.setItem("equus_calendar_view", view);
  };

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const dayRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [pendingScrollToToday, setPendingScrollToToday] = useState(false);

  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [overrides, setOverrides] = useState<SlotOverride[]>([]);
  const [waiting, setWaiting] = useState<WaitingEntry[]>([]);
  const [permanents, setPermanents] = useState<PermanentSlot[]>([]);
  const [dayCancellations, setDayCancellations] = useState<
    { note_date: string; note: string | null }[]
  >([]);

  const [assignments, setAssignments] = useState<HorseAssignment[]>([]);
  const [horses, setHorses] = useState<HorseOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<{
    date: Date;
    time: string;
  } | null>(null);

  // Horse selection
  const [horseDialog, setHorseDialog] = useState<{
    bookingId: string;
    date: Date;
    time: string;
  } | null>(null);

  const [selectedHorseId, setSelectedHorseId] = useState("");
  const [horseBusy, setHorseBusy] = useState(false);

  // Cancel dialog state
  const [cancelDialog, setCancelDialog] = useState<{
    booking: Booking;
  } | null>(null);

  const [cancelReason, setCancelReason] = useState("");
  const [cancelSickness, setCancelSickness] = useState(false);
  const [cancelFile, setCancelFile] = useState<File | null>(null);
  const [cancelUploading, setCancelUploading] = useState(false);

  // Permanent-cancel choice dialog
  const [permCancelDialog, setPermCancelDialog] = useState<{
    booking: Booking;
  } | null>(null);

  // Simple confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description?: string;
    onConfirm: () => void;
  } | null>(null);

  // Admin manage-slot dialog
  const [adminSlotDialog, setAdminSlotDialog] = useState<{
    date: Date;
    time: string;
    slot: TimeSlot;
  } | null>(null);

  const [allProfiles, setAllProfiles] = useState<ProfileLite[]>([]);
  const [adminAddUserId, setAdminAddUserId] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  const [forcePrompt, setForcePrompt] = useState<{
    date: Date;
    time: string;
    userId: string;
    reason: string;
  } | null>(null);

  // Guest dialog
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);

  // Trainer roster levels
  const [trainerRosterByTrainer, setTrainerRosterByTrainer] = useState<
    Record<string, Record<string, string>>
  >({});

  // Day notes
  const [dayNotes, setDayNotes] = useState<DayNote[]>([]);
  const [notesDialog, setNotesDialog] = useState<{ date: Date } | null>(null);
  const [newNoteLink, setNewNoteLink] = useState("");
  const [newNoteLabel, setNewNoteLabel] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  // Slot notes
  const [slotNotes, setSlotNotes] = useState<SlotNote[]>([]);
  const [weeklyNotes, setWeeklyNotes] = useState<SlotNote[]>([]);
  const [slotNoteDialog, setSlotNoteDialog] = useState<{
    date: Date;
    time: string | null;
  } | null>(null);

  const [slotNoteText, setSlotNoteText] = useState("");
  const [slotNoteRecurrence, setSlotNoteRecurrence] =
    useState<"once" | "weekly">("once");
  const [slotNoteBusy, setSlotNoteBusy] = useState(false);

  // Admin custom slot
  const [customSlotDialog, setCustomSlotDialog] = useState<{
    date: Date;
  } | null>(null);

  const [customSlotTime, setCustomSlotTime] = useState("");
  const [customSlotCap, setCustomSlotCap] = useState(6);
  const [customBusy, setCustomBusy] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  useEffect(() => {
    if (!pendingScrollToToday) return;

    const timeout = setTimeout(() => {
      const todayMs = (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })();

      const idx = days.findIndex((d) => d.getTime() === todayMs);

      if (idx >= 0) {
        dayRefs.current[idx]?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }

      setPendingScrollToToday(false);
    }, 80);

    return () => clearTimeout(timeout);
  }, [pendingScrollToToday, days]);

  const weekEnd = days[6];

  const loadData = async () => {
    setLoading(true);

    const startISO = formatDateISO(weekStart);
    const endISO = formatDateISO(weekEnd);

    await supabase.rpc("materialize_permanent_bookings", {
      _start: startISO,
      _end: endISO,
    });

    const [
      slotsRes,
      bookingsRes,
      overridesRes,
      waitingRes,
      permRes,
      cancelsRes,
    ] = await Promise.all([
      supabase
        .from("time_slots")
        .select("*")
        .eq("active", true)
        .order("slot_time"),

      supabase
        .from("bookings")
        .select(
          "id, user_id, slot_date, slot_time, status, is_guest, guest_name, is_individual, guest_rider_id, trainer_name",
        )
        .gte("slot_date", startISO)
        .lte("slot_date", endISO)
        .in("status", ["active", "completed"]),

      supabase
        .from("slot_overrides")
        .select("*")
        .gte("slot_date", startISO)
        .lte("slot_date", endISO),

      supabase
        .from("waiting_list")
        .select("*")
        .gte("slot_date", startISO)
        .lte("slot_date", endISO),

      supabase.from("permanent_slots").select(
        "user_id, day_of_week, slot_time",
      ),

      supabase
        .from("day_cancellations" as any)
        .select("note_date, note")
        .gte("note_date", startISO)
        .lte("note_date", endISO),
    ]);

    const userIds = new Set<string>();

    (bookingsRes.data ?? []).forEach((b) => {
      if (b.user_id) userIds.add(b.user_id);
    });

    (waitingRes.data ?? []).forEach((w) => userIds.add(w.user_id));

    let nameMap: Record<string, string> = {};
    let displayMap: Record<string, string | null> = {};
    let levelMap: Record<string, string | null> = {};

    if (userIds.size > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, display_name, riding_level")
        .in("id", Array.from(userIds));

      nameMap = Object.fromEntries(
        (profs ?? []).map((p) => [p.id, p.full_name]),
      );

      displayMap = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.id, p.display_name]),
      );

      levelMap = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.id, p.riding_level]),
      );
    }

    // Guest riders
    const guestRiderIds = Array.from(
      new Set(
        (bookingsRes.data ?? [])
          .map((b: any) => b.guest_rider_id)
          .filter(Boolean),
      ),
    );

    let guestNameMap: Record<string, string> = {};
    let guestNewcomerMap: Record<string, boolean> = {};

    if (guestRiderIds.length > 0) {
      const { data: guests } = await supabase
        .from("guest_riders")
        .select("id, first_name, last_name, is_newcomer")
        .in("id", guestRiderIds as string[]);

      guestNameMap = Object.fromEntries(
        (guests ?? []).map((g: any) => [
          g.id,
          `${g.first_name} ${g.last_name}`.trim(),
        ]),
      );

      guestNewcomerMap = Object.fromEntries(
        (guests ?? []).map((g: any) => [g.id, !!g.is_newcomer]),
      );
    }

    setSlots(slotsRes.data ?? []);

    setBookings(
      (bookingsRes.data ?? []).map((b: any) => ({
        ...b,
        profile_name: b.guest_rider_id
          ? guestNameMap[b.guest_rider_id]
          : nameMap[b.user_id],
        display_name: b.user_id ? displayMap[b.user_id] : null,
        is_newcomer: b.guest_rider_id
          ? !!guestNewcomerMap[b.guest_rider_id]
          : undefined,
        riding_level: b.is_guest
          ? "beginner"
          : levelMap[b.user_id],
      })),
    );

    setOverrides(overridesRes.data ?? []);
    setWaiting(
      (waitingRes.data ?? []).map((w) => ({
        ...w,
        profile_name: nameMap[w.user_id],
      })),
    );

    setPermanents(permRes.data ?? []);
    setDayCancellations((cancelsRes.data as any[] | null) ?? []);

    // Trainer rosters
    const jolitaTrainerNames = Array.from(
      new Set(
        (slotsRes.data ?? [])
          .map((s: any) => s.trainer_name as string | null)
          .filter(
            (n): n is string =>
              !!n && n.toLowerCase().includes("jolita"),
          ),
      ),
    );

    if (jolitaTrainerNames.length > 0) {
      const { data: trainerProfiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("full_name", jolitaTrainerNames);

      const trainerIdByName: Record<string, string> =
        Object.fromEntries(
          (trainerProfiles ?? []).map((p: any) => [
            p.full_name,
            p.id,
          ]),
        );

      const trainerIds = Object.values(trainerIdByName);

      if (trainerIds.length > 0) {
        const { data: roster } = await supabase
          .from("trainer_riders")
          .select(
            "trainer_user_id, rider_user_id, guest_rider_id, level",
          )
          .in("trainer_user_id", trainerIds);

        const nameByTrainerId: Record<string, string> =
          Object.fromEntries(
            Object.entries(trainerIdByName).map(([name, id]) => [
              id,
              name,
            ]),
          );

        const byTrainer: Record<
          string,
          Record<string, string>
        > = {};

        (roster ?? []).forEach((r: any) => {
          const trainerName =
            nameByTrainerId[r.trainer_user_id];

          if (!trainerName) return;

          if (!byTrainer[trainerName]) {
            byTrainer[trainerName] = {};
          }

          const key = r.rider_user_id
            ? `user:${r.rider_user_id}`
            : `guest:${r.guest_rider_id}`;

          byTrainer[trainerName][key] = r.level;
        });

        setTrainerRosterByTrainer(byTrainer);
      } else {
        setTrainerRosterByTrainer({});
      }
    } else {
      setTrainerRosterByTrainer({});
    }

    // ----------------------------------------------------------
    // HORSES
    // ----------------------------------------------------------

    const { data: horseRows } = await supabase
      .from("horses")
      .select("id, name, notes, active, max_daily_rides")
      .eq("active", true)
      .order("name");

    setHorses((horseRows ?? []) as HorseOption[]);

    // Horse assignments for this week
    const { data: assignsRaw } = await supabase
      .from("horse_assignments")
      .select("*")
      .gte("slot_date", startISO)
      .lte("slot_date", endISO);

    const horseIds = Array.from(
      new Set(
        (assignsRaw ?? []).map((a: any) => a.horse_id),
      ),
    );

    let horseNameMap: Record<string, string> = {};

    if (horseIds.length) {
      const { data: hs } = await supabase
        .from("horses")
        .select("id, name")
        .in("id", horseIds);

      horseNameMap = Object.fromEntries(
        (hs ?? []).map((h: any) => [h.id, h.name]),
      );
    }

    setAssignments(
      (assignsRaw ?? []).map((a: any) => ({
        ...a,
        horse_name: horseNameMap[a.horse_id],
      })),
    );

    // Day notes
    const { data: notes } = await supabase
      .from("day_notes")
      .select("*")
      .gte("note_date", startISO)
      .lte("note_date", endISO)
      .order("created_at", { ascending: true });

    setDayNotes((notes ?? []) as DayNote[]);

    // Slot notes
    const { data: snotes } = await supabase
      .from("slot_notes" as any)
      .select(
        "id, note_date, slot_time, note, recurrence, day_of_week",
      )
      .gte("note_date", startISO)
      .lte("note_date", endISO)
      .eq("recurrence", "once");

    setSlotNotes(
      ((snotes ?? []) as any[]).map((n) => ({
        id: n.id,
        note_date: n.note_date,
        slot_time: n.slot_time
          ? String(n.slot_time).slice(0, 8)
          : null,
        note: n.note,
        recurrence: "once",
      })),
    );

    // Weekly notes
    const { data: wnotes } = await supabase
      .from("slot_notes" as any)
      .select("id, note, recurrence, day_of_week, slot_time")
      .eq("recurrence", "weekly");

    setWeeklyNotes(
      ((wnotes ?? []) as any[]).map((n) => ({
        id: n.id,
        note_date: "",
        slot_time: n.slot_time
          ? String(n.slot_time).slice(0, 8)
          : null,
        note: n.note,
        recurrence: "weekly" as const,
        day_of_week: n.day_of_week,
      })),
    );

    setLoading(false);
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  // Load all profiles once for admin user-picker
  useEffect(() => {
    if (!isAdmin) return;

    supabase
      .from("profiles")
      .select("id, full_name, riding_level")
      .order("full_name")
      .then(({ data }) => {
        setAllProfiles((data ?? []) as any);
      });
  }, [isAdmin]);

  const isPermanentBooking = (b: Booking) => {
    const dow = dbDayOfWeek(
      new Date(`${b.slot_date}T${b.slot_time}`),
    );

    return permanents.some(
      (p) =>
        p.user_id === b.user_id &&
        p.day_of_week === dow &&
        p.slot_time.slice(0, 5) === b.slot_time.slice(0, 5),
    );
  };

  const getDaySlots = (date: Date) => {
    const dow = dbDayOfWeek(date);
    const dateISO = formatDateISO(date);

    return slots.filter((s) => {
      if (s.day_of_week !== dow) return false;

      if (s.one_off_date) {
        return s.one_off_date === dateISO;
      }

      return true;
    });
  };

  const getSlotsAtTime = (date: Date, time: string) =>
    getDaySlots(date).filter((s) => s.slot_time === time);

  const isPrimarySlot = (slot: TimeSlot, date: Date) => {
    const candidates = getSlotsAtTime(
      date,
      slot.slot_time,
    );

    return candidates[0]?.id === slot.id;
  };

  const getCapacity = (
    date: Date,
    time: string,
    baseCapacity: number,
  ) => {
    const dateISO = formatDateISO(date);

    const o = overrides.find(
      (x) =>
        x.slot_date === dateISO &&
        x.slot_time === time,
    );

    return o ? o.max_capacity : baseCapacity;
  };

  const riderLevel = (
    b: Booking,
    slot: TimeSlot,
  ): RidingLevel => {
    const trainerName = slot.trainer_name;

    if (
      trainerName &&
      trainerName.toLowerCase().includes("jolita")
    ) {
      const roster =
        trainerRosterByTrainer[trainerName];

      if (roster) {
        const key =
          b.is_guest && b.guest_rider_id
            ? `guest:${b.guest_rider_id}`
            : `user:${b.user_id}`;

        const found = roster[key];

        if (found) return levelOf(found);
      }
    }

    return levelOf(b.riding_level);
  };

  const getSlotBookings = (
    date: Date,
    time: string,
    slot: TimeSlot,
  ) => {
    const dateISO = formatDateISO(date);
    const primary = isPrimarySlot(slot, date);

    const matching = bookings.filter(
      (b) =>
        b.slot_date === dateISO &&
        b.slot_time === time &&
        (
          b.trainer_name
            ? b.trainer_name === slot.trainer_name
            : primary
        ),
    );

    const seen = new Set<string>();

    const list = matching.filter((b) => {
      const key = b.is_guest
        ? `guest:${b.guest_rider_id ?? b.guest_name ?? b.id}`
        : `user:${b.user_id}`;

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });

    return list.sort((a, b) => {
      const pa = isPermanentBooking(a) ? 0 : 1;
      const pb = isPermanentBooking(b) ? 0 : 1;

      if (pa !== pb) return pa - pb;

      const na =
        (a.is_guest ? a.guest_name : a.profile_name) ?? "";

      const nb =
        (b.is_guest ? b.guest_name : b.profile_name) ?? "";

      return na.localeCompare(nb, "lt");
    });
  };

  const slotLevels = (
    date: Date,
    time: string,
    slot: TimeSlot,
  ): RidingLevel[] =>
    getSlotBookings(date, time, slot).map((b) =>
      riderLevel(b, slot),
    );

  const getGroupInfo = (
    date: Date,
    time: string,
    slot: TimeSlot,
  ) => {
    const cap = getCapacity(
      date,
      time,
      slot.max_capacity,
    );

    const isJolita =
      !!slot.trainer_name &&
      slot.trainer_name.toLowerCase().includes("jolita");

    if (!isJolita) {
      const taken = getSlotBookings(
        date,
        time,
        slot,
      ).length;

      return {
        trainer: slot.trainer_name ?? null,
        capacity: cap,
        taken,
        note: null as string | null,
        levels: [] as RidingLevel[],
      };
    }

    const levels = slotLevels(
      date,
      time,
      slot,
    );

    const state = trainerGroupState(
      levels,
      Math.min(4, cap),
    );

    return {
      trainer: slot.trainer_name,
      capacity: state.maxAllowed,
      taken: state.total,
      note: state.reason,
      levels,
    };
  };

  const getWaitingFor = (
    date: Date,
    time: string,
  ) => {
    const dateISO = formatDateISO(date);

    return waiting.filter(
      (w) =>
        w.slot_date === dateISO &&
        w.slot_time === time,
    );
  };

  const isMyBooking = (b: Booking) =>
    !!(
      user &&
      b.user_id &&
      b.user_id === user.id
    );

  const getHorseFor = (
    b: Booking,
  ): string | null => {
    const a = assignments.find(
      (x) =>
        x.booking_id === b.id ||
        (
          x.slot_date === b.slot_date &&
          x.slot_time === b.slot_time &&
          (
            b.is_guest
              ? x.guest_name === b.guest_name
              : x.user_id === b.user_id
          )
        ),
    );

    return a?.horse_name ?? null;
  };

  const getHorseAssignment = (b: Booking) =>
    assignments.find(
      (x) =>
        x.booking_id === b.id ||
        (
          x.slot_date === b.slot_date &&
          x.slot_time === b.slot_time &&
          x.user_id === b.user_id
        ),
    );

  const amIWaiting = (
    date: Date,
    time: string,
  ) =>
    user
      ? getWaitingFor(date, time).some(
          (w) => w.user_id === user.id,
        )
      : false;

  // ----------------------------------------------------------
  // HORSE USAGE
  // ----------------------------------------------------------

  const horseUsageForDay = (
    horseId: string,
    date: Date,
  ) => {
    const dateISO = formatDateISO(date);

    return assignments.filter(
      (a) =>
        a.horse_id === horseId &&
        a.slot_date === dateISO,
    ).length;
  };

  // ----------------------------------------------------------
  // HORSE SELECTION WINDOW
  //
  // Only:
  // TODAY
  // 00:00 - 20:59
  // Europe/Vilnius
  // ----------------------------------------------------------

  const canSelectHorse = (date: Date) => {
    const now = new Date();

    const todayISO = new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Europe/Vilnius",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(now);

    const dateISO = formatDateISO(date);

    if (todayISO !== dateISO) {
      return false;
    }

    const vilniusTime =
      new Intl.DateTimeFormat(
        "en-GB",
        {
          timeZone: "Europe/Vilnius",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        },
      ).format(now);

    return vilniusTime < "21:00";
  };

  const isTodayVilnius = (date: Date) => {
    const todayISO = new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Europe/Vilnius",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).format(new Date());

    return formatDateISO(date) === todayISO;
  };

  // ----------------------------------------------------------
  // BOOKING
  //
  // This still happens immediately.
  // Horse is NOT selected here.
  // ----------------------------------------------------------

  const handleBook = async (
    date: Date,
    time: string,
  ) => {
    if (!user) {
      toast.error(
        "Prisijunkite, kad užsiregistruotumėte",
      );
      return;
    }

    if (
      date.getTime() <
      new Date().setHours(0, 0, 0, 0)
    ) {
      toast.error(
        "Negalima registruotis į praeities pamokas",
      );
      return;
    }

    if (getDayCancellation(date)) {
      toast.error(
        "Šią dieną treniruotės nevyksta",
      );
      return;
    }

    const key = `book-${formatDateISO(date)}-${time}`;

    const slotForBooking =
      getSlotsAtTime(date, time)[0];

    setBusy(key);

    const { error } = await supabase
      .from("bookings")
      .insert({
        user_id: user.id,
        slot_date: formatDateISO(date),
        slot_time: time,
        status: "active",
        trainer_name:
          slotForBooking?.trainer_name ?? null,
      });

    setBusy(null);

    if (error) {
      toast.error(
        error.code === "23505"
          ? "Jūs jau užregistruoti į šią pamoką"
          : /pradedant|Grupė/i.test(
                error.message,
              )
            ? error.message
            : "Klaida: " + error.message,
      );
      return;
    }

    setBookingSuccess({
      date,
      time,
    });

    toast.success(
      language === "lt"
        ? "Pamoka sėkmingai užregistruota!"
        : "Your lesson is booked!",
    );

    await loadData();
  };

  // ----------------------------------------------------------
  // HORSE SELECTION
  // ----------------------------------------------------------

  const selectHorse = async () => {
    if (!horseDialog || !selectedHorseId) {
      return;
    }

    setHorseBusy(true);

    const { error } = await supabase.rpc(
      "select_horse_for_booking",
      {
        _booking_id: horseDialog.bookingId,
        _horse_id: selectedHorseId,
      },
    );

    setHorseBusy(false);

    if (error) {
      if (
        error.message.includes(
          "HORSE_LIMIT_REACHED",
        )
      ) {
        toast.error(
          "Šis žirgas jau pasiekė 2 jojimų dienos limitą.",
        );
      } else if (
        error.message.includes(
          "HORSE_SELECTION_CLOSED",
        )
      ) {
        toast.error(
          "Žirgo pasirinkimas baigėsi 21:00.",
        );
      } else if (
        error.message.includes(
          "HORSE_SELECTION_ONLY_ON_TRAINING_DAY",
        )
      ) {
        toast.error(
          "Žirgą galima pasirinkti tik treniruotės dieną.",
        );
      } else if (
        error.message.includes(
          "horse_assignments_one_horse_per_slot",
        ) ||
        error.message.includes(
          "duplicate key value violates unique constraint",
        )
      ) {
        toast.error(
          "Šis žirgas jau pasirinktas šiam laikui. Pasirinkite kitą žirgą.",
        );
      } else if (
        error.message.includes(
          "HORSE_NOT_AVAILABLE",
        )
      ) {
        toast.error(
          "Šis žirgas šiuo metu nepasiekiamas.",
        );
      } else {
        toast.error(error.message);
      }

      await loadData();
      return;
    }

    toast.success("Žirgas pasirinktas!");

    setHorseDialog(null);
    setSelectedHorseId("");

    await loadData();
  };

  const openHorseDialog = (
    booking: Booking,
    date: Date,
    time: string,
  ) => {
    const existing =
      getHorseAssignment(booking);

    setHorseDialog({
      bookingId: booking.id,
      date,
      time,
    });

    setSelectedHorseId(
      existing?.horse_id ?? "",
    );
  };

  // ----------------------------------------------------------
  // WAITING LIST
  // ----------------------------------------------------------

  const handleJoinWaiting = async (
    date: Date,
    time: string,
  ) => {
    if (!user) {
      toast.error("Pirma prisijunkite");
      return;
    }

    const key = `wait-${formatDateISO(date)}-${time}`;

    setBusy(key);

    const { error } = await supabase
      .from("waiting_list")
      .insert({
        user_id: user.id,
        slot_date: formatDateISO(date),
        slot_time: time,
      });

    setBusy(null);

    if (error) {
      toast.error(
        error.code === "23505"
          ? "Jau esate laukiančiųjų sąraše"
          : error.message,
      );
      return;
    }

    toast.success(
      "Pridėta į laukiančiųjų sąrašą",
    );

    await loadData();
  };

  const handleLeaveWaiting = async (
    date: Date,
    time: string,
  ) => {
    if (!user) return;

    const entry = getWaitingFor(
      date,
      time,
    ).find(
      (w) => w.user_id === user.id,
    );

    if (!entry) return;

    const { error } = await supabase
      .from("waiting_list")
      .delete()
      .eq("id", entry.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      "Pašalinta iš laukiančiųjų",
    );

    await loadData();
  };

  // ----------------------------------------------------------
  // CANCELLATION
  // ----------------------------------------------------------

  const cancelSingleBooking = async (
    booking: Booking,
  ) => {
    const { data, error } =
      await supabase.rpc(
        "cancel_booking_occurrence" as any,
        {
          _booking_id: booking.id,
        } as any,
      );

    if (error) {
      toast.error(
        `Nepavyko atšaukti: ${error.message}`,
      );
      await loadData();
      return;
    }

    const result = (data ?? {}) as {
      ok?: boolean;
      message?: string;
    };

    if (!result.ok) {
      toast.error(
        result.message ??
          "Nepavyko atšaukti treniruotės.",
      );
      await loadData();
      return;
    }

    setBookings((current) =>
      current.filter(
        (b) => b.id !== booking.id,
      ),
    );

    toast.success("Pamoka atšaukta");

    await loadData();
  };

  const removePermanentForever = async (
    booking: Booking,
  ) => {
    if (!user) return;

    const dow = dbDayOfWeek(
      new Date(
        `${booking.slot_date}T${booking.slot_time}`,
      ),
    );

    const { data, error } =
      await supabase.rpc(
        "remove_permanent_slot" as any,
        {
          _user_id: booking.user_id,
          _day_of_week: dow,
          _slot_time: booking.slot_time,
          _from_date: booking.slot_date,
        } as any,
      );

    if (error) {
      toast.error(error.message);
      return;
    }

    const res = (data ?? {}) as {
      deleted_slots?: number;
      cancelled_bookings?: number;
    };

    if (!res.deleted_slots) {
      toast.error(
        "Nuolatinio laiko įrašas nerastas",
      );
      return;
    }

    setBookings((current) =>
      current.filter(
        (b) =>
          !(
            b.user_id === booking.user_id &&
            b.slot_time ===
              booking.slot_time &&
            b.slot_date >=
              booking.slot_date &&
            dbDayOfWeek(
              new Date(
                `${b.slot_date}T${b.slot_time}`,
              ),
            ) === dow
          ),
      ),
    );

    setPermanents((current) =>
      current.filter(
        (p) =>
          !(
            p.user_id === booking.user_id &&
            p.day_of_week === dow &&
            p.slot_time.slice(0, 5) ===
              booking.slot_time.slice(0, 5)
          ),
      ),
    );

    toast.success(
      `Nuolatinis laikas pašalintas. Atšaukta būsimų pamokų: ${res.cancelled_bookings ?? 0}.`,
    );

    await loadData();
  };

  const handleCancelClick = async (
    booking: Booking,
  ) => {
    const perm =
      isPermanentBooking(booking);

    const hours = hoursUntil(
      booking.slot_date,
      booking.slot_time,
    );

    if (perm) {
      setPermCancelDialog({ booking });
      return;
    }

    if (hours > 24) {
      setConfirmDialog({
        title: "Atšaukti pamoką?",
        description:
          "Pamoka bus pažymėta kaip atšaukta.",
        onConfirm: () =>
          cancelSingleBooking(booking),
      });
    } else {
      setCancelDialog({ booking });
      setCancelReason("");
      setCancelSickness(false);
      setCancelFile(null);
    }
  };

  const submitLateCancel = async () => {
    if (!cancelDialog || !user) return;

    if (
      !cancelSickness &&
      cancelReason.trim().length < 3
    ) {
      toast.error(
        "Įveskite atšaukimo priežastį",
      );
      return;
    }

    const {
      data: cancelResultRaw,
      error: e1,
    } = await supabase.rpc(
      "cancel_booking_occurrence" as any,
      {
        _booking_id:
          cancelDialog.booking.id,
      } as any,
    );

    if (e1) {
      toast.error(
        `Nepavyko atšaukti: ${e1.message}`,
      );
      await loadData();
      return;
    }

    const cancelResult =
      (cancelResultRaw ?? {}) as {
        ok?: boolean;
        message?: string;
      };

    if (!cancelResult.ok) {
      toast.error(
        cancelResult.message ??
          "Nepavyko atšaukti treniruotės.",
      );
      await loadData();
      return;
    }

    setBookings((current) =>
      current.filter(
        (b) =>
          b.id !== cancelDialog.booking.id,
      ),
    );

    let documentUrl: string | null = null;
    let documentDeadline: string | null = null;

    if (cancelSickness) {
      const d = new Date();
      d.setDate(d.getDate() + 7);

      documentDeadline =
        formatDateISO(d);

      if (cancelFile) {
        setCancelUploading(true);

        const ext =
          cancelFile.name.split(".").pop() ||
          "bin";

        const path = `${user.id}/${cancelDialog.booking.id}-${Date.now()}.${ext}`;

        const { error: upErr } =
          await supabase.storage
            .from("cancellation-docs")
            .upload(path, cancelFile);

        setCancelUploading(false);

        if (upErr) {
          toast.error(
            "Failo įkėlimas: " +
              upErr.message,
          );
          return;
        }

        documentUrl = path;
      }
    }

    const { error: e2 } =
      await supabase
        .from("cancellation_requests")
        .insert({
          booking_id:
            cancelDialog.booking.id,
          user_id: user.id,
          reason: cancelSickness
            ? "Liga"
            : cancelReason.trim(),
          sickness: cancelSickness,
          status: "pending",
          admin_decision_counts: null,
          document_url: documentUrl,
          document_uploaded_at:
            documentUrl
              ? new Date().toISOString()
              : null,
          document_deadline:
            documentDeadline,
        } as any);

    if (e2) {
      toast.error(e2.message);
      return;
    }

    toast.success(
      cancelSickness
        ? cancelFile
          ? "Atšaukta. Pažyma įkelta — laukia administracijos."
          : "Atšaukta. Iki 7 d. pridėkite pažymą paskyroje."
        : "Atšaukta. Laukia administracijos sprendimo.",
    );

    setCancelDialog(null);
    setCancelFile(null);

    await loadData();
  };

  // ----------------------------------------------------------
  // ADMIN SLOT MANAGEMENT
  // ----------------------------------------------------------

  const adminAddOneSeat = async (
    date: Date,
    time: string,
    currentCap: number,
  ) => {
    const dateISO = formatDateISO(date);

    const existing = overrides.find(
      (o) =>
        o.slot_date === dateISO &&
        o.slot_time === time,
    );

    if (existing) {
      const { error } = await supabase
        .from("slot_overrides")
        .update({
          max_capacity:
            existing.max_capacity + 1,
        })
        .eq("slot_date", dateISO)
        .eq("slot_time", time);

      if (error) {
        toast.error(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("slot_overrides")
        .insert({
          slot_date: dateISO,
          slot_time: time,
          max_capacity: currentCap + 1,
        });

      if (error) {
        toast.error(error.message);
        return;
      }
    }

    toast.success("Vieta pridėta (+1)");
    await loadData();
  };

  const adminRemoveOverride = async (
    date: Date,
    time: string,
  ) => {
    const dateISO = formatDateISO(date);

    const { error } = await supabase
      .from("slot_overrides")
      .delete()
      .eq("slot_date", dateISO)
      .eq("slot_time", time);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      "Papildoma vieta pašalinta",
    );

    await loadData();
  };

  const adminCreateCustomSlot =
    async () => {
      if (!customSlotDialog) return;

      const t =
        customSlotTime.trim();

      if (!isValidTime(t)) {
        toast.error(
          "Įveskite teisingą laiką (HH:MM)",
        );
        return;
      }

      if (
        customSlotCap < 1 ||
        customSlotCap > 30
      ) {
        toast.error("Talpa 1–30");
        return;
      }

      setCustomBusy(true);

      const dateISO =
        formatDateISO(
          customSlotDialog.date,
        );

      const { error } =
        await supabase
          .from("time_slots")
          .insert({
            day_of_week:
              dbDayOfWeek(
                customSlotDialog.date,
              ),
            slot_time: `${t}:00`,
            max_capacity:
              customSlotCap,
            active: true,
            one_off_date: dateISO,
          } as any);

      setCustomBusy(false);

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success(
        `Pridėtas laikas ${t} (${dateISO})`,
      );

      setCustomSlotDialog(null);
      setCustomSlotTime("");
      setCustomSlotCap(6);

      await loadData();
    };

  const adminAddUserToSlot = async (
    date: Date,
    time: string,
    userId: string,
    force = false,
  ) => {
    if (!userId) {
      toast.error("Pasirinkite vartotoją");
      return;
    }

    const slot = slots.find(
      (s) =>
        s.slot_time === time &&
        (
          s.one_off_date ===
            formatDateISO(date) ||
          s.day_of_week ===
            dbDayOfWeek(date)
        ),
    );

    const isJolitaSlot =
      !!slot?.trainer_name &&
      slot.trainer_name
        .toLowerCase()
        .includes("jolita");

    if (
      isJolitaSlot &&
      slot &&
      !force
    ) {
      const reason = blockReason(
        slotLevels(
          date,
          time,
          slot,
        ),
        levelOf(
          allProfiles.find(
            (p) => p.id === userId,
          )?.riding_level,
        ),
        Math.min(
          4,
          getCapacity(
            date,
            time,
            slot.max_capacity,
          ),
        ),
      );

      if (reason) {
        setForcePrompt({
          date,
          time,
          userId,
          reason,
        });

        toast.error(reason);
        return;
      }
    }

    setAdminBusy(true);

    const { error } = await supabase
      .from("bookings")
      .insert({
        user_id: userId,
        slot_date: formatDateISO(date),
        slot_time: time,
        status: "active",
        trainer_name:
          slot?.trainer_name ?? null,
      });

    setAdminBusy(false);

    if (error) {
      toast.error(
        error.code === "23505"
          ? "Vartotojas jau užregistruotas"
          : error.message,
      );
      return;
    }

    toast.success("Pridėta");
    setAdminAddUserId("");
    setForcePrompt(null);

    await loadData();
  };

  const adminAddGuest = async (
    date: Date,
    time: string,
    guestRiderId: string,
    displayName: string,
  ) => {
    if (!user) return;

    const slot =
      getSlotsAtTime(date, time)[0];

    setAdminBusy(true);

    const { error } = await supabase
      .from("bookings")
      .insert({
        user_id: null,
        slot_date: formatDateISO(date),
        slot_time: time,
        status: "active",
        is_guest: true,
        guest_rider_id: guestRiderId,
        guest_name: displayName,
        counts_in_subscription: false,
        trainer_name:
          slot?.trainer_name ?? null,
        created_by: user.id,
      } as any);

    setAdminBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      `Pridėta naujokė: ${displayName}`,
    );

    setGuestDialogOpen(false);

    await loadData();
  };

  const adminAddIndividual = async (
    date: Date,
    time: string,
    userId: string,
  ) => {
    if (!userId) {
      toast.error("Pasirinkite vartotoją");
      return;
    }

    const slot =
      getSlotsAtTime(date, time)[0];

    setAdminBusy(true);

    const { error } =
      await supabase
        .from("bookings")
        .insert({
          user_id: userId,
          slot_date: formatDateISO(date),
          slot_time: time,
          status: "active",
          is_individual: true,
          trainer_name:
            slot?.trainer_name ?? null,
        } as any);

    setAdminBusy(false);

    if (error) {
      toast.error(
        error.code === "23505"
          ? "Vartotojas jau užregistruotas šiuo laiku"
          : error.message,
      );
      return;
    }

    toast.success(
      "Individuali pridėta",
    );

    setAdminAddUserId("");

    await loadData();
  };

  const adminRemoveBooking = async (
    bookingId: string,
  ) => {
    setAdminBusy(true);

    const { data, error } =
      await supabase
        .from("bookings")
        .update({
          status: "cancelled",
        })
        .eq("id", bookingId)
        .select("id");

    setAdminBusy(false);

    if (error) {
      toast.error(
        `Nepavyko pašalinti: ${error.message}`,
      );
      await loadData();
      return;
    }

    if (!data || data.length === 0) {
      toast.error(
        "Nepavyko pašalinti — neturite teisių arba pamoka jau pakeista.",
      );
      await loadData();
      return;
    }

    setBookings((current) =>
      current.filter(
        (b) => b.id !== bookingId,
      ),
    );

    toast.success("Pašalinta");

    await loadData();
  };

  // ----------------------------------------------------------
  // NOTES
  // ----------------------------------------------------------

  const addDayNote = async () => {
    if (!user) {
      toast.error("Pirma prisijunkite");
      return;
    }

    if (!notesDialog) return;

    const link =
      newNoteLink.trim();

    if (
      !/^https?:\/\//i.test(link)
    ) {
      toast.error(
        "Įveskite pilną nuorodą (https://...)",
      );
      return;
    }

    setNoteBusy(true);

    const { error } =
      await supabase
        .from("day_notes")
        .insert({
          note_date:
            formatDateISO(
              notesDialog.date,
            ),
          link,
          label:
            newNoteLabel.trim() ||
            null,
          added_by: user.id,
        });

    setNoteBusy(false);

    if (error) {
      if (
        error.message.includes(
          "MAX_15_LINKS_REACHED",
        )
      ) {
        toast.error(
          "Pasiekta 15 nuorodų riba",
        );
      } else {
        toast.error(error.message);
      }
      return;
    }

    setNewNoteLink("");
    setNewNoteLabel("");

    toast.success("Pridėta");

    await loadData();
  };

  const removeDayNote = async (
    id: string,
  ) => {
    const { error } =
      await supabase
        .from("day_notes")
        .delete()
        .eq("id", id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Pašalinta");

    await loadData();
  };

  const getDayNotes = (date: Date) =>
    dayNotes.filter(
      (n) =>
        n.note_date ===
        formatDateISO(date),
    );

  const getDayCancellation = (
    date: Date,
  ) =>
    dayCancellations.find(
      (c) =>
        c.note_date ===
        formatDateISO(date),
    ) ?? null;

  const getSlotNote = (
    date: Date,
    time: string | null,
  ): SlotNote | null => {
    const iso =
      formatDateISO(date);

    const t = time
      ? time.slice(0, 8)
      : null;

    return (
      slotNotes.find(
        (n) =>
          n.note_date === iso &&
          (n.slot_time ?? null) ===
            t,
      ) ?? null
    );
  };

  const getWeeklyNotes = (
    date: Date,
    time: string | null = null,
  ): SlotNote[] => {
    const dow =
      dbDayOfWeek(date);

    const t = time
      ? time.slice(0, 8)
      : null;

    return weeklyNotes.filter(
      (n) =>
        n.day_of_week === dow &&
        (n.slot_time ?? null) ===
          t,
    );
  };

  const openSlotNoteDialog = (
    date: Date,
    time: string | null,
  ) => {
    const existing =
      getSlotNote(date, time);

    setSlotNoteDialog({
      date,
      time,
    });

    setSlotNoteText(
      existing?.note ?? "",
    );

    setSlotNoteRecurrence("once");
  };

  const saveSlotNote = async () => {
    if (
      !slotNoteDialog ||
      !user
    ) {
      return;
    }

    const text =
      slotNoteText.trim();

    if (!text) {
      toast.error(
        "Įveskite žinutę",
      );
      return;
    }

    setSlotNoteBusy(true);

    const existing =
      getSlotNote(
        slotNoteDialog.date,
        slotNoteDialog.time,
      );

    let error;

    if (
      slotNoteRecurrence ===
      "weekly"
    ) {
      ({ error } = await supabase
        .from("slot_notes" as any)
        .insert({
          note_date:
            formatDateISO(
              slotNoteDialog.date,
            ),
          slot_time:
            slotNoteDialog.time
              ? slotNoteDialog.time.slice(
                  0,
                  8,
                )
              : null,
          note: text,
          created_by: user.id,
          recurrence: "weekly",
          day_of_week:
            dbDayOfWeek(
              slotNoteDialog.date,
            ),
        } as any));
    } else if (existing) {
      ({ error } =
        await supabase
          .from("slot_notes" as any)
          .update({
            note: text,
          })
          .eq("id", existing.id));
    } else {
      ({ error } =
        await supabase
          .from("slot_notes" as any)
          .insert({
            note_date:
              formatDateISO(
                slotNoteDialog.date,
              ),
            slot_time:
              slotNoteDialog.time
                ? slotNoteDialog.time.slice(
                    0,
                    8,
                  )
                : null,
            note: text,
            created_by: user.id,
            recurrence: "once",
          } as any));
    }

    setSlotNoteBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      "Žinutė išsaugota",
    );

    setSlotNoteDialog(null);
    setSlotNoteText("");

    await loadData();
  };

  const deleteWeeklyNote = async (
    id: string,
  ) => {
    const { error } =
      await supabase
        .from("slot_notes" as any)
        .delete()
        .eq("id", id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      "Nuolatinė žinutė pašalinta",
    );

    await loadData();
  };

  const deleteSlotNote = async () => {
    if (!slotNoteDialog) return;

    const existing =
      getSlotNote(
        slotNoteDialog.date,
        slotNoteDialog.time,
      );

    if (!existing) {
      setSlotNoteDialog(null);
      return;
    }

    setSlotNoteBusy(true);

    const { error } =
      await supabase
        .from("slot_notes" as any)
        .delete()
        .eq("id", existing.id);

    setSlotNoteBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      "Žinutė pašalinta",
    );

    setSlotNoteDialog(null);
    setSlotNoteText("");

    await loadData();
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthNames =
    language === "lt"
      ? MONTHS_LT
      : [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];

  const weekdayNames =
    language === "lt"
      ? WEEKDAYS_LT
      : [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ];

  const weekdayShort =
    language === "lt"
      ? WEEKDAYS_LT_SHORT
      : [
          "Mon",
          "Tue",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
          "Sun",
        ];

  const sameMonth =
    weekStart.getMonth() ===
    weekEnd.getMonth();

  const rangeLabel = sameMonth
    ? `${weekStart.getDate()}–${weekEnd.getDate()} ${monthNames[weekStart.getMonth()]} ${weekStart.getFullYear()}`
    : `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]} – ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

  return (
    <div className="container max-w-[1400px] py-8 sm:py-14 relative">
      <FloralAccent
        className="absolute -top-8 -left-12 hidden md:block"
        size={180}
        delay={0.2}
        rotate={-15}
      />

      <FloralAccent
        className="absolute top-32 -right-16 hidden md:block"
        size={150}
        delay={0.5}
        rotate={20}
      />

      <HorseFlourish
        className="absolute top-4 right-4 sm:right-12"
        size={70}
      />

      <motion.header
        initial={{
          opacity: 0,
          y: 14,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        transition={{
          duration: 0.9,
          ease: [
            0.22,
            1,
            0.36,
            1,
          ],
        }}
        className="text-center mb-10 relative"
      >
        <p className="text-xs uppercase tracking-[0.3em] text-gold/70 mb-3">
          {t("school")}
        </p>

        <h1 className="text-4xl sm:text-6xl font-display text-gradient-gold leading-tight mb-3">
          {t("horseFreedom")}
        </h1>

        <div className="gold-divider max-w-[140px] mx-auto" />
      </motion.header>

      <VacationBanner
        userId={user?.id ?? null}
      />

      {/* Week navigation */}
      <div className="flex items-center justify-between gap-3 mb-6 sm:mb-8 flex-wrap">
        <div className="flex items-center gap-2 rounded-md border border-gold/20 bg-card/40 px-2 py-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setWeekStart(
                addDays(
                  weekStart,
                  -7,
                ),
              )
            }
            aria-label={t(
              "previousWeek",
            )}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="font-display text-base sm:text-lg text-gradient-gold capitalize px-2 min-w-[180px] text-center">
            {rangeLabel}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setWeekStart(
                addDays(
                  weekStart,
                  7,
                ),
              )
            }
            aria-label={t(
              "nextWeek",
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-gold/20 bg-card/50 p-1">
            <button
              type="button"
              onClick={() =>
                changeCalendarView(
                  "week",
                )
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                calendarView ===
                  "week"
                  ? "bg-gold text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Grid2X2 className="h-3.5 w-3.5" />
              {t("weekView")}
            </button>

            <button
              type="button"
              onClick={() =>
                changeCalendarView(
                  "list",
                )
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                calendarView ===
                  "list"
                  ? "bg-gold text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
              {t("listView")}
            </button>
          </div>

          <Button
            variant="outlineGold"
            size="sm"
            onClick={() => {
              setWeekStart(
                startOfWeek(
                  new Date(),
                ),
              );
              setPendingScrollToToday(
                true,
              );
            }}
          >
            📅 {t("today")}
          </Button>
        </div>
      </div>

      {!user && (
        <div className="mb-6 p-4 bg-gold/5 border border-gold/20 rounded-md text-sm text-center">
          <Link
            to="/auth"
            className="text-gold hover:underline font-medium"
          >
            {t(
              "signInPromptA",
            )}
          </Link>{" "}
          {t(
            "signInPromptB",
          )}{" "}
          <Link
            to="/auth?tab=signup"
            className="text-gold hover:underline font-medium"
          >
            {t(
              "signInPromptC",
            )}
          </Link>{" "}
          {t(
            "signInPromptD",
          )}
        </div>
      )}

      {loading ? (
        <div
          className="space-y-5"
          aria-label={
            language === "lt"
              ? "Kraunamas tvarkaraštis"
              : "Loading schedule"
          }
        >
          <div className="flex gap-3 overflow-hidden sm:grid sm:grid-cols-2 lg:grid-cols-7">
            {Array.from({
              length: 7,
            }).map(
              (_, index) => (
                <div
                  key={index}
                  className="min-w-[84vw] space-y-3 sm:min-w-0"
                >
                  <div className="h-20 animate-pulse rounded-2xl border border-gold/10 bg-card/55" />

                  {Array.from({
                    length:
                      index % 3 ===
                      0
                        ? 3
                        : 2,
                  }).map(
                    (
                      __,
                      cardIndex,
                    ) => (
                      <div
                        key={cardIndex}
                        className="overflow-hidden rounded-2xl border border-gold/10 bg-card/45 p-4"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <div className="h-7 w-20 animate-pulse rounded-md bg-muted/70" />
                          <div className="h-5 w-12 animate-pulse rounded-full bg-muted/60" />
                        </div>

                        <div className="space-y-2">
                          <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
                          <div className="h-3 w-2/3 animate-pulse rounded bg-muted/50" />
                        </div>

                        <div className="mt-5 h-9 w-full animate-pulse rounded-xl bg-muted/60" />
                      </div>
                    ),
                  )}
                </div>
              ),
            )}
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-gold" />
            {language === "lt"
              ? "Ruošiamas savaitės tvarkaraštis…"
              : "Preparing the weekly schedule…"}
          </div>
        </div>
      ) : (
        <AnimatePresence
          mode="wait"
          initial={false}
        >
          <motion.div
            key={`${calendarView}-${formatDateISO(weekStart)}`}
            initial={{
              opacity: 0,
              x:
                calendarView ===
                "week"
                  ? 18
                  : -12,
              scale: 0.995,
            }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
            }}
            exit={{
              opacity: 0,
              x:
                calendarView ===
                "week"
                  ? -12
                  : 12,
              scale: 0.995,
            }}
            transition={{
              duration: 0.32,
              ease: [
                0.22,
                1,
                0.36,
                1,
              ],
            }}
          >
            <div
              className={cn(
                "gap-4 sm:gap-3",
                calendarView ===
                  "week"
                  ? "-mx-4 flex snap-x snap-mandatory overflow-x-auto px-4 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-7"
                  : "mx-auto grid w-full max-w-5xl grid-cols-1 lg:grid-cols-2",
              )}
            >
              {days.map(
                (
                  date,
                  idx,
                ) => {
                  const daySlots =
                    getDaySlots(
                      date,
                    );

                  const isToday =
                    date.getTime() ===
                    today.getTime();

                  const isPast =
                    date.getTime() <
                    today.getTime();

                  const dow =
                    dbDayOfWeek(
                      date,
                    );

                  return (
                    <motion.div
                      key={idx}
                      ref={(el) => {
                        dayRefs.current[
                          idx
                        ] = el;
                      }}
                      initial={{
                        opacity: 0,
                        y: 12,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                      }}
                      transition={{
                        duration: 0.35,
                        delay: Math.min(
                          idx *
                            0.045,
                          0.2,
                        ),
                      }}
                      className={cn(
                        "relative flex flex-col gap-2",
                        calendarView ===
                          "week" &&
                          "min-w-[86vw] snap-center sm:min-w-0",
                        calendarView ===
                          "list" &&
                          "rounded-3xl border border-gold/10 bg-card/25 p-3 shadow-sm sm:p-4",
                        isPast &&
                          "opacity-60",
                        isToday &&
                          "sm:p-0 p-3 -mx-1 rounded-xl bg-gold/[0.06] ring-2 ring-gold/40 shadow-gold sm:bg-transparent sm:ring-0 sm:shadow-none sm:m-0",
                      )}
                    >
                      {idx > 0 && (
                        <div
                          aria-hidden
                          className="sm:hidden flex items-center justify-center -mt-1 mb-3 select-none"
                        >
                          <div className="flex-1 h-[2px] bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
                          <div className="px-3 font-display text-gold/70 text-sm tracking-widest">
                            ◆
                          </div>
                          <div className="flex-1 h-[2px] bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
                        </div>
                      )}

                      {/* Day header */}
                      <div
                        className={cn(
                          "relative rounded-2xl border px-4 py-3.5 bg-gradient-card shadow-sm",
                          isToday
                            ? "border-gold/60 shadow-gold sm:shadow-none"
                            : "border-gold/15",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-1">
                          <div
                            className={cn(
                              "uppercase tracking-[0.18em] text-gold font-bold",
                              isToday
                                ? "text-base sm:text-[11px]"
                                : "text-sm sm:text-[11px]",
                            )}
                          >
                            <span className="sm:hidden xl:inline">
                              {
                                weekdayNames[
                                  idx
                                ]
                              }
                            </span>

                            <span className="hidden sm:inline xl:hidden">
                              {
                                weekdayShort[
                                  idx
                                ]
                              }
                            </span>
                          </div>

                          {isToday && (
                            <span className="text-[10px] sm:text-[9px] uppercase tracking-[0.15em] font-bold text-background bg-gold px-2 py-0.5 rounded-sm">
                              {t(
                                "today",
                              )}
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline justify-between gap-2 mt-1.5">
                          <div className="font-display text-2xl text-gradient-gold leading-none tabular-nums">
                            {String(
                              date.getMonth() +
                                1,
                            ).padStart(
                              2,
                              "0",
                            )}
                            .
                            {String(
                              date.getDate(),
                            ).padStart(
                              2,
                              "0",
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setNotesDialog(
                                {
                                  date,
                                },
                              );
                              setNewNoteLink(
                                "",
                              );
                              setNewNoteLabel(
                                "",
                              );
                            }}
                            className="relative inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold border border-gold/20 hover:border-gold/50 rounded px-1.5 py-0.5 transition-colors"
                          >
                            <FileText className="w-3 h-3" />

                            <span>
                              {t("video")}
                            </span>

                            {getDayNotes(
                              date,
                            ).length >
                              0 && (
                              <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-gold text-background text-[9px] font-bold px-1">
                                {
                                  getDayNotes(
                                    date,
                                  ).length
                                }
                              </span>
                            )}
                          </button>
                        </div>

                        {isAdmin &&
                          !isPast && (
                            <button
                              type="button"
                              onClick={() => {
                                setCustomSlotDialog(
                                  {
                                    date,
                                  },
                                );
                                setCustomSlotTime(
                                  "",
                                );
                                setCustomSlotCap(
                                  6,
                                );
                              }}
                              className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold border border-dashed border-gold/30 hover:border-gold/60 rounded px-1.5 py-1 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              {t(
                                "newTime",
                              )}
                            </button>
                          )}

                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() =>
                              openSlotNoteDialog(
                                date,
                                null,
                              )
                            }
                            className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold border border-dashed border-gold/30 hover:border-gold/60 rounded px-1.5 py-1 transition-colors"
                          >
                            <MessageSquare className="w-3 h-3" />
                            {getSlotNote(
                              date,
                              null,
                            )
                              ? t(
                                  "editMessage",
                                )
                              : t(
                                  "dayMessage",
                                )}
                          </button>
                        )}

                        {isAdmin &&
                          !isPast &&
                          !getDayCancellation(
                            date,
                          ) && (
                            <button
                              type="button"
                              onClick={async () => {
                                const note =
                                  window.prompt(
                                    "Priežastis (nebūtina):",
                                    "",
                                  ) ?? "";

                                const {
                                  error,
                                } =
                                  await supabase
                                    .from(
                                      "day_cancellations" as any,
                                    )
                                    .insert({
                                      note_date:
                                        formatDateISO(
                                          date,
                                        ),
                                      note:
                                        note.trim() ||
                                        null,
                                    });

                                if (error) {
                                  toast.error(
                                    error.message,
                                  );
                                  return;
                                }

                                toast.success(
                                  "Diena atšaukta. Visi tos dienos rezervavimai atšaukti.",
                                );

                                await loadData();
                              }}
                              className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-blush/80 hover:text-blush border border-dashed border-blush/30 hover:border-blush/60 rounded px-1.5 py-1 transition-colors"
                            >
                              <MessageSquare className="w-3 h-3" />
                              {t(
                                "cancelDay",
                              )}
                            </button>
                          )}
                      </div>

                      {getWeeklyNotes(
                        date,
                      ).map(
                        (wn) => (
                          <div
                            key={wn.id}
                            className="rounded-md border border-gold/25 bg-gold/8 px-3 py-2 text-xs italic text-foreground/80 leading-snug whitespace-pre-wrap"
                          >
                            {wn.note}
                          </div>
                        ),
                      )}

                      {(() => {
                        const dn =
                          getSlotNote(
                            date,
                            null,
                          );

                        if (!dn)
                          return null;

                        return (
                          <div className="rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-xs italic text-foreground/85 leading-snug whitespace-pre-wrap">
                            {dn.note}
                          </div>
                        );
                      })()}

                      {(() => {
                        const cancelled =
                          getDayCancellation(
                            date,
                          );

                        if (!cancelled)
                          return null;

                        return (
                          <>
                            <div className="rounded-md border border-blush/40 bg-blush/10 px-3 py-6 text-xs text-blush text-center italic font-semibold">
                              {t(
                                "lessonsCancelled",
                              )}

                              {cancelled.note && (
                                <div className="mt-1 text-foreground/70 not-italic font-normal">
                                  {
                                    cancelled.note
                                  }
                                </div>
                              )}
                            </div>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const {
                                    error,
                                  } =
                                    await supabase
                                      .from(
                                        "day_cancellations" as any,
                                      )
                                      .delete()
                                      .eq(
                                        "note_date",
                                        formatDateISO(
                                          date,
                                        ),
                                      );

                                  if (error) {
                                    toast.error(
                                      error.message,
                                    );
                                    return;
                                  }

                                  toast.success(
                                    "Diena grąžinta į tvarkaraštį",
                                  );

                                  await loadData();
                                }}
                                className="mt-1 w-full text-[10px] uppercase tracking-wider text-gold/80 hover:text-gold border border-dashed border-gold/30 hover:border-gold/60 rounded px-1.5 py-1"
                              >
                                Grąžinti dieną
                              </button>
                            )}
                          </>
                        );
                      })()}

                      {!getDayCancellation(
                        date,
                      ) &&
                        daySlots.length ===
                          0 && (
                          <div className="rounded-2xl border border-dashed border-gold/15 bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
                            {dow === 7
                              ? t(
                                  "individual",
                                )
                              : t(
                                  "noLessons",
                                )}
                          </div>
                        )}

                      {!getDayCancellation(
                        date,
                      ) &&
                        daySlots.map(
                          (
                            slot,
                          ) => {
                            const slotBookings =
                              getSlotBookings(
                                date,
                                slot.slot_time,
                                slot,
                              );

                            const group =
                              getGroupInfo(
                                date,
                                slot.slot_time,
                                slot,
                              );

                            const cap =
                              group.capacity;

                            const isFull =
                              group.taken >=
                              cap;

                            const myBooking =
                              slotBookings.find(
                                (
                                  b,
                                ) =>
                                  isMyBooking(
                                    b,
                                  ),
                              );

                            const slotWaiting =
                              getWaitingFor(
                                date,
                                slot.slot_time,
                              );

                            const iAmWaiting =
                              amIWaiting(
                                date,
                                slot.slot_time,
                              );

                            const slotPast =
                              new Date(
                                `${formatDateISO(date)}T${slot.slot_time}`,
                              ).getTime() <
                              Date.now();

                            return (
                              <div
                                key={slot.id}
                                className={cn(
                                  "group overflow-hidden rounded-2xl border bg-gradient-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg",
                                  myBooking
                                    ? "border-gold/50"
                                    : "border-gold/15 hover:border-gold/30",
                                )}
                              >
                                {/* Slot header */}
                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gold/10">
                                  <div className="flex items-center gap-1.5">
                                    <Clock className="w-4 h-4 text-gold/60" />

                                    <span className="font-display text-xl sm:text-2xl tabular-nums text-foreground">
                                      {formatTime(
                                        slot.slot_time,
                                      )}
                                    </span>

                                    {slot.trainer_name && (
                                      <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gold">
                                        Trenerė:{" "}
                                        {
                                          slot.trainer_name
                                        }
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <AvailabilityBadge
                                      taken={
                                        group.taken
                                      }
                                      capacity={
                                        cap
                                      }
                                    />

                                    {slotWaiting.length >
                                      0 && (
                                      <Popover>
                                        <PopoverTrigger
                                          asChild
                                        >
                                          <button
                                            type="button"
                                            className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-blush/20 text-blush border border-blush/30 text-[10px] font-bold px-1 animate-pulse cursor-pointer hover:bg-blush/30 transition-colors"
                                          >
                                            {
                                              slotWaiting.length
                                            }
                                          </button>
                                        </PopoverTrigger>

                                        <PopoverContent className="w-56 bg-gradient-card border-gold/20 p-3">
                                          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                                            Laukiančiųjų sąrašas
                                          </div>

                                          <ul className="space-y-1">
                                            {slotWaiting.map(
                                              (
                                                w,
                                                i,
                                              ) => (
                                                <li
                                                  key={
                                                    w.id
                                                  }
                                                  className="flex items-center gap-2 text-sm"
                                                >
                                                  <span className="text-gold/60 text-xs">
                                                    {i +
                                                      1}
                                                    .
                                                  </span>

                                                  <span className="truncate">
                                                    {w.profile_name ??
                                                      "—"}
                                                  </span>
                                                </li>
                                              ),
                                            )}
                                          </ul>
                                        </PopoverContent>
                                      </Popover>
                                    )}

                                    {isAdmin &&
                                      !slotPast && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            adminAddOneSeat(
                                              date,
                                              slot.slot_time,
                                              cap,
                                            )
                                          }
                                          className="ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-gold/30 text-gold hover:bg-gold/10 transition-colors text-[11px] leading-none"
                                        >
                                          +1
                                        </button>
                                      )}

                                    {isAdmin &&
                                      !slotPast &&
                                      overrides.some(
                                        (o) =>
                                          o.slot_date ===
                                            formatDateISO(
                                              date,
                                            ) &&
                                          o.slot_time ===
                                            slot.slot_time,
                                      ) && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            adminRemoveOverride(
                                              date,
                                              slot.slot_time,
                                            )
                                          }
                                          className="ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-blush/40 text-blush hover:bg-blush/10 transition-colors text-[11px] leading-none"
                                        >
                                          −1
                                        </button>
                                      )}

                                    {isAdmin &&
                                      !slotPast && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAdminSlotDialog(
                                              {
                                                date,
                                                time: slot.slot_time,
                                                slot,
                                              },
                                            );

                                            setAdminAddUserId(
                                              "",
                                            );
                                          }}
                                          className="ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border border-gold/30 text-gold hover:bg-gold/10 transition-colors text-[11px] leading-none"
                                        >
                                          ⚙
                                        </button>
                                      )}

                                    {isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openSlotNoteDialog(
                                            date,
                                            slot.slot_time,
                                          )
                                        }
                                        className={cn(
                                          "ml-0.5 inline-flex items-center justify-center w-5 h-5 rounded-sm border transition-colors",
                                          getSlotNote(
                                            date,
                                            slot.slot_time,
                                          )
                                            ? "border-gold bg-gold/15 text-gold"
                                            : "border-gold/30 text-gold hover:bg-gold/10",
                                        )}
                                      >
                                        <MessageSquare className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Trainer info */}
                                {group.trainer && (
                                  <div className="mx-3 mt-2 rounded-md border border-gold/20 bg-background/30 px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">
                                    {group.note}
                                    {" · "}
                                    <span className="text-foreground/80">
                                      {group.taken}{" "}
                                      / maks.{" "}
                                      {cap}
                                    </span>
                                  </div>
                                )}

                                {/* Slot note */}
                                {(() => {
                                  const sn =
                                    getSlotNote(
                                      date,
                                      slot.slot_time,
                                    );

                                  if (!sn)
                                    return null;

                                  return (
                                    <div className="mx-3 mt-2 rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs italic text-foreground/85 leading-snug whitespace-pre-wrap">
                                      {sn.note}
                                    </div>
                                  );
                                })()}

                                {/* Booked names */}
                                {slotBookings.length >
                                  0 && (
                                  <ul className="px-3 py-2 space-y-1">
                                    {slotBookings.map(
                                      (
                                        b,
                                      ) => {
                                        const perm =
                                          isPermanentBooking(
                                            b,
                                          );

                                        const mine =
                                          isMyBooking(
                                            b,
                                          );

                                        const horse =
                                          getHorseFor(
                                            b,
                                          );

                                        return (
                                          <motion.li
                                            key={
                                              b.id
                                            }
                                            initial={{
                                              opacity: 0,
                                              x: -4,
                                            }}
                                            animate={{
                                              opacity: 1,
                                              x: 0,
                                            }}
                                            transition={{
                                              duration: 0.25,
                                            }}
                                            className={cn(
                                              "flex items-center gap-1.5 text-base leading-snug",
                                              mine
                                                ? "text-gold"
                                                : "text-foreground/85",
                                              perm &&
                                                "font-bold",
                                            )}
                                          >
                                            <span
                                              className={cn(
                                                "text-sm leading-none",
                                                mine
                                                  ? "text-gold"
                                                  : "text-gold/40",
                                              )}
                                            >
                                              •
                                            </span>

                                            {perm && (
                                              <Star className="w-2.5 h-2.5 text-gold fill-gold flex-shrink-0" />
                                            )}

                                            {(isAdmin ||
                                              isTrainer) &&
                                              slot.trainer_name && (
                                                <RiderLevelBadge
                                                  level={
                                                    b.riding_level
                                                  }
                                                  compact
                                                />
                                              )}

                                            <span
                                              className={cn(
                                                "truncate",
                                                (isAdmin ||
                                                  isTrainer) &&
                                                  "cursor-pointer rounded px-0.5 underline-offset-4 hover:underline",
                                              )}
                                              role={
                                                isAdmin ||
                                                isTrainer
                                                  ? "button"
                                                  : undefined
                                              }
                                              tabIndex={
                                                isAdmin ||
                                                isTrainer
                                                  ? 0
                                                  : undefined
                                              }
                                              onClick={
                                                isAdmin ||
                                                isTrainer
                                                  ? () =>
                                                      setRiderTarget(
                                                        {
                                                          bookingId:
                                                            b.id,
                                                          userId:
                                                            b.user_id,
                                                          name: b.is_guest
                                                            ? b.guest_name ??
                                                              "Svečias"
                                                            : b.profile_name ??
                                                              "—",
                                                          isGuest:
                                                            !!b.is_guest,
                                                          slotDate:
                                                            formatDateISO(
                                                              date,
                                                            ),
                                                          slotTime:
                                                            slot.slot_time,
                                                        },
                                                      )
                                                  : undefined
                                              }
                                            >
                                              {b.is_guest
                                                ? b.guest_name ??
                                                  "Svečias"
                                                : formatBookedName(
                                                    b.profile_name ??
                                                      "—",
                                                    b.display_name,
                                                  )}

                                              {b.is_individual && (
                                                <span className="ml-1 text-[10px] uppercase tracking-wider text-blush/80">
                                                  · individuali
                                                </span>
                                              )}

                                              {horse && (
                                                <span className="ml-1.5 text-[10px] sm:text-[11px] uppercase tracking-wide text-gold/80 font-mono">
                                                  ({horse})
                                                </span>
                                              )}
                                            </span>

                                            {/* USER HORSE SELECTION */}
                                            {mine && (
                                              <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                                                {canSelectHorse(
                                                  date,
                                                ) && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      openHorseDialog(
                                                        b,
                                                        date,
                                                        slot.slot_time,
                                                      )
                                                    }
                                                    className="rounded-md border border-gold/30 px-2 py-1 text-[10px] uppercase tracking-wide text-gold hover:bg-gold/10"
                                                  >
                                                    {horse
                                                      ? "Pakeisti žirgą"
                                                      : "Pasirinkti žirgą"}
                                                  </button>
                                                )}

                                                {!canSelectHorse(
                                                  date,
                                                ) &&
                                                  isTodayVilnius(
                                                    date,
                                                  ) && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                      Žirgų pasirinkimas uždarytas
                                                    </span>
                                                  )}

                                                {!new Date(
                                                  `${formatDateISO(date)}T${slot.slot_time}`,
                                                ).getTime() ||
                                                new Date(
                                                  `${formatDateISO(date)}T${slot.slot_time}`,
                                                ).getTime() >
                                                  Date.now() ? null : null}

                                                {!slotPast && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleCancelClick(
                                                        b,
                                                      )
                                                    }
                                                    className="text-muted-foreground hover:text-destructive transition-colors"
                                                    aria-label="Atšaukti"
                                                  >
                                                    <X className="w-3 h-3" />
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </motion.li>
                                        );
                                      },
                                    )}
                                  </ul>
                                )}

                                {/* Register button */}
                                {!slotPast &&
                                  user &&
                                  !myBooking && (
                                    <div className="px-2 pb-2 pt-1">
                                      {!isFull ? (
                                        <Button
                                          variant="ghostGold"
                                          size="sm"
                                          className="w-full h-8 text-xs"
                                          disabled={
                                            busy ===
                                            `book-${formatDateISO(date)}-${slot.slot_time}`
                                          }
                                          onClick={() =>
                                            handleBook(
                                              date,
                                              slot.slot_time,
                                            )
                                          }
                                        >
                                          + Registruotis
                                        </Button>
                                      ) : iAmWaiting ? (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="w-full h-8 text-[11px]"
                                          onClick={() =>
                                            handleLeaveWaiting(
                                              date,
                                              slot.slot_time,
                                            )
                                          }
                                        >
                                          Iš laukiančiųjų (
                                          {
                                            slotWaiting.findIndex(
                                              (w) =>
                                                w.user_id ===
                                                user.id,
                                            ) + 1
                                          }
                                          )
                                        </Button>
                                      ) : (
                                        <Button
                                          variant="ghostGold"
                                          size="sm"
                                          className="w-full h-8 text-[11px]"
                                          disabled={
                                            busy ===
                                            `wait-${formatDateISO(date)}-${slot.slot_time}`
                                          }
                                          onClick={() =>
                                            handleJoinWaiting(
                                              date,
                                              slot.slot_time,
                                            )
                                          }
                                        >
                                          + Laukiantis{" "}
                                          {slotWaiting.length >
                                            0 &&
                                            `(${slotWaiting.length})`}
                                        </Button>
                                      )}
                                    </div>
                                  )}
                              </div>
                            );
                          },
                        )}
                    </motion.div>
                  );
                },
              )}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gold" />
                Jūsų rezervacija
              </span>

              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full border border-gold/40" />
                Kiti
              </span>

              <span className="flex items-center gap-1.5">
                <Star className="w-3 h-3 fill-gold text-gold" />
                Pastovi vieta
              </span>

              <span className="flex items-center gap-1.5">
                <span className="text-blush">
                  ●
                </span>
                Pilnas / Laukimų sąrašas
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* ===================================================== */}
      {/* HORSE SELECTION DIALOG                                */}
      {/* ===================================================== */}

      <Dialog
        open={!!horseDialog}
        onOpenChange={(open) => {
          if (!open) {
            setHorseDialog(null);
            setSelectedHorseId("");
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-gold/20 bg-gradient-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold">
              Pasirinkite žirgą
            </DialogTitle>

            <DialogDescription>
              {horseDialog &&
                `${formatDateISO(horseDialog.date)} · ${formatTime(horseDialog.time)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {horses.map(
              (horse) => {
                const used =
                  horseDialog
                    ? horseUsageForDay(
                        horse.id,
                        horseDialog.date,
                      )
                    : 0;

                const currentlySelected =
                  selectedHorseId ===
                  horse.id;

                const slotDateISO = horseDialog
                  ? formatDateISO(horseDialog.date)
                  : "";
                const slotTime = horseDialog?.time
                  ? String(horseDialog.time).slice(0, 8)
                  : "";

                // A horse can only be assigned to ONE rider in the exact
                // same date + time slot. The current rider may keep their
                // own existing assignment.
                const alreadyChosenAtThisSlot =
                  !!horseDialog &&
                  assignments.some(
                    (a) =>
                      a.horse_id === horse.id &&
                      a.slot_date === slotDateISO &&
                      String(a.slot_time).slice(0, 8) === slotTime &&
                      a.booking_id !== horseDialog.bookingId,
                  );

                const dailyLimitReached =
                  used >= 2 &&
                  !currentlySelected;

                const unavailable =
                  (dailyLimitReached || alreadyChosenAtThisSlot) &&
                  !currentlySelected;

                return (
                  <button
                    key={horse.id}
                    type="button"
                    disabled={unavailable}
                    onClick={() =>
                      setSelectedHorseId(
                        horse.id,
                      )
                    }
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-colors",
                      currentlySelected
                        ? "border-gold bg-gold/10"
                        : unavailable
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
                          unavailable
                            ? "bg-destructive/10 text-destructive"
                            : "bg-gold/10 text-gold",
                        )}
                      >
                        {used}
                        /2
                      </span>
                    </div>

                    {alreadyChosenAtThisSlot ? (
                      <div className="mt-1 text-[10px] text-destructive">
                        (Šis žirgas jau pasirinktas šiam laikui)
                      </div>
                    ) : dailyLimitReached ? (
                      <div className="mt-1 text-[10px] text-destructive">
                        Dienos limitas pasiektas
                      </div>
                    ) : null}
                  </button>
                );
              },
            )}

            {horses.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aktyvių žirgų nėra.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setHorseDialog(
                  null,
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
                horseBusy
              }
              onClick={
                selectHorse
              }
            >
              {horseBusy
                ? "Išsaugoma…"
                : "Išsaugoti žirgą"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent cancel dialog */}
      <Dialog
        open={!!permCancelDialog}
        onOpenChange={(open) =>
          !open &&
          setPermCancelDialog(
            null,
          )
        }
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-gold/20 bg-gradient-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold flex items-center gap-2">
              <Star className="w-5 h-5 fill-gold text-gold" />
              Nuolatinis laikas
            </DialogTitle>

            <DialogDescription>
              Tai jūsų nuolatinis laikas. Ką norite daryti?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <button
              onClick={() => {
                const b =
                  permCancelDialog!.booking;

                setPermCancelDialog(
                  null,
                );

                const hours =
                  hoursUntil(
                    b.slot_date,
                    b.slot_time,
                  );

                if (hours > 24) {
                  setConfirmDialog({
                    title:
                      "Atšaukti tik šią pamoką?",
                    description:
                      "Nuolatinis laikas išliks ateities savaitėms.",
                    onConfirm: () =>
                      cancelSingleBooking(
                        b,
                      ),
                  });
                } else {
                  setCancelDialog({
                    booking: b,
                  });
                  setCancelReason("");
                  setCancelSickness(
                    false,
                  );
                }
              }}
              className="w-full text-left p-4 rounded-md border border-gold/20 hover:border-gold/50 hover:bg-gold/5 transition-colors"
            >
              <div className="font-medium text-foreground">
                Atšaukti tik šią pamoką
              </div>

              <div className="text-xs text-muted-foreground mt-1">
                Vienkartinis atšaukimas — kitos savaitės liks.
              </div>
            </button>

            <button
              onClick={() => {
                const b =
                  permCancelDialog!.booking;

                setPermCancelDialog(
                  null,
                );

                setConfirmDialog({
                  title:
                    "Pašalinti nuolatinį laiką VISAM laikui?",
                  description:
                    "Visos jūsų būsimos pamokos šiuo laiku bus atšauktos.",
                  onConfirm: () =>
                    removePermanentForever(
                      b,
                    ),
                });
              }}
              className="w-full text-left p-4 rounded-md border border-destructive/20 hover:border-destructive/50 hover:bg-destructive/5 transition-colors"
            >
              <div className="font-medium text-destructive">
                Pašalinti nuolatinį laiką visam laikui
              </div>

              <div className="text-xs text-muted-foreground mt-1">
                Visos būsimos pamokos šiuo laiku bus atšauktos.
              </div>
            </button>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setPermCancelDialog(
                  null,
                )
              }
            >
              Atgal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generic confirm */}
      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) =>
          !open &&
          setConfirmDialog(
            null,
          )
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog?.title}
            </DialogTitle>

            {confirmDialog?.description && (
              <DialogDescription>
                {
                  confirmDialog.description
                }
              </DialogDescription>
            )}
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setConfirmDialog(
                  null,
                )
              }
            >
              Atgal
            </Button>

            <Button
              variant="gold"
              onClick={() => {
                confirmDialog?.onConfirm();
                setConfirmDialog(
                  null,
                );
              }}
            >
              Patvirtinti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slot note dialog */}
      <Dialog
        open={!!slotNoteDialog}
        onOpenChange={(open) => {
          if (!open) {
            setSlotNoteDialog(
              null,
            );
            setSlotNoteText("");
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-gold/20 bg-gradient-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-gradient-gold">
              {slotNoteDialog?.time
                ? `Žinutė — ${formatTime(slotNoteDialog.time)}`
                : "Dienos žinutė"}
            </DialogTitle>

            <DialogDescription>
              {slotNoteDialog
                ? `${formatDateISO(slotNoteDialog.date)} — matoma visiems.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setSlotNoteRecurrence(
                    "once",
                  )
                }
                className={cn(
                  "text-left rounded-md border px-3 py-2 text-xs",
                  slotNoteRecurrence ===
                    "once"
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-gold/20 text-muted-foreground",
                )}
              >
                Tik šiai dienai
              </button>

              <button
                type="button"
                onClick={() =>
                  setSlotNoteRecurrence(
                    "weekly",
                  )
                }
                className={cn(
                  "text-left rounded-md border px-3 py-2 text-xs",
                  slotNoteRecurrence ===
                    "weekly"
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-gold/20 text-muted-foreground",
                )}
              >
                Kas savaitę
              </button>
            </div>

            {slotNoteDialog &&
              getWeeklyNotes(
                slotNoteDialog.date,
                slotNoteDialog.time,
              ).length > 0 && (
                <div className="space-y-1">
                  {getWeeklyNotes(
                    slotNoteDialog.date,
                    slotNoteDialog.time,
                  ).map(
                    (wn) => (
                      <div
                        key={
                          wn.id
                        }
                        className="flex items-start gap-2 rounded border border-gold/15 bg-background/40 px-2 py-1.5 text-xs"
                      >
                        <div className="flex-1 whitespace-pre-wrap italic text-foreground/80">
                          {
                            wn.note
                          }
                        </div>

                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() =>
                            deleteWeeklyNote(
                              wn.id,
                            )
                          }
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ),
                  )}
                </div>
              )}

            <Textarea
              value={slotNoteText}
              onChange={(e) =>
                setSlotNoteText(
                  e.target.value,
                )
              }
              rows={4}
              maxLength={500}
              placeholder="Pvz. Treniruotė vyks lauke..."
            />
          </div>

          <DialogFooter>
            <div>
              {slotNoteDialog &&
                getSlotNote(
                  slotNoteDialog.date,
                  slotNoteDialog.time,
                ) && (
                  <Button
                    variant="ghost"
                    onClick={
                      deleteSlotNote
                    }
                    className="text-destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Pašalinti
                  </Button>
                )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setSlotNoteDialog(
                    null,
                  );
                  setSlotNoteText("");
                }}
              >
                Atgal
              </Button>

              <Button
                variant="gold"
                onClick={
                  saveSlotNote
                }
                disabled={
                  slotNoteBusy
                }
              >
                Išsaugoti
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Late cancel */}
      <Dialog
        open={!!cancelDialog}
        onOpenChange={(open) =>
          !open &&
          setCancelDialog(
            null,
          )
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Atšaukimas{" "}
              <span className="text-base text-blush">
                &lt; 24 val.
              </span>
            </DialogTitle>

            <DialogDescription>
              Slot atsilaisvins iš karto. Administracija nuspręs, ar pamoka skaičiuojama abonemente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md border border-gold/15">
              <Checkbox
                checked={
                  cancelSickness
                }
                onCheckedChange={(
                  value,
                ) =>
                  setCancelSickness(
                    !!value,
                  )
                }
              />

              <div>
                <div className="font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-gold" />
                  Liga
                </div>

                <div className="text-xs text-muted-foreground mt-0.5">
                  Pridėkite gydytojo pažymą.
                </div>
              </div>
            </label>

            {cancelSickness && (
              <div>
                <Label htmlFor="sick-doc">
                  Pridėti pažymą
                </Label>

                <Input
                  id="sick-doc"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,application/pdf,image/*"
                  onChange={(e) =>
                    setCancelFile(
                      e.target.files?.[0] ??
                        null,
                    )
                  }
                />
              </div>
            )}

            {!cancelSickness && (
              <div>
                <Label htmlFor="reason">
                  Priežastis
                </Label>

                <Textarea
                  id="reason"
                  value={
                    cancelReason
                  }
                  onChange={(e) =>
                    setCancelReason(
                      e.target.value,
                    )
                  }
                  maxLength={500}
                  placeholder="Trumpai aprašykite..."
                  rows={3}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setCancelDialog(
                  null,
                )
              }
            >
              Atgal
            </Button>

            <Button
              variant="gold"
              onClick={
                submitLateCancel
              }
              disabled={
                cancelUploading
              }
            >
              {cancelUploading
                ? "Įkeliama…"
                : "Patvirtinti atšaukimą"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin participant manager */}
      <Dialog
        open={!!adminSlotDialog}
        onOpenChange={(open) =>
          !open &&
          setAdminSlotDialog(
            null,
          )
        }
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-gold/20 bg-gradient-card shadow-2xl">
          <DialogHeader>
            <DialogTitle>
              Valdyti dalyvius
            </DialogTitle>

            <DialogDescription>
              {adminSlotDialog &&
                `${formatDateISO(adminSlotDialog.date)} · ${formatTime(adminSlotDialog.time)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>
                Užsiregistravę
              </Label>

              {adminSlotDialog &&
                (() => {
                  const list =
                    getSlotBookings(
                      adminSlotDialog.date,
                      adminSlotDialog.time,
                      adminSlotDialog.slot,
                    );

                  if (
                    list.length ===
                    0
                  ) {
                    return (
                      <p className="text-sm italic text-muted-foreground mt-2">
                        Nėra užsiregistravusių
                      </p>
                    );
                  }

                  return (
                    <ul className="mt-2 space-y-1.5">
                      {list.map(
                        (b) => (
                          <li
                            key={
                              b.id
                            }
                            className="flex items-center justify-between text-sm border border-gold/10 rounded px-3 py-2"
                          >
                            <span>
                              {b.is_guest
                                ? b.guest_name ??
                                  "Svečias"
                                : b.profile_name ??
                                  "—"}
                            </span>

                            <button
                              onClick={() =>
                                adminRemoveBooking(
                                  b.id,
                                )
                              }
                              disabled={
                                adminBusy
                              }
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  );
                })()}
            </div>

            <div>
              <Label>
                Pridėti vartotoją
              </Label>

              <div className="flex gap-2 mt-2">
                <select
                  value={
                    adminAddUserId
                  }
                  onChange={(e) =>
                    setAdminAddUserId(
                      e.target.value,
                    )
                  }
                  className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">
                    — pasirinkite —
                  </option>

                  {allProfiles
                    .filter(
                      (p) => {
                        if (
                          !adminSlotDialog
                        )
                          return true;

                        const booked =
                          getSlotBookings(
                            adminSlotDialog.date,
                            adminSlotDialog.time,
                            adminSlotDialog.slot,
                          );

                        return !booked.some(
                          (b) =>
                            b.user_id ===
                            p.id,
                        );
                      },
                    )
                    .map(
                      (p) => (
                        <option
                          key={
                            p.id
                          }
                          value={
                            p.id
                          }
                        >
                          {
                            p.full_name
                          }
                        </option>
                      ),
                    )}
                </select>

                <Button
                  variant="gold"
                  size="sm"
                  disabled={
                    adminBusy ||
                    !adminAddUserId
                  }
                  onClick={() =>
                    adminSlotDialog &&
                    adminAddUserToSlot(
                      adminSlotDialog.date,
                      adminSlotDialog.time,
                      adminAddUserId,
                    )
                  }
                >
                  Pridėti
                </Button>
              </div>

              {forcePrompt &&
                adminSlotDialog && (
                  <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-[11px] text-destructive">
                    <div className="font-medium">
                      Negalima pridėti raitelio
                    </div>

                    <p className="mt-0.5">
                      {
                        forcePrompt.reason
                      }
                    </p>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1.5 h-7 text-[11px]"
                      disabled={
                        adminBusy
                      }
                      onClick={() =>
                        adminAddUserToSlot(
                          forcePrompt.date,
                          forcePrompt.time,
                          forcePrompt.userId,
                          true,
                        )
                      }
                    >
                      Vis tiek pridėti
                    </Button>
                  </div>
                )}
            </div>

            <div className="pt-3 border-t border-gold/10">
              <Label>
                Pridėti naujokę
              </Label>

              <div className="mt-2">
                <Button
                  variant="gold"
                  size="sm"
                  disabled={
                    adminBusy
                  }
                  onClick={() =>
                    setGuestDialogOpen(
                      true,
                    )
                  }
                >
                  Pridėti naujokę
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setAdminSlotDialog(
                  null,
                )
              }
            >
              Uždaryti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GuestRiderDialog
        open={
          guestDialogOpen
        }
        onOpenChange={
          setGuestDialogOpen
        }
        busy={adminBusy}
        onConfirm={(
          riderId,
          displayName,
        ) => {
          if (
            adminSlotDialog
          ) {
            void adminAddGuest(
              adminSlotDialog.date,
              adminSlotDialog.time,
              riderId,
              displayName,
            );
          }
        }}
      />

      {/* Day notes */}
      <Dialog
        open={!!notesDialog}
        onOpenChange={(open) =>
          !open &&
          setNotesDialog(
            null,
          )
        }
      >
        <DialogContent className="bg-gradient-card border-gold/20 max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <FileText className="w-5 h-5 text-gold inline mr-2" />
              Dienos video
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {notesDialog &&
              (() => {
                const list =
                  getDayNotes(
                    notesDialog.date,
                  );

                if (
                  list.length ===
                  0
                ) {
                  return (
                    <p className="text-sm italic text-muted-foreground">
                      Video dar nėra
                    </p>
                  );
                }

                return (
                  <ul className="space-y-2 max-h-80 overflow-auto">
                    {list.map(
                      (n) => {
                        const canDelete =
                          user &&
                          (n.added_by ===
                            user.id ||
                            isAdmin);

                        return (
                          <li
                            key={
                              n.id
                            }
                            className="flex items-center justify-between gap-2 rounded-md border border-gold/15 bg-background/40 px-3 py-2"
                          >
                            <a
                              href={
                                n.link
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-sm text-gold hover:underline truncate flex-1"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>
                                {n.label?.trim() ||
                                  n.link}
                              </span>
                            </a>

                            {canDelete && (
                              <button
                                onClick={() =>
                                  removeDayNote(
                                    n.id,
                                  )
                                }
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </li>
                        );
                      },
                    )}
                  </ul>
                );
              })()}

            {user && (
              <div className="space-y-2 pt-2 border-t border-gold/10">
                <Label>
                  Pridėti video nuorodą
                </Label>

                <Input
                  value={
                    newNoteLink
                  }
                  onChange={(e) =>
                    setNewNoteLink(
                      e.target.value,
                    )
                  }
                  placeholder="https://..."
                />

                <Input
                  value={
                    newNoteLabel
                  }
                  onChange={(e) =>
                    setNewNoteLabel(
                      e.target.value,
                    )
                  }
                  placeholder="Pavadinimas"
                />

                <Button
                  variant="gold"
                  size="sm"
                  disabled={
                    noteBusy ||
                    !newNoteLink.trim()
                  }
                  onClick={
                    addDayNote
                  }
                >
                  <Plus className="w-3.5 h-3.5" />
                  Pridėti
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setNotesDialog(
                  null,
                )
              }
            >
              Uždaryti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Booking success */}
      <Dialog
        open={!!bookingSuccess}
        onOpenChange={(open) =>
          !open &&
          setBookingSuccess(
            null,
          )
        }
      >
        <DialogContent className="max-w-sm overflow-hidden rounded-3xl border-gold/30 bg-gradient-card p-0 shadow-2xl">
          <div className="relative px-6 pb-6 pt-9 text-center">
            <motion.div
              initial={{
                scale: 0.4,
                opacity: 0,
                rotate: -18,
              }}
              animate={{
                scale: 1,
                opacity: 1,
                rotate: 0,
              }}
              transition={{
                type: "spring",
                stiffness: 280,
                damping: 18,
              }}
              className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-gold/35 bg-gold/12 shadow-gold"
            >
              <CircleCheckBig className="h-10 w-10 text-gold" />
            </motion.div>

            <DialogTitle className="font-display text-2xl text-gradient-gold">
              {language === "lt"
                ? "Pamoka užregistruota!"
                : "Lesson booked!"}
            </DialogTitle>

            <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {bookingSuccess && (
                <>
                  {language ===
                  "lt"
                    ? "Laukiame jūsų"
                    : "We'll see you on"}{" "}
                  <span className="font-semibold text-foreground">
                    {bookingSuccess.date.toLocaleDateString(
                      language ===
                        "lt"
                        ? "lt-LT"
                        : "en-GB",
                      {
                        weekday:
                          "long",
                        day: "numeric",
                        month:
                          "long",
                      },
                    )}
                  </span>{" "}
                  <span className="font-semibold text-gold">
                    {formatTime(
                      bookingSuccess.time,
                    )}
                  </span>
                  .
                </>
              )}
            </DialogDescription>

            <Button
              variant="gold"
              className="mt-6 w-full"
              onClick={() =>
                setBookingSuccess(
                  null,
                )
              }
            >
              {language ===
              "lt"
                ? "Puiku"
                : "Great"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin custom slot */}
      <Dialog
        open={!!customSlotDialog}
        onOpenChange={(open) =>
          !open &&
          setCustomSlotDialog(
            null,
          )
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Naujas laikas
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>
                Data
              </Label>

              <Input
                type="date"
                value={
                  customSlotDialog
                    ? formatDateISO(
                        customSlotDialog.date,
                      )
                    : ""
                }
                onChange={(e) => {
                  if (
                    !e.target
                      .value
                  )
                    return;

                  const [
                    y,
                    m,
                    d,
                  ] =
                    e.target.value
                      .split(
                        "-",
                      )
                      .map(
                        Number,
                      );

                  setCustomSlotDialog(
                    {
                      date: new Date(
                        y,
                        m - 1,
                        d,
                      ),
                    },
                  );
                }}
              />
            </div>

            <div>
              <Label>
                Laikas
              </Label>

              <TimeInput
                id="cs-time"
                value={
                  customSlotTime
                }
                onChange={
                  setCustomSlotTime
                }
              />
            </div>

            <div>
              <Label>
                Talpa
              </Label>

              <Input
                type="number"
                min={1}
                max={30}
                value={
                  customSlotCap
                }
                onChange={(e) =>
                  setCustomSlotCap(
                    parseInt(
                      e.target
                        .value,
                    ) || 1,
                  )
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setCustomSlotDialog(
                  null,
                )
              }
            >
              Atšaukti
            </Button>

            <Button
              variant="gold"
              onClick={
                adminCreateCustomSlot
              }
              disabled={
                customBusy
              }
            >
              {customBusy
                ? "Pridedama…"
                : "Pridėti"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RiderActionSheet
        target={riderTarget}
        onClose={() =>
          setRiderTarget(
            null,
          )
        }
        onChanged={() => {
          void loadData();
        }}
      />
    </div>
  );
}
