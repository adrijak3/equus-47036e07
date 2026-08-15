import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RiderLevelBadge, RiderLevelSelect } from "@/components/RiderLevelBadge";
import { LEVEL_META, type RidingLevel } from "@/lib/levels";
import { WEEKDAYS_LT, formatTime, formatDateISO } from "@/lib/equus";
import { SubscriptionCard } from "@/pages/Paskyra";
import { KeyRound, Trash2, Search, UserPlus2, PhoneCall, Link2 } from "lucide-react";

interface Profile { id: string; full_name: string; phone: string | null; riding_level?: string | null; }
interface Sub {
  id: string; user_id: string | null; guest_rider_id?: string | null; lessons_total: number; lessons_used: number;
  price: number; purchase_date: string; expires_at: string; paid: boolean; lesson_type?: string;
}
interface PermSlot { id: string; user_id: string; day_of_week: number; slot_time: string; }
interface Vacation { id: string; user_id: string; starts_on: string; ends_on: string; }
interface TrainerRiderRow { id: string; trainer_user_id: string; rider_user_id: string | null; guest_rider_id: string | null; level: string; note: string | null; }
interface GuestRider {
  id: string; first_name: string; last_name: string; phone: string | null; email: string | null;
  notes: string | null; is_newcomer: boolean; linked_user_id: string | null; created_by: string | null;
}

type FilterKey = "all" | "hasSub" | "noSub" | "permanent" | "guests";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Visi" },
  { key: "hasSub", label: "Turi abonementą" },
  { key: "noSub", label: "Be abonemento" },
  { key: "permanent", label: "Nuolatiniai laikai" },
  { key: "guests", label: "Svečiai (naujokai)" },
];

