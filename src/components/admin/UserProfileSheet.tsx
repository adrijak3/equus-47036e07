import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiderLevelBadge, RiderLevelSelect } from "@/components/RiderLevelBadge";
import { LEVEL_META, type RidingLevel } from "@/lib/levels";
import { WEEKDAYS_LT, formatTime, formatDateISO, isValidTime } from "@/lib/equus";
import { SubscriptionCard } from "@/pages/Paskyra";
import { TimeInput } from "@/components/TimeInput";
import { KeyRound, Trash2, Plus, Palmtree, CalendarClock, History, Pencil, Phone, Clock, Wallet, CalendarDays } from "lucide-react";

interface Profile { id: string; full_name: string; phone: string | null; riding_level?: string | null; experience_text?: string | null; phone_is_parent?: boolean | null; }
interface Sub {
  id: string; user_id: string | null; lessons_total: number; lessons_used: number;
  price: number; purchase_date: string; expires_at: string; paid: boolean; lesson_type?: string;
}
interface PermSlot { id: string; user_id: string; day_of_week: number; slot_time: string; }
interface Vacation { id: string; user_id: string; starts_on: string; ends_on: string; note?: string | null; }
interface Booking { id: string; slot_date: string; slot_time: string; status: string; trainer_name: string | null; is_individual?: boolean | null; counts_in_subscription?: boolean | null; subscription_id?: string | null; lesson_price?: number | null; }

/**
 * Single source-of-truth user panel for one user. Self-contained: fetches its own data
 * from a userId, so it can be opened from anywhere (the Vartotojai table, the
 * top search bar, subscription reminders, etc.) without the caller needing to
 * hand it a pile of props.
 */
