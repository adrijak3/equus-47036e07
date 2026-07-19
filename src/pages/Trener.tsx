import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Horse } from "@/components/icons/Horse";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Sparkles,
  Pencil,
  RotateCcw,
  Save,
  CalendarDays,
  Search,
  AlertTriangle,
} from "lucide-react";
import { formatDateISO, formatTime } from "@/lib/equus";

interface Horse {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  max_daily_rides: number;
}
interface Booking {
  id: string;
  user_id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  is_guest: boolean;
  guest_name: string | null;
  profile_name?: string;
}
interface Assignment {
  id: string;
  booking_id: string | null;
  user_id: string | null;
  guest_name: string | null;
  slot_date: string;
  slot_time: string;
  horse_id: string;
}
interface HorseRequest {
  id: string;
  user_id: string;
  slot_date: string;
  slot_time: string;
  wished_horse: string;
  profile_name?: string;
}

export default function Trener() {
  const { isTrainer, isAdmin, loading } = useAuth();

  if (loading) return null;
  if (!isTrainer && !isAdmin) {
    return (
      <div className="container py-12 text-center text-muted-foreground">
        Reikia trenerio arba administratoriaus teisių.
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-8 sm:py-14">
      <header className="mb-8">
        <p className="mb-2 text-xs uppercase tracking-[0.25em] text-gold/70">
          Trenerio sritis
        </p>
        <h1 className="flex items-center gap-3 font-display text-4xl text-gradient-gold sm:text-5xl">
          <Sparkles className="h-8 w-8 text-gold" /> Žirgai ir paskyrimai
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Priskirkite žirgus treniruotėms, matykite dienos krūvį ir tvarkykite žirgų sąrašą.
        </p>
        <div className="gold-divider mt-4 max-w-[120px]" />
      </header>

      <Tabs defaultValue="today">
        <TabsList className="mb-6 grid h-auto w-full grid-cols-3 bg-background/50">
          <TabsTrigger value="today">Paskirti žirgus</TabsTrigger>
          <TabsTrigger value="horses">Žirgų sąrašas</TabsTrigger>
          <TabsTrigger value="subs">Abonementai</TabsTrigger>
        </TabsList>
        <TabsContent value="today"><TodayAssignments /></TabsContent>
        <TabsContent value="horses"><HorsesTab /></TabsContent>
        <TabsContent value="subs"><SubsOverview /></TabsContent>
      </Tabs>
    </div>
  );
}

function HorsesTab() {
  const [horses, setHorses] = useState<Horse[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [maxDailyRides, setMaxDailyRides] = useState(2);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editLimit, setEditLimit] = useState(2);
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      .from("horses")
      .select("id, name, notes, active, max_daily_rides")
      .order("active", { ascending: false })
      .order("name");
    if (error) {
      toast.error(error.message);
      return;
    }
    setHorses((data ?? []) as Horse[]);
  };

  useEffect(() => { void load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("horses").insert({
      name: name.trim(),
      notes: notes.trim() || null,
      max_daily_rides: Math.max(1, maxDailyRides),
    } as any);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Toks žirgo vardas jau yra." : error.message);
      return;
    }
    setName("");
    setNotes("");
    setMaxDailyRides(2);
    toast.success("Žirgas pridėtas");
    void load();
  };

  const beginEdit = (horse: Horse) => {
    setEditing(horse.id);
    setEditName(horse.name);
    setEditNotes(horse.notes ?? "");
    setEditLimit(horse.max_daily_rides ?? 2);
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    const { error } = await supabase.from("horses").update({
      name: editName.trim(),
      notes: editNotes.trim() || null,
      max_daily_rides: Math.max(1, editLimit),
    } as any).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEditing(null);
    toast.success("Žirgo duomenys atnaujinti");
    void load();
  };

  const setActive = async (id: string, active: boolean) => {
    const message = active
      ? "Grąžinti šį žirgą į aktyvų sąrašą?"
      : "Pašalinti šį žirgą iš aktyvaus sąrašo? Seni paskyrimai išliks.";
    if (!confirm(message)) return;

    const { error } = await supabase.from("horses").update({ active }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(active ? "Žirgas vėl aktyvus" : "Žirgas pašalintas iš aktyvaus sąrašo");
    void load();
  };

  const filtered = horses.filter((horse) => {
    if (!showInactive && !horse.active) return false;
    return !search.trim() || horse.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border border-gold/15 bg-gradient-card p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-gold" />
          <h2 className="font-display text-xl text-foreground">Pridėti žirgą</h2>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_150px]">
          <div>
            <Label>Žirgo vardas</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Pvz. Fėja" />
          </div>
          <div>
            <Label>Pastaba</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Nebūtina" />
          </div>
          <div>
            <Label>Maks. jojimų per dieną</Label>
            <Input
              type="number"
              min={1}
              max={12}
              value={maxDailyRides}
              onChange={(e) => setMaxDailyRides(Number(e.target.value) || 1)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="gold" onClick={add}>
            <Plus className="h-4 w-4" /> Pridėti žirgą
          </Button>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ieškoti žirgo…"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Rodyti neaktyvius
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((horse) => (
          <article
            key={horse.id}
            className={`rounded-xl border bg-gradient-card p-4 ${
              horse.active ? "border-gold/15" : "border-border opacity-65"
            }`}
          >
            {editing === horse.id ? (
              <div className="space-y-3">
                <div>
                  <Label>Vardas</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={40} />
                </div>
                <div>
                  <Label>Pastaba</Label>
                  <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} maxLength={200} />
                </div>
                <div>
                  <Label>Maks. jojimų per dieną</Label>
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={editLimit}
                    onChange={(e) => setEditLimit(Number(e.target.value) || 1)}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditing(null)}>Atšaukti</Button>
                  <Button variant="gold" onClick={() => saveEdit(horse.id)}>
                    <Save className="h-4 w-4" /> Išsaugoti
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Horse size={16} />
                    <h3 className="font-display text-xl text-gold">{horse.name}</h3>
                    {!horse.active && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        neaktyvus
                      </span>
                    )}
                  </div>
                  {horse.notes && <p className="mt-1 text-xs text-muted-foreground">{horse.notes}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Dienos limitas: <strong className="text-foreground">{horse.max_daily_rides ?? 2}</strong>
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => beginEdit(horse)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-gold/10 hover:text-gold"
                    aria-label="Redaguoti"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {horse.active ? (
                    <button
                      onClick={() => setActive(horse.id, false)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Pašalinti"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => setActive(horse.id, true)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-gold/10 hover:text-gold"
                      aria-label="Atkurti"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">Žirgų nerasta.</p>
      )}
    </div>
  );
}

function TodayAssignments() {
  const [date, setDate] = useState(formatDateISO(new Date()));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [horses, setHorses] = useState<Horse[]>([]);
  const [assigns, setAssigns] = useState<Assignment[]>([]);
  const [requests, setRequests] = useState<HorseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [b, h, a, r] = await Promise.all([
      supabase.from("bookings").select("*").eq("slot_date", date).eq("status", "active").order("slot_time"),
      supabase.from("horses").select("id, name, notes, active, max_daily_rides").eq("active", true).order("name"),
      supabase.from("horse_assignments").select("*").eq("slot_date", date),
      supabase.from("horse_requests").select("*").eq("slot_date", date),
    ]);

    const ids = Array.from(new Set([
      ...(b.data ?? []).map((x: any) => x.user_id),
      ...(r.data ?? []).map((x: any) => x.user_id),
    ]));

    let nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      nameMap = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
    }

    setBookings((b.data ?? []).map((x: any) => ({ ...x, profile_name: nameMap[x.user_id] })));
    setRequests((r.data ?? []).map((x: any) => ({ ...x, profile_name: nameMap[x.user_id] })));
    setHorses((h.data ?? []) as Horse[]);
    setAssigns((a.data ?? []) as Assignment[]);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [date]);

  const getAssignment = (booking: Booking) =>
    assigns.find((assignment) =>
      assignment.booking_id === booking.id ||
      (
        assignment.slot_time === booking.slot_time &&
        (
          assignment.user_id === booking.user_id ||
          (booking.is_guest && assignment.guest_name === booking.guest_name)
        )
      )
    );

  const usageFor = (horseId: string, ignoreAssignmentId?: string) =>
    assigns.filter((assignment) =>
      assignment.horse_id === horseId &&
      assignment.id !== ignoreAssignmentId
    ).length;

  const assign = async (booking: Booking, horseId: string) => {
    const existing = getAssignment(booking);

    if (!horseId) {
      if (existing) {
        const { error } = await supabase.from("horse_assignments").delete().eq("id", existing.id);
        if (error) {
          toast.error(error.message);
          return;
        }
        toast.success("Žirgas pašalintas");
        void load();
      }
      return;
    }

    const selected = horses.find((horse) => horse.id === horseId);
    const currentUsage = usageFor(horseId, existing?.id);
    if (selected && currentUsage >= selected.max_daily_rides) {
      toast.error(`${selected.name} jau pasiekė dienos limitą (${selected.max_daily_rides}).`);
      return;
    }

    if (existing) {
      const { error } = await supabase
        .from("horse_assignments")
        .update({ horse_id: horseId })
        .eq("id", existing.id);
      if (error) {
        toast.error(error.message.includes("HORSE_LIMIT_REACHED")
          ? "Šis žirgas jau pasiekė dienos limitą."
          : error.message);
        return;
      }
    } else {
      const currentUser = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("horse_assignments").insert({
        booking_id: booking.id,
        user_id: booking.is_guest ? null : booking.user_id,
        guest_name: booking.is_guest ? booking.guest_name : null,
        slot_date: booking.slot_date,
        slot_time: booking.slot_time,
        horse_id: horseId,
        assigned_by: currentUser?.id,
      } as any);
      if (error) {
        toast.error(error.message.includes("HORSE_LIMIT_REACHED")
          ? "Šis žirgas jau pasiekė dienos limitą."
          : error.message);
        return;
      }
    }

    toast.success("Žirgas priskirtas");
    void load();
  };

  const grouped = useMemo(() => {
    const groups: Record<string, Booking[]> = {};
    for (const booking of bookings) (groups[booking.slot_time] ||= []).push(booking);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  const sortedHorses = useMemo(
    () => [...horses].sort((a, b) => {
      const difference = usageFor(a.id) - usageFor(b.id);
      return difference || a.name.localeCompare(b.name, "lt");
    }),
    [horses, assigns],
  );

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-gold/15 bg-gradient-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Label>Pasirinkite dieną</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
        </div>
        <div className="text-xs text-muted-foreground">
          Skaičius skliausteliuose rodo: <strong className="text-foreground">kiek kartų žirgas jau priskirtas tą dieną / jo limitas</strong>.
        </div>
      </section>

      {loading ? (
        <p className="py-8 text-center italic text-muted-foreground">Kraunama…</p>
      ) : grouped.length === 0 ? (
        <p className="py-8 text-center italic text-muted-foreground">Šiai dienai nėra užsiregistravusių.</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([time, list]) => (
            <section key={time} className="rounded-xl border border-gold/15 bg-gradient-card p-4">
              <h3 className="mb-3 flex items-center gap-2 font-display text-lg text-gold">
                <CalendarDays className="h-4 w-4" /> {formatTime(time)}
              </h3>

              <ul className="space-y-3">
                {list.map((booking) => {
                  const assignment = getAssignment(booking);
                  const request = requests.find((item) =>
                    item.user_id === booking.user_id && item.slot_time === booking.slot_time
                  );
                  const assignedHorse = assignment
                    ? horses.find((horse) => horse.id === assignment.horse_id)
                    : null;

                  return (
                    <li
                      key={booking.id}
                      className="grid gap-3 rounded-lg border border-gold/10 bg-background/25 p-3 md:grid-cols-[1fr_280px] md:items-center"
                    >
                      <div>
                        <div className="font-medium text-foreground">
                          {booking.is_guest
                            ? `${booking.guest_name ?? "Svečias"} (naujokė)`
                            : booking.profile_name ?? "—"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs">
                          {request && (
                            <span className="text-blush">
                              Pageidauja: {request.wished_horse}
                            </span>
                          )}
                          {assignedHorse && (
                            <span className="font-medium text-gold">
                              🐴 {assignedHorse.name}
                            </span>
                          )}
                        </div>
                      </div>

                      <select
                        value={assignment?.horse_id ?? ""}
                        onChange={(e) => void assign(booking, e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">— žirgas dar nepaskirtas —</option>
                        {sortedHorses.map((horse) => {
                          const used = usageFor(horse.id, assignment?.id);
                          const limit = horse.max_daily_rides ?? 2;
                          const disabled = used >= limit && assignment?.horse_id !== horse.id;
                          return (
                            <option key={horse.id} value={horse.id} disabled={disabled}>
                              {horse.name} ({used}/{limit}){disabled ? " – limitas" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-gold/15 bg-gradient-card p-4">
        <h3 className="font-display text-lg text-foreground">Pasirinktos dienos žirgų krūvis</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sortedHorses.map((horse) => {
            const used = usageFor(horse.id);
            const limit = horse.max_daily_rides ?? 2;
            const full = used >= limit;
            return (
              <div
                key={horse.id}
                className={`rounded-lg border px-3 py-2 ${
                  full ? "border-destructive/35 bg-destructive/10" : "border-gold/10 bg-background/25"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{horse.name}</span>
                  <span className={full ? "text-destructive" : "text-gold"}>{used}/{limit}</span>
                </div>
                {full && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
                    <AlertTriangle className="h-3 w-3" /> Dienos limitas pasiektas
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface SubRow {
  id: string;
  user_id: string;
  lessons_total: number;
  lessons_used: number;
  lesson_type: string;
  expires_at: string;
  paid: boolean;
  price: number;
}

function SubsOverview() {
  const [rows, setRows] = useState<(SubRow & { full_name: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      const today = formatDateISO(new Date());
      const [{ data: subs }, { data: profs }] = await Promise.all([
        supabase.from("subscriptions").select("*").gte("expires_at", today).order("expires_at"),
        supabase.from("profiles").select("id, full_name"),
      ]);
      const map = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
      setRows((subs ?? []).map((s: any) => ({ ...s, full_name: map[s.user_id] ?? "—" })));
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((row) =>
    !filter || row.full_name.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) {
    return <p className="py-8 text-center italic text-muted-foreground">Kraunama…</p>;
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Ieškoti pagal vardą…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="py-8 text-center italic text-muted-foreground">Nėra aktyvių abonementų</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((subscription) => (
            <li
              key={subscription.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/15 bg-gradient-card px-4 py-3 text-sm"
            >
              <div>
                <div className="font-medium">{subscription.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {subscription.lesson_type} · galioja iki {subscription.expires_at}
                  {subscription.paid ? "" : " · neapmokėta"}
                </div>
              </div>
              <div className="font-display tabular-nums text-gold">
                {subscription.lessons_used}/{subscription.lessons_total}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
