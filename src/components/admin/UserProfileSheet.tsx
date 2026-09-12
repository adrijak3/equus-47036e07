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
import { KeyRound, Trash2, Plus, Palmtree, CalendarClock, History } from "lucide-react";

interface Profile { id: string; full_name: string; phone: string | null; riding_level?: string | null; }
interface Sub {
  id: string; user_id: string | null; lessons_total: number; lessons_used: number;
  price: number; purchase_date: string; expires_at: string; paid: boolean; lesson_type?: string;
}
interface PermSlot { id: string; user_id: string; day_of_week: number; slot_time: string; }
interface Vacation { id: string; user_id: string; starts_on: string; ends_on: string; note?: string | null; }
interface Booking { id: string; slot_date: string; slot_time: string; status: string; trainer_name: string | null; }

/**
 * Single source-of-truth popup for one user. Self-contained: fetches its own data
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
    const [p, s, ps, v, up, pa, tr, roles] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, riding_level").eq("id", id).maybeSingle(),
      supabase.from("subscriptions").select("*").eq("user_id", id).order("purchase_date", { ascending: false }),
      supabase.from("permanent_slots").select("id, user_id, day_of_week, slot_time").eq("user_id", id).order("day_of_week").order("slot_time"),
      (supabase as any).from("vacations").select("id, user_id, starts_on, ends_on, note").eq("user_id", id).order("starts_on", { ascending: false }),
      supabase.from("bookings").select("id, slot_date, slot_time, status, trainer_name").eq("user_id", id).eq("status", "active").gte("slot_date", today).order("slot_date").order("slot_time").limit(20),
      supabase.from("bookings").select("id, slot_date, slot_time, status, trainer_name").eq("user_id", id).or(`slot_date.lt.${today},status.neq.active`).order("slot_date", { ascending: false }).limit(20),
      supabase.from("trainer_riders").select("trainer_user_id, rider_user_id, level").eq("rider_user_id", id),
      supabase.from("user_roles").select("user_id").eq("role", "trainer"),
    ]);
    setProfile((p.data as any) ?? null);
    setSubs((s.data ?? []) as any);
    setPermSlots((ps.data ?? []) as any);
    setVacations((v.data ?? []) as any);
    setUpcoming((up.data ?? []) as any);
    setPast((pa.data ?? []) as any);
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
      `Visiškai ištrinti vartotoją "${profile.full_name}"?\n\nVisi jo duomenys (pamokos, abonementai, žinutės, nuolatiniai laikai) bus negrįžtamai pašalinti.\n\nĮrašykite vartotojo vardą patvirtinti:`
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
    const { error } = await supabase.from("subscriptions").update({ paid }).eq("id", subId);
    if (error) { toast.error(error.message); return; }
    notifyAndReload();
  };

  const editLessons = async (s: Sub) => {
    const txt = prompt(`Naujas treniruočių skaičius (dabar ${s.lessons_total}):`, String(s.lessons_total));
    if (txt === null) return;
    const n = parseInt(txt);
    if (!Number.isFinite(n) || n < 1 || n > 100) { toast.error("Skaičius turi būti 1–100"); return; }
    const newUsed = Math.min(s.lessons_used, n);
    const { error } = await supabase.from("subscriptions").update({ lessons_total: n, lessons_used: newUsed }).eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta");
    notifyAndReload();
  };

  const deleteSub = async (s: Sub) => {
    if (!confirm(`Ištrinti šį abonementą (${s.lessons_used}/${s.lessons_total})?`)) return;
    const { error } = await supabase.from("subscriptions").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Ištrinta");
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

  const removePermSlot = async (row: PermSlot) => {
    if (!confirm(`Pašalinti nuolatinį laiką (${WEEKDAYS_LT[row.day_of_week - 1]} ${formatTime(row.slot_time)})?\n\nVisos būsimos pamokos šiuo laiku bus ATŠAUKTOS.`)) return;
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
    const { error } = await (supabase as any).from("vacations").insert({ user_id: profile.id, starts_on: starts, ends_on: ends });
    if (error) { toast.error(error.message); return; }
    toast.success("Atostogos pridėtos");
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
            onDeleteSub={deleteSub}
            onAddPermSlot={addPermSlot}
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
  onSetLevel, onRename, onResetPassword, onDelete, onTogglePaid, onEditLessons, onDeleteSub,
  onAddPermSlot, onRemovePermSlot, onAddVacation, onRemoveVacation,
}: {
  profile: Profile; subs: Sub[]; permSlots: PermSlot[]; vacations: Vacation[];
  upcoming: Booking[]; past: Booking[]; rosterLevel?: string;
  onSetLevel: (lvl: RidingLevel) => void;
  onRename: (first: string, last: string, phone: string) => void;
  onResetPassword: () => void;
  onDelete: () => void;
  onTogglePaid: (subId: string, paid: boolean) => void;
  onEditLessons: (s: Sub) => void;
  onDeleteSub: (s: Sub) => void;
  onAddPermSlot: (day: number, time: string) => void;
  onRemovePermSlot: (row: PermSlot) => void;
  onAddVacation: (starts: string, ends: string) => void;
  onRemoveVacation: (id: string) => void;
}) {
  const parts = profile.full_name.split(" ");
  const [first, setFirst] = useState(parts[0] ?? "");
  const [last, setLast] = useState(parts.slice(1).join(" "));
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [deleting, setDeleting] = useState(false);

  // reset local edit fields whenever a different user is loaded
  useEffect(() => {
    const p = profile.full_name.split(" ");
    setFirst(p[0] ?? "");
    setLast(p.slice(1).join(" "));
    setPhone(profile.phone ?? "");
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

      <Tabs defaultValue="profile">
        <TabsList className="grid grid-cols-5 w-full text-xs">
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

        {/* PERMANENT TIMES + HOLIDAYS, editable right here */}
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
                    <span>{b.slot_date} · {formatTime(b.slot_time)}</span>
                    {b.trainer_name && <span className="text-xs text-muted-foreground">{b.trainer_name}</span>}
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
                    <span>{b.slot_date} · {formatTime(b.slot_time)}</span>
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

        {/* ACTIONS */}
        <TabsContent value="actions" className="space-y-3 pt-4">
          <Button variant="ghostGold" className="w-full justify-start" onClick={onResetPassword}>
            <KeyRound className="w-4 h-4" /> Atstatyti slaptažodį
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
            disabled={deleting}
            onClick={async () => { setDeleting(true); await onDelete(); setDeleting(false); }}
          >
            <Trash2 className="w-4 h-4" /> {deleting ? "Trinama…" : "Ištrinti vartotoją"}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