export function UserProfileSheet({
  userId, open, onOpenChange, onChanged,
}: {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any mutation (rename, delete, level change, slot edit…) so the caller can refresh its own list. */
  onChanged?: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [permSlots, setPermSlots] = useState<PermSlot[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [rosterLevel, setRosterLevel] = useState<string | undefined>(undefined);
  const [trainerIds, setTrainerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    const today = formatDateISO(new Date());
    const [p, s, ps, v, bookings, tr, roles] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, riding_level, experience_text, phone_is_parent").eq("id", id).maybeSingle(),
      supabase.from("subscriptions").select("*").eq("user_id", id).order("purchase_date", { ascending: false }),
      supabase.from("permanent_slots").select("id, user_id, day_of_week, slot_time").eq("user_id", id).order("day_of_week").order("slot_time"),
      (supabase as any).from("vacations").select("id, user_id, starts_on, ends_on, note").eq("user_id", id).order("starts_on", { ascending: false }),
      supabase.from("bookings").select("id, slot_date, slot_time, status, trainer_name, is_individual, counts_in_subscription, subscription_id, lesson_price").eq("user_id", id).order("slot_date", { ascending: false }).order("slot_time").limit(100),
      supabase.from("trainer_riders").select("trainer_user_id, rider_user_id, level").eq("rider_user_id", id),
      supabase.from("user_roles").select("user_id").eq("role", "trainer"),
    ]);
    const allBookings = (bookings.data ?? []) as any[];
    const upcomingBookings = allBookings
      .filter((b) => b.status === "active" && b.slot_date >= today)
      .sort((a, b) => (a.slot_date + "T" + a.slot_time).localeCompare(b.slot_date + "T" + b.slot_time))
      .slice(0, 20);
    const pastBookings = allBookings
      .filter((b) => b.slot_date < today || b.status !== "active")
      .sort((a, b) => (b.slot_date + "T" + b.slot_time).localeCompare(a.slot_date + "T" + a.slot_time))
      .slice(0, 20);
    setProfile((p.data as any) ?? null);
    setSubs((s.data ?? []) as any);
    setPermSlots((ps.data ?? []) as any);
    setVacations((v.data ?? []) as any);
    setUpcoming(upcomingBookings as any);
    setPast(pastBookings as any);
    setRosterLevel(((tr.data ?? []) as any[])[0]?.level);
    setTrainerIds(((roles.data ?? []) as any[]).map((r) => r.user_id));
    setLoading(false);
  };

  useEffect(() => {
    if (open && userId) load(userId);
    if (!open) {
      // clear so a stale profile never flashes when a different user is opened next
      setProfile(null);
    }
  }, [open, userId]);

  const notifyAndReload = () => {
    onChanged?.();
    if (userId) load(userId);
  };

  const setLevel = async (level: RidingLevel) => {
    if (!profile) return;
    const { error } = await supabase.from("profiles").update({ riding_level: level } as any).eq("id", profile.id);
    if (error) { toast.error(error.message); return; }
    for (const trainerId of trainerIds) {
      const { data: existing } = await supabase.from("trainer_riders").select("id").eq("trainer_user_id", trainerId).eq("rider_user_id", profile.id).maybeSingle();
      if (existing) {
        await supabase.from("trainer_riders").update({ level }).eq("id", (existing as any).id);
      } else {
        await supabase.from("trainer_riders").insert({ trainer_user_id: trainerId, rider_user_id: profile.id, level });
      }
    }
    toast.success(`${profile.full_name}: ${LEVEL_META[level].label}`);
    notifyAndReload();
  };

  const renameUser = async (first: string, last: string, phone: string) => {
    if (!profile) return;
    const fullName = `${first.trim()} ${last.trim()}`.trim();
    if (!fullName) { toast.error("Vardas negali būti tuščias"); return; }
    const { error } = await supabase.from("profiles").update({ full_name: fullName, phone: phone.trim() || null }).eq("id", profile.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta");
    notifyAndReload();
  };

  const changeEmail = async (email: string) => {
    if (!profile) return false;
    const normalized = email.trim().toLowerCase().replace(/\s+/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      toast.error("Įveskite galiojantį el. pašto adresą");
      return false;
    }
    const { data, error } = await supabase.functions.invoke("admin-update-user-email", {
      body: { user_id: profile.id, email: normalized },
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Nepavyko pakeisti el. pašto");
      return false;
    }
    toast.success("El. paštas pakeistas į " + normalized);
    notifyAndReload();
    return true;
  };

  const resetPassword = async () => {
    if (!profile) return;
    if (!confirm(`Atstatyti ${profile.full_name} slaptažodį į „vardas_equus123"?`)) return;
    const { data, error } = await supabase.functions.invoke("admin-reset-password", { body: { user_id: profile.id } });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success(`Naujas slaptažodis: ${(data as any).password}`);
  };

  const deleteUser = async () => {
    if (!profile) return;
    const txt = prompt(
      `Visiškai ištrinti vartotoją "${profile.full_name}"?

Visi jo duomenys (pamokos, abonementai, žinutės, nuolatiniai laikai) bus negrįžtamai pašalinti.

Įrašykite vartotojo vardą patvirtinti:`
    );
    if (txt !== profile.full_name) { if (txt !== null) toast.error("Vardas nesutampa — atšaukta"); return; }
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { user_id: profile.id } });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success(`${profile.full_name} ištrintas`);
    onOpenChange(false);
    onChanged?.();
  };

  const togglePaid = async (subId: string, paid: boolean) => {
    const fn = paid ? "admin_mark_subscription_paid" : "admin_mark_subscription_unpaid";
    const { error } = await (supabase as any).rpc(fn, {
      _subscription_id: subId,
      _reason: "Pakeitė administracija kliento profilyje",
    });
    if (error) { toast.error(error.message); return; }
    notifyAndReload();
  };

  const editLessons = async (s: Sub) => {
    const txt = prompt(`Naujas treniruočių skaičius (dabar ${s.lessons_total}):`, String(s.lessons_total));
    if (txt === null) return;
    const n = parseInt(txt);
    if (!Number.isFinite(n) || n < 1 || n > 100) { toast.error("Skaičius turi būti 1–100"); return; }
    const { error: totalError } = await (supabase as any).rpc("admin_adjust_subscription_total", {
      _subscription_id: s.id,
      _new_lessons_total: n,
      _reason: "Pakeitė administracija kliento profilyje",
    });
    if (totalError) { toast.error(totalError.message); return; }
    toast.success("Atnaujinta");
    notifyAndReload();
  };

  const editUsed = async (s: Sub) => {
    const txt = prompt(`Kiek treniruočių jau panaudota (dabar ${s.lessons_used} iš ${s.lessons_total}):`, String(s.lessons_used));
    if (txt === null) return;
    const n = parseInt(txt);
    if (!Number.isFinite(n) || n < 0 || n > s.lessons_total) {
      toast.error(`Įveskite skaičių nuo 0 iki ${s.lessons_total}`);
      return;
    }
    const { error } = await (supabase as any).rpc("admin_adjust_subscription_used", {
      _subscription_id: s.id,
      _new_lessons_used: n,
      _reason: "Pakeitė administracija kliento profilyje",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Panaudotų treniruočių skaičius atnaujintas");
    notifyAndReload();
  };

  const deleteSub = async (s: Sub) => {
    if (!confirm(`Ištrinti šį abonementą (${s.lessons_used}/${s.lessons_total})? Šis veiksmas negrįžtamas.`)) return;

    const { error } = await supabase.rpc("admin_delete_subscription", {
      _subscription_id: s.id,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Abonementas ištrintas");
    notifyAndReload();
  };

  const addPermSlot = async (day: number, time: string) => {
    if (!profile) return;
    if (!isValidTime(time)) { toast.error("Įveskite laiką formatu HH:MM"); return; }
    const { error } = await supabase.from("permanent_slots").insert({ user_id: profile.id, day_of_week: day, slot_time: time });
    if (error) {
      toast.error(error.code === "23505" ? "Šis nuolatinis laikas jau pridėtas" : error.message);
      return;
    }
    toast.success("Pridėta. Vartotojas užregistruotas 12-os savaičių į priekį.");
    notifyAndReload();
  };

  const changePermSlotTime = async (row: PermSlot, newTime: string) => {
    if (!isValidTime(newTime)) { toast.error("Įveskite laiką formatu HH:MM"); return; }
    if (newTime.slice(0, 5) === row.slot_time.slice(0, 5)) return;
    const { data, error } = await (supabase as any).rpc("admin_apply_recurring_time_change", { _slot_id: row.id, _new_time: newTime });
    if (error) {
      const msg = error.message?.includes("RECURRING_MOVE_CONFLICT") ? "Pakeitimas sukeltų rezervacijų konfliktą." : error.message?.includes("TARGET_TIME_EXISTS") ? "Šis laikas jau naudojamas tame pačiame trenerio grafike." : error.message;
      toast.error(msg); return;
    }
    toast.success(`Laikas pakeistas. Perkeltos ${Number((data as any)?.bookings_moved ?? 0)} rezervacijos.`);
    notifyAndReload();
  };

  const removePermSlot = async (row: PermSlot) => {
    if (!confirm(`Pašalinti nuolatinį laiką (${WEEKDAYS_LT[row.day_of_week - 1]} ${formatTime(row.slot_time)})?

Visos būsimos pamokos šiuo laiku bus ATŠAUKTOS.`)) return;
    const { error: e1 } = await supabase.from("permanent_slots").delete().eq("id", row.id);
    if (e1) { toast.error(e1.message); return; }
    const todayISO = formatDateISO(new Date());
    const { data: future } = await supabase
      .from("bookings")
      .select("id, slot_date")
      .eq("user_id", row.user_id)
      .eq("slot_time", row.slot_time)
      .eq("status", "active")
      .gte("slot_date", todayISO);
    const ids = (future ?? [])
      .filter((b: any) => {
        const d = new Date(b.slot_date + "T00:00:00");
        const dow = d.getDay() === 0 ? 7 : d.getDay();
        return dow === row.day_of_week;
      })
      .map((b: any) => b.id);
    if (ids.length > 0) await supabase.from("bookings").update({ status: "cancelled" }).in("id", ids);
    toast.success(`Pašalinta. Atšaukta ${ids.length} būsimų pamokų.`);
    notifyAndReload();
  };

  const addVacation = async (starts: string, ends: string) => {
    if (!profile) return;
    if (!starts || !ends) { toast.error("Nurodykite abi datas"); return; }
    if (ends < starts) { toast.error("Pabaigos data turi būti po pradžios"); return; }
    const { data, error } = await (supabase as any).rpc("add_vacation_and_cancel", { _user_id: profile.id, _starts_on: starts, _ends_on: ends, _note: null });
    if (error) { toast.error(error.message); return; }
    const cancelled = Number((data as any)?.cancelled_bookings ?? 0);
    toast.success(cancelled > 0 ? "Atostogos pridėtos — atšaukta " + cancelled + " treniruočių" : "Atostogos pridėtos");
    notifyAndReload();
  };

  const removeVacation = async (id: string) => {
    if (!confirm("Ištrinti atostogų įrašą?")) return;
    const { error } = await (supabase as any).from("vacations").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Ištrinta");
    notifyAndReload();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        {loading && !profile && <p className="text-center text-muted-foreground py-8">Kraunama…</p>}
        {profile && (
          <UserDetailsBody
            profile={profile}
            subs={subs}
            permSlots={permSlots}
            vacations={vacations}
            upcoming={upcoming}
            past={past}
            rosterLevel={rosterLevel}
            onSetLevel={setLevel}
            onRename={renameUser}
            onResetPassword={resetPassword}
            onDelete={deleteUser}
            onTogglePaid={togglePaid}
            onEditLessons={editLessons}
            onEditUsed={editUsed}
            onDeleteSub={deleteSub}
            onAddPermSlot={addPermSlot}
            onChangePermSlotTime={changePermSlotTime}
            onRemovePermSlot={removePermSlot}
            onAddVacation={addVacation}
            onRemoveVacation={removeVacation}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function UserDetailsBody({
  profile, subs, permSlots, vacations, upcoming, past, rosterLevel,
  onSetLevel, onRename, onChangeEmail, onResetPassword, onDelete, onTogglePaid, onEditLessons, onEditUsed, onDeleteSub,
  onAddPermSlot, onChangePermSlotTime, onRemovePermSlot, onAddVacation, onRemoveVacation,
}: {
  profile: Profile; subs: Sub[]; permSlots: PermSlot[]; vacations: Vacation[];
  upcoming: Booking[]; past: Booking[]; rosterLevel?: string;
  onSetLevel: (lvl: RidingLevel) => void;
  onRename: (first: string, last: string, phone: string) => void;
  onChangeEmail: (email: string) => Promise<boolean>;
  onResetPassword: () => void;
  onDelete: () => void;
  onTogglePaid: (subId: string, paid: boolean) => void;
  onEditLessons: (s: Sub) => void;
  onEditUsed: (s: Sub) => void;
  onDeleteSub: (s: Sub) => void;
  onAddPermSlot: (day: number, time: string) => void;
  onChangePermSlotTime: (row: PermSlot, newTime: string) => void;
  onRemovePermSlot: (row: PermSlot) => void;
  onAddVacation: (starts: string, ends: string) => void;
  onRemoveVacation: (id: string) => void;
}) {
  const parts = profile.full_name.split(" ");
  const [first, setFirst] = useState(parts[0] ?? "");
  const [last, setLast] = useState(parts.slice(1).join(" "));
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // reset local edit fields whenever a different user is loaded
  useEffect(() => {
    const p = profile.full_name.split(" ");
    setFirst(p[0] ?? "");
    setLast(p.slice(1).join(" "));
    setPhone(profile.phone ?? "");
    setEmail("");
    void (async () => {
      const { data } = await supabase.functions.invoke("admin-update-user-email", {
        body: { user_id: profile.id },
      });
      if ((data as any)?.email) setEmail((data as any).email);
    })();
  }, [profile.id]);

  const [newDay, setNewDay] = useState(1);
  const [newTime, setNewTime] = useState("");
  const [vacStart, setVacStart] = useState("");
  const [vacEnd, setVacEnd] = useState("");

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="font-display text-gradient-gold text-2xl">{profile.full_name}</SheetTitle>
      </SheetHeader>

      <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/10 font-display text-lg text-gold">
            {profile.full_name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-medium truncate">{profile.full_name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {profile.phone || "Telefono nėra"}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-background/40 p-2.5 text-center"><Wallet className="mx-auto h-3.5 w-3.5 text-gold" /><p className="mt-1 text-lg font-semibold tabular-nums">{subs.filter(s => s.paid && new Date(s.expires_at) >= new Date()).reduce((n,s) => n + Math.max(0, s.lessons_total - s.lessons_used), 0)}</p><p className="text-[10px] text-muted-foreground">liko</p></div>
          <div className="rounded-xl bg-background/40 p-2.5 text-center"><CalendarDays className="mx-auto h-3.5 w-3.5 text-gold" /><p className="mt-1 text-lg font-semibold tabular-nums">{upcoming.length}</p><p className="text-[10px] text-muted-foreground">būsimos</p></div>
          <div className="rounded-xl bg-background/40 p-2.5 text-center"><Clock className="mx-auto h-3.5 w-3.5 text-gold" /><p className="mt-1 text-lg font-semibold tabular-nums">{permSlots.length}</p><p className="text-[10px] text-muted-foreground">nuolat.</p></div>
          <div className="rounded-xl bg-background/40 p-2.5 text-center"><Palmtree className="mx-auto h-3.5 w-3.5 text-gold" /><p className="mt-1 text-lg font-semibold tabular-nums">{vacations.filter(v => v.ends_on >= formatDateISO(new Date())).length}</p><p className="text-[10px] text-muted-foreground">atostogos</p></div>
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="grid grid-cols-5 w-full text-xs overflow-x-auto">
          <TabsTrigger value="profile">Profilis</TabsTrigger>
          <TabsTrigger value="subs">Abon.</TabsTrigger>
          <TabsTrigger value="permanent">Laikai</TabsTrigger>
          <TabsTrigger value="lessons">Pamokos</TabsTrigger>
          <TabsTrigger value="actions">Veiksmai</TabsTrigger>
        </TabsList>

        {/* PROFILE */}
        <TabsContent value="profile" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vardas</Label>
              <Input value={first} onChange={(e) => setFirst(e.target.value)} />
            </div>
            <div>
              <Label>Pavardė</Label>
              <Input value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Telefonas</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            {profile.phone_is_parent && (
              <p className="mt-1 text-xs text-gold">Tai tėvų / globėjo numeris</p>
            )}
          </div>
          <div>
            <Label>El. paštas</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="klientas@example.com" />
            <p className="mt-1 text-xs text-muted-foreground">Administratorius gali pakeisti prisijungimo el. paštą tiesiogiai.</p>
            <div className="mt-2">
              <Button
                variant="ghostGold"
                size="sm"
                disabled={emailBusy || !email.trim()}
                onClick={async () => {
                  setEmailBusy(true);
                  await onChangeEmail(email);
                  setEmailBusy(false);
                }}
              >
                {emailBusy ? "Keičiama…" : "Pakeisti el. paštą"}
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-gold/15 bg-background/40 p-3">
            <Label>Jojimo patirtis (raitelio aprašymas)</Label>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {profile.experience_text?.trim() || "Nenurodyta"}
            </p>
          </div>
          <Button variant="gold" size="sm" onClick={() => onRename(first, last, phone)}>Išsaugoti</Button>
          <div className="pt-2 border-t border-gold/10 space-y-2">
            <Label>Vidinis raitelio lygis (trenerio grafikas)</Label>
            <div className="flex items-center gap-2">
              <RiderLevelSelect value={(rosterLevel ?? profile.riding_level) as RidingLevel} onChange={onSetLevel} />
              <RiderLevelBadge level={rosterLevel ?? profile.riding_level} />
            </div>
            <p className="text-xs text-muted-foreground italic">Atnaujina ir profilį, ir trenerio raitelių sąrašą.</p>
          </div>
        </TabsContent>

        {/* SUBSCRIPTIONS */}
        <TabsContent value="subs" className="space-y-3 pt-4">
          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nėra abonementų</p>
          ) : (
            subs.map((s) => (
              <SubscriptionCard
                key={s.id}
                s={s as any}
                effectiveUsed={s.lessons_used ?? 0}
                onMarkPaid={!s.paid ? () => onTogglePaid(s.id, true) : undefined}
                onEditLessons={() => onEditLessons(s)}
                onEditUsed={() => onEditUsed(s)}
                onDelete={() => onDeleteSub(s)}
                extra={s.paid ? (
                  <div className="flex justify-end">
                    <button
                      onClick={() => onTogglePaid(s.id, false)}
                      className="text-[11px] px-2 py-1 rounded border border-blush/30 text-blush bg-blush/10"
                    >
                      Pažymėti neapmokėta
                    </button>
                  </div>
                ) : undefined}
              />
            ))
          )}
        </TabsContent>

        {/* PERMANENT TIMES + HOLIDAYS */}
        <TabsContent value="permanent" className="space-y-5 pt-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" /> Nuolatiniai laikai</Label>
            {permSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nėra nuolatinių laikų</p>
            ) : (
              <ul className="space-y-1.5">
                {permSlots.map((ps) => (
                  <li key={ps.id} className="text-sm bg-background/40 border border-gold/10 rounded px-3 py-2 flex items-center justify-between">
                    <span>{WEEKDAYS_LT[ps.day_of_week - 1]} · {formatTime(ps.slot_time)}</span>
                    <button onClick={() => onRemovePermSlot(ps)} className="text-blush/80 hover:text-blush">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 pt-1">
              <select
                value={newDay}
                onChange={(e) => setNewDay(Number(e.target.value))}
                className="h-9 rounded-md border border-gold/20 bg-background/60 px-2 text-sm"
              >
                {WEEKDAYS_LT.map((d, i) => (
                  <option key={d} value={i + 1}>{d}</option>
                ))}
              </select>
              <TimeInput value={newTime} onChange={setNewTime} className="h-9 w-28" placeholder="17:30" />
              <Button
                variant="ghostGold" size="sm"
                onClick={() => { onAddPermSlot(newDay, newTime); setNewTime(""); }}
              >
                <Plus className="w-3.5 h-3.5" /> Pridėti
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-gold/10">
            <Label className="flex items-center gap-1.5"><Palmtree className="w-3.5 h-3.5" /> Atostogos</Label>
            {vacations.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Atostogų nėra</p>
            ) : (
              <ul className="space-y-1.5">
                {vacations.map((v) => (
                  <li key={v.id} className="text-sm bg-background/40 border border-gold/10 rounded px-3 py-2 flex items-center justify-between">
                    <span>{v.starts_on} → {v.ends_on}</span>
                    <button onClick={() => onRemoveVacation(v.id)} className="text-blush/80 hover:text-blush">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Input type="date" value={vacStart} onChange={(e) => setVacStart(e.target.value)} className="h-9 w-auto" />
              <span className="text-xs text-muted-foreground">iki</span>
              <Input type="date" value={vacEnd} onChange={(e) => setVacEnd(e.target.value)} className="h-9 w-auto" />
              <Button
                variant="ghostGold" size="sm"
                onClick={() => { onAddVacation(vacStart, vacEnd); setVacStart(""); setVacEnd(""); }}
              >
                <Plus className="w-3.5 h-3.5" /> Pridėti
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* LESSONS: upcoming + past */}
        <TabsContent value="lessons" className="space-y-5 pt-4">
          <div className="space-y-2">
            <Label>Būsimos treniruotės</Label>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nėra būsimų treniruočių</p>
            ) : (
              <ul className="space-y-1.5">
                {upcoming.map((b) => (
                  <li key={b.id} className="text-sm bg-background/40 border border-gold/10 rounded px-3 py-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <div>{b.slot_date} · {formatTime(b.slot_time)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {b.is_individual ? "Individuali" : "Grupinė"}
                        {b.trainer_name ? " · " + b.trainer_name : ""}
                        {b.lesson_price != null ? " · " + Number(b.lesson_price).toFixed(2).replace(".00", "") + " €" : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2 pt-3 border-t border-gold/10">
            <Label className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Praeitos / atšauktos</Label>
            {past.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Istorijos nėra</p>
            ) : (
              <ul className="space-y-1.5">
                {past.map((b) => (
                  <li key={b.id} className="text-sm bg-background/40 border border-gold/10 rounded px-3 py-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <div>{b.slot_date} · {formatTime(b.slot_time)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {b.is_individual ? "Individuali" : "Grupinė"}
                        {b.trainer_name ? " · " + b.trainer_name : ""}
                        {b.lesson_price != null ? " · " + Number(b.lesson_price).toFixed(2).replace(".00", "") + " €" : ""}
                        {b.counts_in_subscription === false ? " · apmokėta atskirai" : ""}
                      </div>
                    </div>
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full border",
                      b.status === "cancelled" ? "bg-blush/15 text-blush border-blush/30" : "bg-background/40 border-gold/15 text-muted-foreground",
                    )}>
                      {b.status === "cancelled" ? "atšaukta" : b.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <div className="pt-4 mt-4 border-t border-gold/10 space-y-2">
          <Label>Administravimas</Label>
          <div className="grid sm:grid-cols-2 gap-2">
            <Button variant="ghostGold" className="justify-start" onClick={onResetPassword}>
              <KeyRound className="w-4 h-4" /> Atstatyti slaptažodį
            </Button>
            <Button
              variant="ghost"
              className="justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={deleting}
              onClick={async () => { setDeleting(true); await onDelete(); setDeleting(false); }}
            >
              <Trash2 className="w-4 h-4" /> {deleting ? "Trinama…" : "Ištrinti vartotoją"}
            </Button>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
