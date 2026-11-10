import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  AlertCircle,
  Users,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Horse } from "@/components/icons/Horse";
import { cn } from "@/lib/utils";
import { PageLoader } from "@/components/PageLoader";
import {
  MONTHS_LT,
  WEEKDAYS_LT,
  formatDateISO,
  formatTime,
  slotDateTime,
} from "@/lib/equus";

interface NextBooking {
  id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  horse_name: string | null;
}

interface AdminSummary {
  todayBookings: number;
  waiting: number;
  cancelled: number;
  uniqueRiders: number;
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 11) return "Labas rytas";
  if (hour < 18) return "Laba diena";
  return "Labas vakaras";
};

const getFirstName = (name?: string | null) => {
  const clean = name?.trim();
  return clean ? clean.split(/\s+/)[0] : "";
};

const formatNextDate = (dateISO: string) => {
  const date = new Date(`${dateISO}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "Šiandien";
  if (date.getTime() === tomorrow.getTime()) return "Rytoj";

  return `${WEEKDAYS_LT[(date.getDay() + 6) % 7]}, ${date.getDate()} ${MONTHS_LT[
    date.getMonth()
  ].toLowerCase()}`;
};

const formatCountdown = (target: Date, now: Date) => {
  const diff = Math.max(0, target.getTime() - now.getTime());
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} d. ${hours} val. ${minutes} min.`;
  if (hours > 0) return `${hours} val. ${minutes} min.`;
  return `${Math.max(1, minutes)} min.`;
};

export default function Pradzia() {
  const {
    user,
    profile,
    activeProfileId,
    activeProfileName,
    isAdmin,
    isTrainer,
  } = useAuth();

  const actingUserId = activeProfileId ?? user?.id ?? null;
  const [nextBooking, setNextBooking] = useState<NextBooking | null>(null);
  const [weekCount, setWeekCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [adminSummary, setAdminSummary] = useState<AdminSummary>({
    todayBookings: 0,
    waiting: 0,
    cancelled: 0,
    uniqueRiders: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(new Date());

  const name = activeProfileName || profile?.full_name || user?.email || "";
  const firstName = getFirstName(name);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    if (!user || !actingUserId) return;

    setLoading(true);
    setLoadError(false);

    const today = new Date();
    const todayISO = formatDateISO(today);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndISO = formatDateISO(weekEnd);
    const monthStartISO = formatDateISO(new Date(today.getFullYear(), today.getMonth(), 1));
    const monthEndISO = formatDateISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));

    if (isAdmin || isTrainer) {
      const [todayRes, waitingRes, cancelledRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("id, user_id")
          .eq("slot_date", todayISO)
          .in("status", ["active", "completed"]),
        supabase
          .from("waiting_list")
          .select("id", { count: "exact", head: true })
          .gte("slot_date", todayISO),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("slot_date", todayISO)
          .eq("status", "cancelled"),
      ]);

      const todayBookings = todayRes.data ?? [];
      setAdminSummary({
        todayBookings: todayBookings.length,
        waiting: waitingRes.count ?? 0,
        cancelled: cancelledRes.count ?? 0,
        uniqueRiders: new Set(todayBookings.map((booking) => booking.user_id)).size,
      });
    }

    const [upcomingResult, monthResult, totalResult] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, slot_date, slot_time, status")
        .eq("user_id", actingUserId)
        .eq("status", "active")
        .gte("slot_date", todayISO)
        .order("slot_date")
        .order("slot_time")
        .limit(50),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", actingUserId)
        .in("status", ["active", "completed"])
        .gte("slot_date", monthStartISO)
        .lte("slot_date", monthEndISO),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", actingUserId)
        .in("status", ["active", "completed"]),
    ]);
    if (upcomingResult.error || monthResult.error || totalResult.error) {
      console.error("Pagrindinio puslapio duomenų įkėlimo klaida:", upcomingResult.error ?? monthResult.error ?? totalResult.error);
      setLoadError(true);
      setLoading(false);
      return;
    }

    const bookingsData = upcomingResult.data;
    setMonthCount(monthResult.count ?? 0);
    setTotalCount(totalResult.count ?? 0);

    const upcoming = (bookingsData ?? []).filter(
      (booking) => slotDateTime(booking.slot_date, booking.slot_time).getTime() >= Date.now(),
    );

    setWeekCount(
      upcoming.filter(
        (booking) => booking.slot_date >= todayISO && booking.slot_date <= weekEndISO,
      ).length,
    );

    const next = upcoming[0];
    if (!next) {
      setNextBooking(null);
      setLoading(false);
      return;
    }

    const { data: assignment } = await supabase
      .from("horse_assignments")
      .select("horse_id")
      .eq("booking_id", next.id)
      .maybeSingle();

    let horseName: string | null = null;
    if (assignment?.horse_id) {
      const { data: horse } = await supabase
        .from("horses")
        .select("name")
        .eq("id", assignment.horse_id)
        .maybeSingle();
      horseName = horse?.name ?? null;
    }

    setNextBooking({
      ...next,
      horse_name: horseName,
    });
    setLoading(false);
  };

  useEffect(() => {
    void loadDashboard();
  }, [user?.id, actingUserId, isAdmin, isTrainer]);

  const countdown = useMemo(() => {
    if (!nextBooking) return "";
    return formatCountdown(
      slotDateTime(nextBooking.slot_date, nextBooking.slot_time),
      now,
    );
  }, [nextBooking, now]);

  const closeToLesson = useMemo(() => {
    if (!nextBooking) return false;
    const hours =
      (slotDateTime(nextBooking.slot_date, nextBooking.slot_time).getTime() -
        now.getTime()) /
      3_600_000;
    return hours >= 0 && hours <= 24;
  }, [nextBooking, now]);

  if (loading) return <PageLoader />;

  if (loadError) {
    return (
      <div className="container flex min-h-[65vh] flex-col items-center justify-center px-4 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <h1 className="mt-3 font-display text-2xl text-foreground">
          Nepavyko įkelti pagrindinio puslapio
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Patikrinkite interneto ryšį ir pabandykite dar kartą.
        </p>
        <Button variant="outlineGold" className="mt-5" onClick={() => void loadDashboard()}>
          Bandyti dar kartą
        </Button>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8 sm:py-14 equus-editorial-home">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10 border-b border-border/70 pb-8 sm:mb-12 sm:pb-10"
      >
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          EQUUS / {getGreeting()}
        </p>
        <h1 className="font-display text-5xl leading-tight text-foreground sm:text-6xl">
          {firstName || "Equus"}
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          {isAdmin
            ? "Šiandienos žirgyno apžvalga."
            : isTrainer
              ? "Šiandienos treniruotės ir trenerio sritis."
              : "Kita treniruotė ir visa, ko jai reikia."}
        </p>
      </motion.header>

      {(isAdmin || isTrainer) && (
        <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Šiandienos rezervacijos",
              value: adminSummary.todayBookings,
              icon: CalendarDays,
            },
            {
              label: "Skirtingi raiteliai",
              value: adminSummary.uniqueRiders,
              icon: Users,
            },
            {
              label: "Laukimo sąraše",
              value: adminSummary.waiting,
              icon: Clock3,
            },
            {
              label: "Atšaukta šiandien",
              value: adminSummary.cancelled,
              icon: XCircle,
            },
          ].map(({ label, value, icon: Icon }, index) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              className="border-l-2 border-border bg-transparent py-2 pl-4"
            >
              <Icon className="mb-3 h-5 w-5 text-gold" />
              <div className="font-display text-3xl text-foreground">{value}</div>
              <div className="mt-1 text-xs leading-snug text-muted-foreground">
                {label}
              </div>
            </motion.div>
          ))}
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-[1.6fr_0.75fr]">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className={cn(
            "relative overflow-hidden border-l-[3px] bg-muted/25 p-6 sm:p-10",
            closeToLesson
              ? "border-gold"
              : "border-border",
          )}
        >


          <div className="relative">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-gold/70">
                  Kita treniruotė
                </p>
                <h2 className="mt-2 font-display text-3xl text-foreground sm:text-4xl">
                  {nextBooking
                    ? formatNextDate(nextBooking.slot_date)
                    : "Kol kas nesuplanuota"}
                </h2>
              </div>
              <div className="flex h-12 w-12 items-center justify-center text-muted-foreground" aria-hidden="true">
                <Horse size={25} />
              </div>
            </div>

            {nextBooking ? (
              <>
                <div className="grid gap-5 border-y border-border/70 py-5 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5 text-gold" />
                      Laikas
                    </div>
                    <div className="font-display text-3xl text-foreground">
                      {formatTime(nextBooking.slot_time)}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                      <Horse size={15} />
                      Žirgas
                    </div>
                    <div className="font-display text-2xl text-foreground">
                      {nextBooking.horse_name ?? "Bus paskirtas vėliau"}
                    </div>
                  </div>
                </div>

                <div className="mt-5 border-b border-border/70 pb-5">
                  <div className="text-xs uppercase tracking-wider text-gold/70">
                    Iki treniruotės liko
                  </div>
                  <div className="mt-1 font-display text-2xl text-gold sm:text-3xl">
                    {countdown}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-gold" />
                  <span>Pakamšės g. 7, Daučionys</span>
                </div>
              </>
            ) : (
              <div className="border-y border-border/70 py-8 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-gold/70" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Šiuo metu neturite suplanuotų būsimų treniruočių.
                </p>
              </div>
            )}

            <Button asChild variant="gold" className="mt-6 w-full sm:w-auto">
              <Link to="/grafikas">
                {nextBooking ? "Atidaryti grafiką" : "Registruotis į treniruotę"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </motion.section>

        <div className="grid gap-6">
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 }}
            className="border-t border-border/80 pt-5"
          >
            <div className="flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-display text-xl text-foreground">Šį mėnesį</h2>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div>
                <div className="font-display text-5xl text-foreground tabular-nums">{monthCount}</div>
                <p className="mt-1 text-sm text-muted-foreground">pamokos</p>
              </div>
              <div>
                <div className="font-display text-3xl text-foreground/85 tabular-nums">{totalCount}</div>
                <p className="mt-1 text-xs text-muted-foreground">iš viso</p>
              </div>
            </div>
            <Button asChild variant="link" className="mt-3 h-auto px-0 text-gold">
              <Link to="/paskyra?tab=lessons">Peržiūrėti treniruotes <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="border-t border-border/80 pt-5"
          >
            <h2 className="font-display text-xl text-foreground">
              Nuorodos
            </h2>
            <div className="mt-4 grid gap-2">
              <Button asChild variant="outlineGold" className="justify-between">
                <Link to="/grafikas">
                  Grafikas
                  <CalendarDays className="h-4 w-4" />
                </Link>
              </Button>

              {!isAdmin && (
                <Button asChild variant="outlineGold" className="justify-between">
                  <Link to="/paskyra">
                    Mano paskyra
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}

              {isAdmin && (
                <Button asChild variant="outlineGold" className="justify-between">
                  <Link to="/admin">
                    Administravimas
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}

              {isTrainer && !isAdmin && (
                <Button asChild variant="outlineGold" className="justify-between">
                  <Link to="/trener">
                    Trenerio sritis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          </motion.section>
        </div>
      </div>

    </div>
  );
}