export function UsersSection({ focusUserId, onClearFocus }: { focusUserId?: string | null; onClearFocus?: () => void } = {}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [permSlots, setPermSlots] = useState<PermSlot[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [trainerRiders, setTrainerRiders] = useState<TrainerRiderRow[]>([]);
  const [guests, setGuests] = useState<GuestRider[]>([]);
  const [trainerIds, setTrainerIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [linkGuest, setLinkGuest] = useState<GuestRider | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const today = formatDateISO(new Date());
    const [p, s, ps, v, tr, g, roles] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, riding_level").order("full_name"),
      supabase.from("subscriptions").select("*").order("purchase_date", { ascending: false }),
      supabase.from("permanent_slots").select("id, user_id, day_of_week, slot_time"),
      supabase.from("vacations").select("id, user_id, starts_on, ends_on").lte("starts_on", today).gte("ends_on", today),
      supabase.from("trainer_riders").select("*"),
      supabase.from("guest_riders").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role").eq("role", "trainer"),
    ]);
    setProfiles((p.data ?? []) as any);
    setSubs((s.data ?? []) as any);
    setPermSlots((ps.data ?? []) as any);
    setVacations((v.data ?? []) as any);
    setTrainerRiders((tr.data ?? []) as any);
    setGuests((g.data ?? []) as any);
    setTrainerIds(((roles.data ?? []) as any[]).map((r) => r.user_id));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (focusUserId) setOpenUserId(focusUserId);
  }, [focusUserId]);

  const setLevel = async (p: Profile, level: RidingLevel) => {
    const { error } = await supabase.from("profiles").update({ riding_level: level } as any).eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    // Keep the trainer roster in sync — the source of truth for group logic.
    for (const trainerId of trainerIds) {
      const existing = trainerRiders.find((r) => r.trainer_user_id === trainerId && r.rider_user_id === p.id);
      if (existing) {
        await supabase.from("trainer_riders").update({ level }).eq("id", existing.id);
      } else {
        await supabase.from("trainer_riders").insert({ trainer_user_id: trainerId, rider_user_id: p.id, level });
      }
    }
    toast.success(`${p.full_name}: ${LEVEL_META[level].label}`);
    load();
  };

  const renameUser = async (p: Profile, first: string, last: string, phone: string) => {
    const fullName = `${first.trim()} ${last.trim()}`.trim();
    if (!fullName) { toast.error("Vardas negali būti tuščias"); return; }
    const { error } = await supabase.from("profiles").update({ full_name: fullName, phone: phone.trim() || null }).eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta");
    load();
  };

  const resetPassword = async (p: Profile) => {
    if (!confirm(`Atstatyti ${p.full_name} slaptažodį į „vardas_equus123"?`)) return;
    const { data, error } = await supabase.functions.invoke("admin-reset-password", { body: { user_id: p.id } });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success(`Naujas slaptažodis: ${(data as any).password}`);
  };

  const deleteUser = async (p: Profile) => {
    const txt = prompt(
      `Visiškai ištrinti vartotoją "${p.full_name}"?\n\nVisi jo duomenys (pamokos, abonementai, žinutės, nuolatiniai laikai) bus negrįžtamai pašalinti.\n\nĮrašykite vartotojo vardą patvirtinti:`
    );
    if (txt !== p.full_name) { if (txt !== null) toast.error("Vardas nesutampa — atšaukta"); return; }
    const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { user_id: p.id } });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success(`${p.full_name} ištrintas`);
    setOpenUserId(null);
    load();
  };

  const togglePaid = async (subId: string, paid: boolean) => {
    const { error } = await supabase.from("subscriptions").update({ paid }).eq("id", subId);
    if (error) { toast.error(error.message); return; }
    load();
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
    load();
  };

  const deleteSub = async (s: Sub) => {
    if (!confirm(`Ištrinti šį abonementą (${s.lessons_used}/${s.lessons_total})?`)) return;
    const { error } = await supabase.from("subscriptions").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Ištrinta");
    load();
  };

  const toggleGuestNewcomer = async (g: GuestRider) => {
    const { error } = await supabase.from("guest_riders").update({ is_newcomer: !g.is_newcomer }).eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success(g.is_newcomer ? "Pažymėta kaip nebe naujokė/as" : "Pažymėta kaip naujokė/as");
    load();
  };

  const editGuest = async (g: GuestRider) => {
    const first = prompt("Vardas:", g.first_name);
    if (first === null) return;
    const last = prompt("Pavardė:", g.last_name);
    if (last === null) return;
    const phone = prompt("Telefonas:", g.phone ?? "") ?? g.phone;
    const { error } = await supabase.from("guest_riders")
      .update({ first_name: first.trim(), last_name: last.trim(), phone: (phone ?? "").trim() || null })
      .eq("id", g.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta");
    load();
  };

  const linkGuestToAccount = async (guestId: string, userId: string) => {
    const { data, error } = await supabase.rpc("link_guest_rider_to_account", { _guest_id: guestId, _user_id: userId } as any);
    if (error) { toast.error(error.message); return; }
    const res = data as any;
    toast.success(`Susieta. Perkelta: ${res?.bookings_moved ?? 0} pamokos, ${res?.subscriptions_moved ?? 0} abonementai.`);
    setLinkGuest(null);
    load();
  };

  const subsByUser = useMemo(() => {
    const m: Record<string, Sub[]> = {};
    for (const s of subs) { if (s.user_id) (m[s.user_id] ||= []).push(s); }
    return m;
  }, [subs]);
  const permByUser = useMemo(() => {
    const m: Record<string, PermSlot[]> = {};
    for (const s of permSlots) (m[s.user_id] ||= []).push(s);
    return m;
  }, [permSlots]);
  const vacationByUser = useMemo(() => new Set(vacations.map((v) => v.user_id)), [vacations]);
  const rosterLevelByUser = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of trainerRiders) if (r.rider_user_id) m[r.rider_user_id] = r.level;
    return m;
  }, [trainerRiders]);
  const upcomingCountByGuest = useMemo(() => ({} as Record<string, number>), [guests]);

  const filtered = profiles.filter((p) => {
    const q = query.trim().toLowerCase();
    if (q && !(p.full_name.toLowerCase().includes(q) || (p.phone ?? "").toLowerCase().includes(q))) return false;
    const us = subsByUser[p.id] ?? [];
    if (filter === "hasSub" && us.length === 0) return false;
    if (filter === "noSub" && us.length > 0) return false;
    if (filter === "permanent" && (permByUser[p.id] ?? []).length === 0) return false;
    return true;
  });

  const filteredGuests = guests.filter((g) => {
    const q = query.trim().toLowerCase();
    if (q && !(`${g.first_name} ${g.last_name}`.toLowerCase().includes(q) || (g.phone ?? "").toLowerCase().includes(q))) return false;
    return true;
  });

  const activeUser = profiles.find((p) => p.id === openUserId) ?? null;

  return (
    <div className="space-y-3">
      {focusUserId && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gold/25 bg-gold/5 px-4 py-2 text-sm">
          <span>
            Rodomas vienas vartotojas:{" "}
            <strong className="text-gold">{profiles.find((p) => p.id === focusUserId)?.full_name ?? "…"}</strong>
          </span>
          <Button variant="ghost" size="sm" onClick={onClearFocus}>Rodyti visus</Button>
        </div>
      )}

      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur pb-2 pt-1 space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ieškoti pagal vardą ar telefoną…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors",
                filter === f.key ? "bg-gold/15 text-gold border-gold/40" : "bg-background/40 text-foreground/70 border-gold/15",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filter === "guests" ? (
        <div className="space-y-2">
          {filteredGuests.length === 0 && <p className="text-center text-muted-foreground italic py-8">Svečių nėra</p>}
          {filteredGuests.map((g) => (
            <div key={g.id} className="bg-gradient-card border border-gold/15 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{g.first_name} {g.last_name}</span>
                  {g.is_newcomer && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">Naujokė/as</span>}
                  {g.linked_user_id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/30">Susieta</span>}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1"><PhoneCall className="w-3 h-3" />{g.phone ?? "—"}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => editGuest(g)}>Redaguoti</Button>
                {g.is_newcomer && (
                  <Button variant="ghost" size="sm" onClick={() => toggleGuestNewcomer(g)}>Nebe naujokė</Button>
                )}
                {!g.linked_user_id && (
                  <Button variant="gold" size="sm" onClick={() => setLinkGuest(g)}>
                    <Link2 className="w-3.5 h-3.5" /> Susieti
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {loading && <p className="text-center text-muted-foreground py-8">Kraunama…</p>}
          {!loading && filtered.length === 0 && <p className="text-center text-muted-foreground italic py-8">Nieko nerasta</p>}
          {filtered.map((p) => {
            const us = subsByUser[p.id] ?? [];
            const latest = us.find((s) => new Date(s.expires_at) >= new Date()) ?? us[0];
            const remaining = latest ? latest.lessons_total - latest.lessons_used : null;
            const unpaid = us.some((s) => !s.paid);
            const permCount = (permByUser[p.id] ?? []).length;
            const onVacation = vacationByUser.has(p.id);
            const rosterLevel = rosterLevelByUser[p.id];
            return (
              <button
                key={p.id}
                onClick={() => setOpenUserId(p.id)}
                className="w-full text-left bg-gradient-card border border-gold/15 rounded-lg px-4 py-3 flex items-center justify-between gap-3 hover:border-gold/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-base text-gold truncate">{p.full_name}</span>
                    <RiderLevelBadge level={rosterLevel ?? (p as any).riding_level} compact />
                  </div>
                  <div className="text-xs text-muted-foreground">{p.phone ?? "—"}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                  {remaining !== null && (
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border", remaining <= 1 ? "bg-blush/15 text-blush border-blush/30" : "bg-background/40 border-gold/15 text-muted-foreground")}>
                      {remaining}/{latest.lessons_total} liko
                    </span>
                  )}
                  {unpaid && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blush/15 text-blush border border-blush/30">Neapmokėta</span>}
                  {onVacation && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">Atostogos</span>}
                  {permCount > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-background/40 border border-gold/15 text-muted-foreground">{permCount} nuolat.</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet open={!!activeUser} onOpenChange={(o) => { if (!o) { setOpenUserId(null); onClearFocus?.(); } }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {activeUser && (
            <UserDetails
              key={activeUser.id}
              profile={activeUser}
              subs={subsByUser[activeUser.id] ?? []}
              permSlots={permByUser[activeUser.id] ?? []}
              rosterLevel={rosterLevelByUser[activeUser.id]}
              onSetLevel={(lvl) => setLevel(activeUser, lvl)}
              onRename={(f, l, ph) => renameUser(activeUser, f, l, ph)}
              onResetPassword={() => resetPassword(activeUser)}
              onDelete={() => deleteUser(activeUser)}
              onTogglePaid={togglePaid}
              onEditLessons={editLessons}
              onDeleteSub={deleteSub}
            />
          )}
        </SheetContent>
      </Sheet>

      <LinkGuestDialog
        guest={linkGuest}
        profiles={profiles}
        onClose={() => setLinkGuest(null)}
        onConfirm={(userId) => linkGuest && linkGuestToAccount(linkGuest.id, userId)}
      />
    </div>
  );
}

function UserDetails({
  profile, subs, permSlots, rosterLevel, onSetLevel, onRename, onResetPassword, onDelete, onTogglePaid, onEditLessons, onDeleteSub,
}: {
  profile: Profile; subs: Sub[]; permSlots: PermSlot[]; rosterLevel?: string;
  onSetLevel: (lvl: RidingLevel) => void;
  onRename: (first: string, last: string, phone: string) => void;
  onResetPassword: () => void;
  onDelete: () => void;
  onTogglePaid: (subId: string, paid: boolean) => void;
  onEditLessons: (s: Sub) => void;
  onDeleteSub: (s: Sub) => void;
}) {
  const parts = profile.full_name.split(" ");
  const [first, setFirst] = useState(parts[0] ?? "");
  const [last, setLast] = useState(parts.slice(1).join(" "));
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="font-display text-gradient-gold text-2xl">{profile.full_name}</SheetTitle>
      </SheetHeader>

      <Tabs defaultValue="profile">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="profile">Profilis</TabsTrigger>
          <TabsTrigger value="subs">Abonementai</TabsTrigger>
          <TabsTrigger value="lessons">Treniruotės</TabsTrigger>
          <TabsTrigger value="actions">Veiksmai</TabsTrigger>
        </TabsList>

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
              <RiderLevelSelect value={rosterLevel ?? (profile as any).riding_level} onChange={onSetLevel} />
              <RiderLevelBadge level={rosterLevel ?? (profile as any).riding_level} />
            </div>
            <p className="text-xs text-muted-foreground italic">Atnaujina ir profilį, ir trenerio raitelių sąrašą.</p>
          </div>
        </TabsContent>

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

        <TabsContent value="lessons" className="space-y-2 pt-4">
          {permSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nėra nuolatinių laikų</p>
          ) : (
            <ul className="space-y-1.5">
              {permSlots.map((ps) => (
                <li key={ps.id} className="text-sm bg-background/40 border border-gold/10 rounded px-3 py-2">
                  {WEEKDAYS_LT[ps.day_of_week - 1]} · {formatTime(ps.slot_time)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground italic">Nuolatinius laikus tvarkykite skiltyje „Nuolatiniai“.</p>
        </TabsContent>

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

function LinkGuestDialog({ guest, profiles, onClose, onConfirm }: {
  guest: GuestRider | null; profiles: Profile[]; onClose: () => void; onConfirm: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setQuery(""); setSelected(null); }, [guest]);
  const results = profiles.filter((p) => p.full_name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Dialog open={!!guest} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Susieti {guest?.first_name} {guest?.last_name} su paskyra</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Ieškoti paskyros…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded border text-sm",
                  selected === p.id ? "border-gold bg-gold/10" : "border-gold/15",
                )}
              >
                {p.full_name} <span className="text-xs text-muted-foreground">{p.phone}</span>
              </button>
            ))}
            {results.length === 0 && <p className="text-sm text-muted-foreground italic py-2">Nerasta</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Atšaukti</Button>
          <Button variant="gold" disabled={!selected} onClick={() => selected && onConfirm(selected)}>
            <UserPlus2 className="w-4 h-4" /> Susieti
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
