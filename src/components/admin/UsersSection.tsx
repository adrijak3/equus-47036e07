import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RiderLevelBadge } from "@/components/RiderLevelBadge";
import { UserProfileSheet } from "@/components/admin/UserProfileSheet";
import { Search, UserPlus2, PhoneCall, Link2, ChevronLeft, ChevronRight } from "lucide-react";

interface Profile { id: string; full_name: string; phone: string | null; riding_level?: string | null; }
interface Sub { id: string; user_id: string | null; lessons_total: number; lessons_used: number; expires_at: string; paid: boolean; }
interface PermSlot { id: string; user_id: string; day_of_week: number; slot_time: string; }
interface Vacation { id: string; user_id: string; starts_on: string; ends_on: string; }
interface TrainerRiderRow { id: string; trainer_user_id: string; rider_user_id: string | null; level: string; }
interface GuestRider {
  id: string; first_name: string; last_name: string; phone: string | null; email: string | null;
  is_newcomer: boolean; linked_user_id: string | null;
}

type FilterKey = "all" | "hasSub" | "noSub" | "permanent" | "guests";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Visi" },
  { key: "hasSub", label: "Turi abonementą" },
  { key: "noSub", label: "Be abonemento" },
  { key: "permanent", label: "Nuolatiniai laikai" },
  { key: "guests", label: "Svečiai (naujokai)" },
];

const PAGE_SIZE = 15;

export function UsersSection({ focusUserId, onClearFocus }: { focusUserId?: string | null; onClearFocus?: () => void } = {}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [permSlots, setPermSlots] = useState<PermSlot[]>([]);
  const [vacations, setVacations] = useState<Vacation[]>([]);
  const [trainerRiders, setTrainerRiders] = useState<TrainerRiderRow[]>([]);
  const [guests, setGuests] = useState<GuestRider[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [linkGuest, setLinkGuest] = useState<GuestRider | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [p, s, ps, v, tr, g] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, riding_level").order("full_name"),
      supabase.from("subscriptions").select("id, user_id, lessons_total, lessons_used, expires_at, paid").order("purchase_date", { ascending: false }),
      supabase.from("permanent_slots").select("id, user_id, day_of_week, slot_time"),
      supabase.from("vacations").select("id, user_id, starts_on, ends_on").lte("starts_on", today).gte("ends_on", today),
      supabase.from("trainer_riders").select("id, trainer_user_id, rider_user_id, level"),
      supabase.from("guest_riders").select("id, first_name, last_name, phone, email, is_newcomer, linked_user_id").order("created_at", { ascending: false }),
    ]);
    setProfiles((p.data ?? []) as any);
    setSubs((s.data ?? []) as any);
    setPermSlots((ps.data ?? []) as any);
    setVacations((v.data ?? []) as any);
    setTrainerRiders((tr.data ?? []) as any);
    setGuests((g.data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (focusUserId) setOpenUserId(focusUserId);
  }, [focusUserId]);

  // reset to page 1 whenever the visible set changes
  useEffect(() => { setPage(1); }, [query, filter]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

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

      {/* Sticky search + filters, so this never disappears while scrolling a long list */}
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
        <>
          {/* Compact table instead of a long scrolling list */}
          <div className="rounded-lg border border-gold/15 overflow-hidden bg-gradient-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gold/15 bg-background/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Vardas</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Telefonas</th>
                  <th className="px-4 py-2.5 font-medium">Būsena</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={3} className="text-center text-muted-foreground py-8">Kraunama…</td></tr>
                )}
                {!loading && pageRows.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-muted-foreground italic py-8">Nieko nerasta</td></tr>
                )}
                {pageRows.map((p) => {
                  const us = subsByUser[p.id] ?? [];
                  const latest = us.find((s) => new Date(s.expires_at) >= new Date()) ?? us[0];
                  const remaining = latest ? latest.lessons_total - latest.lessons_used : null;
                  const unpaid = us.some((s) => !s.paid);
                  const permCount = (permByUser[p.id] ?? []).length;
                  const onVacation = vacationByUser.has(p.id);
                  const rosterLevel = rosterLevelByUser[p.id];
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setOpenUserId(p.id)}
                      className="border-b border-gold/10 last:border-0 cursor-pointer hover:bg-gold/5 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-gold truncate">{p.full_name}</span>
                          <RiderLevelBadge level={rosterLevel ?? (p as any).riding_level} compact />
                        </div>
                        <div className="text-xs text-muted-foreground sm:hidden">{p.phone ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell text-muted-foreground">{p.phone ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {remaining !== null && (
                            <span className={cn("text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap", remaining <= 1 ? "bg-blush/15 text-blush border-blush/30" : "bg-background/40 border-gold/15 text-muted-foreground")}>
                              {remaining}/{latest.lessons_total} liko
                            </span>
                          )}
                          {unpaid && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blush/15 text-blush border border-blush/30 whitespace-nowrap">Neapmokėta</span>}
                          {onVacation && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30 whitespace-nowrap">Atostogos</span>}
                          {permCount > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-background/40 border border-gold/15 text-muted-foreground whitespace-nowrap">{permCount} nuolat.</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between px-1 text-sm">
              <span className="text-xs text-muted-foreground">
                {filtered.length} vartotojai · puslapis {pageSafe}/{pageCount}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" disabled={pageSafe <= 1} onClick={() => setPage(pageSafe - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={pageSafe >= pageCount} onClick={() => setPage(pageSafe + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <UserProfileSheet
        userId={openUserId}
        open={!!openUserId}
        onOpenChange={(o) => { if (!o) { setOpenUserId(null); onClearFocus?.(); } }}
        onChanged={load}
      />

      <LinkGuestDialog
        guest={linkGuest}
        profiles={profiles}
        onClose={() => setLinkGuest(null)}
        onConfirm={(userId) => linkGuest && linkGuestToAccount(linkGuest.id, userId)}
      />
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
