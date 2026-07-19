import { useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarCheck2, Percent, TrendingUp, Users, XCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface BookingRow {
  slot_date: string;
  slot_time: string;
  status: string;
  user_id: string;
  is_guest: boolean | null;
}

interface SlotRow {
  day_of_week: number;
  slot_time: string;
  max_capacity: number;
  active: boolean;
}

const WEEKDAY_SHORT = ["Pr", "An", "Tr", "Kt", "Pn", "Št", "Sk"];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfIsoWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const jsDay = d.getDay() || 7;
  d.setDate(d.getDate() - jsDay + 1);
  return d;
}

function addDays(date: Date, amount: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

export function AdminStatistics() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = new Date();
      const rangeStart = addDays(startOfIsoWeek(today), -49);
      const rangeEnd = addDays(startOfIsoWeek(today), 13);

      const [bookingRes, slotRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("slot_date, slot_time, status, user_id, is_guest")
          .gte("slot_date", isoDate(rangeStart))
          .lte("slot_date", isoDate(rangeEnd)),
        supabase
          .from("time_slots")
          .select("day_of_week, slot_time, max_capacity, active")
          .eq("active", true),
      ]);

      setBookings((bookingRes.data ?? []) as BookingRow[]);
      setSlots((slotRes.data ?? []) as SlotRow[]);
      setLoading(false);
    })();
  }, []);

  const computed = useMemo(() => {
    const today = new Date();
    const thisWeekStart = startOfIsoWeek(today);
    const thisWeekEnd = addDays(thisWeekStart, 6);
    const activeThisWeek = bookings.filter(
      (b) => b.status === "active" && b.slot_date >= isoDate(thisWeekStart) && b.slot_date <= isoDate(thisWeekEnd),
    );
    const cancelledThisWeek = bookings.filter(
      (b) => b.status === "cancelled" && b.slot_date >= isoDate(thisWeekStart) && b.slot_date <= isoDate(thisWeekEnd),
    );

    const uniqueRiders = new Set(activeThisWeek.map((b) => b.user_id)).size;
    const cancellationRate = activeThisWeek.length + cancelledThisWeek.length > 0
      ? Math.round((cancelledThisWeek.length / (activeThisWeek.length + cancelledThisWeek.length)) * 100)
      : 0;

    const capacityByDay = new Map<number, number>();
    slots.forEach((s) => capacityByDay.set(s.day_of_week, (capacityByDay.get(s.day_of_week) ?? 0) + s.max_capacity));

    const weekdayData = WEEKDAY_SHORT.map((day, index) => {
      const dow = index + 1;
      const count = activeThisWeek.filter((b) => {
        const d = new Date(`${b.slot_date}T00:00:00`);
        const bookingDow = d.getDay() === 0 ? 7 : d.getDay();
        return bookingDow === dow;
      }).length;
      const capacity = capacityByDay.get(dow) ?? 0;
      return {
        day,
        bookings: count,
        occupancy: capacity > 0 ? Math.min(100, Math.round((count / capacity) * 100)) : 0,
      };
    });

    const weekTrend = Array.from({ length: 8 }, (_, i) => {
      const start = addDays(thisWeekStart, (i - 7) * 7);
      const end = addDays(start, 6);
      const count = bookings.filter(
        (b) => b.status === "active" && b.slot_date >= isoDate(start) && b.slot_date <= isoDate(end),
      ).length;
      return {
        week: `${start.getDate()}.${String(start.getMonth() + 1).padStart(2, "0")}`,
        bookings: count,
      };
    });

    const previousWeekCount = weekTrend.at(-2)?.bookings ?? 0;
    const currentWeekCount = weekTrend.at(-1)?.bookings ?? 0;
    const trendPercent = previousWeekCount > 0
      ? Math.round(((currentWeekCount - previousWeekCount) / previousWeekCount) * 100)
      : currentWeekCount > 0 ? 100 : 0;

    const totalCapacity = weekdayData.reduce((sum, row) => sum + (capacityByDay.get(WEEKDAY_SHORT.indexOf(row.day) + 1) ?? 0), 0);
    const overallOccupancy = totalCapacity > 0 ? Math.min(100, Math.round((activeThisWeek.length / totalCapacity) * 100)) : 0;

    return {
      activeThisWeek: activeThisWeek.length,
      cancelledThisWeek: cancelledThisWeek.length,
      uniqueRiders,
      cancellationRate,
      overallOccupancy,
      trendPercent,
      weekdayData,
      weekTrend,
    };
  }, [bookings, slots]);

  if (loading) {
    return <div className="rounded-lg border border-gold/15 bg-gradient-card p-6 text-sm text-muted-foreground">Skaičiuojama statistika…</div>;
  }

  const metrics = [
    { label: "Rezervacijos šią savaitę", value: computed.activeThisWeek, icon: CalendarCheck2 },
    { label: "Unikalūs raiteliai", value: computed.uniqueRiders, icon: Users },
    { label: "Užimtumas", value: `${computed.overallOccupancy}%`, icon: Percent },
    { label: "Atšaukta", value: computed.cancelledThisWeek, icon: XCircle },
    { label: "Pokytis nuo praėjusios sav.", value: `${computed.trendPercent > 0 ? "+" : ""}${computed.trendPercent}%`, icon: TrendingUp },
    { label: "Atšaukimų dalis", value: `${computed.cancellationRate}%`, icon: BarChart3 },
  ];

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-gold" />
        <h3 className="font-display text-xl text-gradient-gold">Statistika</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg border border-gold/15 bg-gradient-card p-4">
            <Icon className="mb-2 h-4 w-4 text-gold/70" />
            <div className="font-display text-2xl text-gradient-gold tabular-nums">{value}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gold/15 bg-gradient-card p-4">
          <div className="mb-4 text-sm font-medium text-foreground/85">Rezervacijų tendencija · 8 savaitės</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={computed.weekTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    color: "hsl(var(--popover-foreground))",
                  }}
                />
                <Line type="monotone" dataKey="bookings" name="Rezervacijos" stroke="hsl(var(--gold))" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-gold/15 bg-gradient-card p-4">
          <div className="mb-4 text-sm font-medium text-foreground/85">Užimtumas pagal savaitės dieną</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={computed.weekdayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  formatter={(value: number) => [`${value}%`, "Užimtumas"]}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    color: "hsl(var(--popover-foreground))",
                  }}
                />
                <Bar dataKey="occupancy" name="Užimtumas" fill="hsl(var(--gold))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
