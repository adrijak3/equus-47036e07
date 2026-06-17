import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { WEEKDAYS_LT, formatTime, isValidTime, calculateSubPriceByType, expiryFromPurchase, formatDateISO, LESSON_TYPE_LABEL, type LessonType } from "@/lib/equus";
import { Plus, Trash2, Check, X, Inbox, Users, CalendarCog, MessageSquare, Star, Clock, Wallet, KeyRound, Link2, AlertCircle, BarChart3, Pencil, ListTree } from "lucide-react";
import { TimeInput } from "@/components/TimeInput";

interface TimeSlot { id: string; day_of_week: number; slot_time: string; max_capacity: number; one_off_date: string | null; }
interface CancelReq {
  id: string; booking_id: string; user_id: string; reason: string; sickness: boolean;
  status: string; created_at: string; admin_decision_counts: boolean | null;
  profile_name?: string; slot_date?: string; slot_time?: string;
  document_url?: string | null; document_deadline?: string | null;
}
interface Profile { id: string; full_name: string; phone: string | null; }
interface Sub {
  id: string; user_id: string; lessons_total: number; lessons_used: number;
  price: number; purchase_date: string; expires_at: string; paid: boolean;
  lesson_type?: string;
}
interface Msg { id: string; user_id: string; body: string; created_at: string; read_by_admin: boolean; from_admin: boolean; parent_id: string | null; profile_name?: string; }

export default function Admin() {
  const [alerts, setAlerts] = useState({ sickness: 0, missingDoc: 0, unread: 0 });
  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [c, u] = await Promise.all([
        supabase.from("cancellation_requests").select("id, sickness, document_url, document_deadline, status").eq("status", "pending"),
        supabase.from("messages").select("id").eq("from_admin", false).eq("read_by_admin", false),
      ]);
      const reqs = (c.data ?? []) as any[];
      setAlerts({
        sickness: reqs.filter((r) => r.sickness).length,
        missingDoc: reqs.filter((r) => r.sickness && !r.document_url && r.document_deadline && r.document_deadline < today).length,
        unread: (u.data ?? []).length,
      });
    })();
  }, []);

  const totalAlerts = alerts.sickness + alerts.missingDoc + alerts.unread;

  return (
    <div className="container max-w-6xl py-8 sm:py-14">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70 mb-2">Administracija</p>
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold">Valdymas</h1>
        {totalAlerts > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {alerts.unread > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gold/15 text-gold border border-gold/40">
                <MessageSquare className="w-3 h-3" /> {alerts.unread} nauj. žinučių
              </span>
            )}
            {alerts.sickness > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blush/15 text-blush border border-blush/40 animate-pulse">
                <AlertCircle className="w-3 h-3" /> {alerts.sickness} ligos atšaukimų
              </span>
            )}
            {alerts.missingDoc > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-destructive/15 text-destructive border border-destructive/40 animate-pulse">
                <AlertCircle className="w-3 h-3" /> {alerts.missingDoc} be pažymos (terminas baigtas)
              </span>
            )}
          </div>
        )}
        <div className="gold-divider mt-4 max-w-[120px]" />
      </header>

      <Tabs defaultValue="schedule">
        <TabsList className="grid grid-cols-3 sm:grid-cols-6 w-full bg-background/50 mb-6 h-auto">
          <TabsTrigger value="schedule" className="gap-1.5 text-xs sm:text-sm"><CalendarCog className="w-4 h-4" /> <span className="hidden sm:inline">Tvarkaraštis</span></TabsTrigger>
          <TabsTrigger value="permanent" className="gap-1.5 text-xs sm:text-sm"><Star className="w-4 h-4" /> <span className="hidden sm:inline">Nuolatiniai</span></TabsTrigger>
          <TabsTrigger value="cancels" className="gap-1.5 text-xs sm:text-sm relative">
            <Inbox className="w-4 h-4" /> <span className="hidden sm:inline">Atšaukimai</span>
            {(alerts.sickness + alerts.missingDoc) > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-blush text-[9px] text-white flex items-center justify-center font-bold">{alerts.sickness + alerts.missingDoc}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5 text-xs sm:text-sm"><Users className="w-4 h-4" /> <span className="hidden sm:inline">Vartotojai</span></TabsTrigger>
          <TabsTrigger value="subs" className="gap-1.5 text-xs sm:text-sm"><Wallet className="w-4 h-4" /> <span className="hidden sm:inline">Abonimentas</span></TabsTrigger>
          <TabsTrigger value="messages" className="gap-1.5 text-xs sm:text-sm relative">
            <MessageSquare className="w-4 h-4" /> <span className="hidden sm:inline">Žinutės</span>
            {alerts.unread > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-gold text-[9px] text-background flex items-center justify-center font-bold">{alerts.unread}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule"><ScheduleTab /></TabsContent>
        <TabsContent value="permanent"><PermanentSlotsAdminTab /></TabsContent>
        <TabsContent value="cancels"><CancellationsTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="subs"><SubsTab /></TabsContent>
        <TabsContent value="messages"><MessagesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- SCHEDULE ---------- */
function ScheduleTab() {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [open, setOpen] = useState(false);
  const [newDay, setNewDay] = useState(1);
  const [newTime, setNewTime] = useState("17:00");
  const [newCap, setNewCap] = useState(5);
  const [newOneOff, setNewOneOff] = useState(false);
  const [newOneOffDate, setNewOneOffDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const load = async () => {
    const { data } = await supabase.from("time_slots").select("*").eq("active", true)
      .order("day_of_week").order("slot_time");
    setSlots(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!isValidTime(newTime)) { toast.error("Įveskite laiką formatu HH:MM"); return; }
    let dayToUse = newDay;
    let oneOff: string | null = null;
    if (newOneOff) {
      oneOff = newOneOffDate;
      // Derive day_of_week from the chosen date so it appears on the right column
      const d = new Date(newOneOffDate + "T00:00:00");
      const js = d.getDay(); // 0=Sun..6=Sat
      dayToUse = js === 0 ? 7 : js;
    }
    const { error } = await supabase.from("time_slots").insert({
      day_of_week: dayToUse, slot_time: newTime, max_capacity: newCap, one_off_date: oneOff,
    } as any);
    if (error) { toast.error(error.code === "23505" ? "Toks slot jau egzistuoja" : error.message); return; }
    toast.success(oneOff ? `Pridėta tik ${oneOff}` : "Pridėta (kas savaitę)");
    setOpen(false); setNewOneOff(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Pašalinti šį laiką?")) return;
    const { error } = await supabase.from("time_slots").update({ active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta"); load();
  };

  const updateCapacity = async (id: string, newCap: number) => {
    if (!Number.isFinite(newCap) || newCap < 1 || newCap > 50) {
      toast.error("Talpa turi būti 1–50"); return;
    }
    const { error } = await supabase.from("time_slots").update({ max_capacity: newCap }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Talpa atnaujinta"); load();
  };

  const updateSlotTime = async (id: string, newT: string) => {
    if (!isValidTime(newT)) { toast.error("Įveskite laiką formatu HH:MM"); return; }
    const { error } = await supabase.from("time_slots").update({ slot_time: newT }).eq("id", id);
    if (error) {
      toast.error(error.code === "23505" ? "Toks laikas jau egzistuoja" : error.message);
      return;
    }
    toast.success("Laikas atnaujintas"); load();
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button variant="ghost" size="sm" className="mr-2" onClick={async () => {
          const today = new Date().toISOString().slice(0,10);
          const { data: stale } = await supabase.from("time_slots")
            .select("id, one_off_date").not("one_off_date","is",null).lt("one_off_date", today);
          const ids = (stale ?? []).map((s: any) => s.id);
          if (ids.length === 0) { toast.info("Pasenusių vienkartinių laikų nėra"); return; }
          if (!confirm(`Ištrinti ${ids.length} pasenusių vienkartinių laikų?`)) return;
          const { error } = await supabase.from("time_slots").delete().in("id", ids);
          if (error) { toast.error(error.message); return; }
          toast.success(`Ištrinta ${ids.length}`); load();
        }}>
          🧹 Išvalyti senus
        </Button>
        <Button variant="gold" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Naujas laikas</Button>
      </div>

      <p className="text-xs text-muted-foreground mb-3 italic">
        Talpą ir laiką gali keisti tiesiogiai — paspausk pieštuko ikoną prie reikšmės.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[1,2,3,4,5,6,7].map((dow) => (
          <div key={dow} className="bg-gradient-card border border-gold/15 rounded-lg p-4">
            <h3 className="font-display text-lg text-gold mb-3">{WEEKDAYS_LT[dow - 1]}</h3>
            <ul className="space-y-1.5">
              {slots.filter((s) => s.day_of_week === dow).map((s) => (
                <SlotRow
                  key={s.id}
                  slot={s}
                  onCapacity={(n) => updateCapacity(s.id, n)}
                  onTime={(t) => updateSlotTime(s.id, t)}
                  onRemove={() => remove(s.id)}
                />
              ))}
              {slots.filter((s) => s.day_of_week === dow).length === 0 && (
                <li className="text-xs text-muted-foreground italic">Nėra</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader><DialogTitle className="font-display text-gradient-gold text-2xl">Naujas laikas</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={newOneOff} onChange={(e) => setNewOneOff(e.target.checked)} className="accent-gold" />
              Tik šį kartą (vienai dienai, neatsikartoja kas savaitę)
            </label>
            {newOneOff ? (
              <div>
                <Label>Data</Label>
                <Input type="date" value={newOneOffDate} onChange={(e) => setNewOneOffDate(e.target.value)} />
              </div>
            ) : (
              <div>
                <Label>Diena (kas savaitę)</Label>
                <select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{WEEKDAYS_LT[d - 1]}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Laikas</Label>
              <TimeInput value={newTime} onChange={setNewTime} />
              <p className="text-[11px] text-muted-foreground mt-1">Įvesk skaitmenis — dvitaškis pridedamas automatiškai (pvz. 1730 → 17:30).</p>
            </div>
            <div>
              <Label>Talpa</Label>
              <Input type="number" min={1} max={50} value={newCap} onChange={(e) => setNewCap(parseInt(e.target.value) || 5)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={add}>Pridėti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- SLOT ROW (inline-editable time + capacity) ---------- */
function SlotRow({
  slot, onCapacity, onTime, onRemove,
}: {
  slot: TimeSlot;
  onCapacity: (n: number) => void | Promise<void>;
  onTime: (t: string) => void | Promise<void>;
  onRemove: () => void;
}) {
  const [editTime, setEditTime] = useState(false);
  const [editCap, setEditCap] = useState(false);
  const [t, setT] = useState(slot.slot_time.slice(0, 5));
  const [c, setC] = useState(slot.max_capacity);

  useEffect(() => { setT(slot.slot_time.slice(0, 5)); }, [slot.slot_time]);
  useEffect(() => { setC(slot.max_capacity); }, [slot.max_capacity]);

  const saveTime = async () => { await onTime(t); setEditTime(false); };
  const saveCap = async () => { await onCapacity(c); setEditCap(false); };

  return (
    <li className="flex items-center justify-between gap-2 text-sm px-2 py-1.5 rounded hover:bg-gold/5">
      {editTime ? (
        <div className="flex items-center gap-1">
          <TimeInput value={t} onChange={setT} className="h-7 w-20 text-xs" />
          <button onClick={saveTime} className="text-gold hover:text-gold/80" title="Išsaugoti">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setT(slot.slot_time.slice(0, 5)); setEditTime(false); }} className="text-muted-foreground hover:text-destructive" title="Atšaukti">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button onClick={() => setEditTime(true)} className="tabular-nums inline-flex items-center gap-1 hover:text-gold group">
          {formatTime(slot.slot_time)}
          {slot.one_off_date && (
            <span className="ml-1 text-[10px] text-blush">({slot.one_off_date})</span>
          )}
          <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
        </button>
      )}

      {editCap ? (
        <div className="flex items-center gap-1">
          <Input
            type="number" min={1} max={50}
            value={c}
            onChange={(e) => setC(parseInt(e.target.value) || 0)}
            className="h-7 w-14 text-xs tabular-nums"
          />
          <button onClick={saveCap} className="text-gold hover:text-gold/80" title="Išsaugoti">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => { setC(slot.max_capacity); setEditCap(false); }} className="text-muted-foreground hover:text-destructive" title="Atšaukti">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button onClick={() => setEditCap(true)} className="text-xs text-muted-foreground hover:text-gold inline-flex items-center gap-1 group">
          cap {slot.max_capacity}
          <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
        </button>
      )}

      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive" title="Pašalinti">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

/* ---------- PROFILE LINKS (joint accounts) ---------- */
function ProfileLinksTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [links, setLinks] = useState<{ id: string; parent_user_id: string; linked_profile_id: string; display_name: string }[]>([]);
  const [parent, setParent] = useState("");
  const [child, setChild] = useState("");
  const [name, setName] = useState("");

  const load = async () => {
    const [p, l] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone").order("full_name"),
      supabase.from("profile_links" as any).select("*").order("created_at", { ascending: false }),
    ]);
    setProfiles(p.data ?? []);
    setLinks(((l.data as any[]) ?? []) as any);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!parent || !child || parent === child) { toast.error("Pasirinkite skirtingus profilius"); return; }
    const dn = name.trim() || profiles.find((p) => p.id === child)?.full_name || "Profilis";
    const { error } = await supabase.from("profile_links" as any).insert({
      parent_user_id: parent, linked_profile_id: child, display_name: dn,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Susieta"); setParent(""); setChild(""); setName(""); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Pašalinti susiejimą?")) return;
    const { error } = await supabase.from("profile_links" as any).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? "—";

  return (
    <div className="space-y-4">
      <div className="bg-gradient-card border border-gold/15 rounded-lg p-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          Susiek du profilius — „tėvinė" paskyra galės registruotis ir už susietą profilį (pvz. Jurgita ↔ Nomina).
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label>Tėvinė paskyra</Label>
            <select value={parent} onChange={(e) => setParent(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">— pasirinkite —</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div>
            <Label>Susietas profilis</Label>
            <select value={child} onChange={(e) => setChild(e.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">— pasirinkite —</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <div>
            <Label>Rodomas pavadinimas</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="pvz. Nomina" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="gold" onClick={add}><Plus className="w-4 h-4" /> Susieti</Button>
        </div>
      </div>

      {links.length === 0 ? (
        <p className="text-center text-muted-foreground italic py-8">Susiejimų nėra</p>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between bg-gradient-card border border-gold/15 rounded-lg px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-gold">{nameOf(l.parent_user_id)}</span>
                <span className="mx-2 text-muted-foreground">→</span>
                <span>{l.display_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">({nameOf(l.linked_profile_id)})</span>
              </div>
              <button onClick={() => remove(l.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- STATISTICS DASHBOARD ---------- */
function StatsTab() {
  const [stats, setStats] = useState<{
    activeUsers: number; activeSubs: number; unpaidSubs: number;
    bookingsThisMonth: number; cancelsThisMonth: number; sicknessThisMonth: number;
    horseLoad: { name: string; count: number }[];
    topUsers: { name: string; count: number }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const todayISO = today.toISOString().slice(0, 10);
      const [pr, subs, b, c, ha, horses] = await Promise.all([
        supabase.from("profiles").select("id"),
        supabase.from("subscriptions").select("id, paid, expires_at, user_id").gte("expires_at", todayISO),
        supabase.from("bookings").select("id, user_id, status, slot_date").gte("slot_date", monthStart),
        supabase.from("cancellation_requests").select("id, sickness, created_at").gte("created_at", monthStart),
        supabase.from("horse_assignments").select("horse_id, slot_date").gte("slot_date", monthStart),
        supabase.from("horses").select("id, name"),
      ]);
      const profMap = await supabase.from("profiles").select("id, full_name");
      const nameById: Record<string, string> = Object.fromEntries((profMap.data ?? []).map((p: any) => [p.id, p.full_name]));
      const horseMap: Record<string, string> = Object.fromEntries((horses.data ?? []).map((h: any) => [h.id, h.name]));

      const bookings = (b.data ?? []) as any[];
      const horseCount: Record<string, number> = {};
      for (const a of (ha.data ?? []) as any[]) {
        const n = horseMap[a.horse_id] ?? "—";
        horseCount[n] = (horseCount[n] ?? 0) + 1;
      }
      const userCount: Record<string, number> = {};
      for (const x of bookings.filter((x) => x.status === "active")) {
        const n = nameById[x.user_id] ?? "—";
        userCount[n] = (userCount[n] ?? 0) + 1;
      }

      setStats({
        activeUsers: (pr.data ?? []).length,
        activeSubs: (subs.data ?? []).length,
        unpaidSubs: (subs.data ?? []).filter((s: any) => !s.paid).length,
        bookingsThisMonth: bookings.filter((x) => x.status === "active").length,
        cancelsThisMonth: ((c.data ?? []) as any[]).length,
        sicknessThisMonth: ((c.data ?? []) as any[]).filter((x) => x.sickness).length,
        horseLoad: Object.entries(horseCount).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
        topUsers: Object.entries(userCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
      });
    })();
  }, []);

  if (!stats) return <p className="text-center text-muted-foreground italic py-8">Kraunama…</p>;

  const Stat = ({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) => (
    <div className={`rounded-lg border p-4 ${accent ? "bg-gold/10 border-gold/40" : "bg-gradient-card border-gold/15"}`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-3xl text-gradient-gold tabular-nums mt-1">{value}</div>
    </div>
  );

  const maxHorse = Math.max(1, ...stats.horseLoad.map((h) => h.count));
  const maxUser = Math.max(1, ...stats.topUsers.map((u) => u.count));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label="Vartotojų" value={stats.activeUsers} />
        <Stat label="Aktyvių abon." value={stats.activeSubs} accent />
        <Stat label="Neapmokėtų" value={stats.unpaidSubs} />
        <Stat label="Šio mėn. pamokos" value={stats.bookingsThisMonth} accent />
        <Stat label="Atšaukimai" value={stats.cancelsThisMonth} />
        <Stat label="Iš jų liga" value={stats.sicknessThisMonth} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-gradient-card border border-gold/15 rounded-lg p-5">
          <h3 className="font-display text-lg text-gold mb-3">Žirgų krūvis (šį mėn.)</h3>
          {stats.horseLoad.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nėra duomenų</p>
          ) : (
            <ul className="space-y-2">
              {stats.horseLoad.map((h) => (
                <li key={h.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{h.name}</span><span className="text-gold tabular-nums">{h.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gold/10 overflow-hidden">
                    <div className="h-full bg-gold/70" style={{ width: `${(h.count / maxHorse) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-gradient-card border border-gold/15 rounded-lg p-5">
          <h3 className="font-display text-lg text-gold mb-3">TOP vartotojai (šį mėn.)</h3>
          {stats.topUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nėra duomenų</p>
          ) : (
            <ul className="space-y-2">
              {stats.topUsers.map((u) => (
                <li key={u.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{u.name}</span><span className="text-gold tabular-nums">{u.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gold/10 overflow-hidden">
                    <div className="h-full bg-gold/70" style={{ width: `${(u.count / maxUser) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- SUBSCRIPTIONS (full overview, per-user add) ---------- */
function SubsTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [filter, setFilter] = useState("");
  const [showOnlyUnpaid, setShowOnlyUnpaid] = useState(false);
  const [subFilter, setSubFilter] = useState<"all" | "with" | "without">("all");

  // Add dialog
  const [open, setOpen] = useState(false);
  const [selUser, setSelUser] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("sportine");
  const [lessons, setLessons] = useState(8);
  const [purchaseDate, setPurchaseDate] = useState(formatDateISO(new Date()));
  const [paid, setPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailSub, setDetailSub] = useState<Sub | null>(null);
  const [usageMap, setUsageMap] = useState<Record<string, number>>({});

  // Compute actual usage = count of bookings attributed to each sub (active/completed and counts_in_subscription)
  useEffect(() => {
    if (subs.length === 0) { setUsageMap({}); return; }
    (async () => {
      const ids = subs.map((s) => s.id);
      const { data } = await supabase
        .from("bookings")
        .select("subscription_id, status, counts_in_subscription")
        .in("subscription_id", ids);
      const m: Record<string, number> = {};
      (data ?? []).forEach((b: any) => {
        if (!b.subscription_id) return;
        if (b.counts_in_subscription === false) return;
        if (b.status === "cancelled") return;
        m[b.subscription_id] = (m[b.subscription_id] ?? 0) + 1;
      });
      setUsageMap(m);
    })();
  }, [subs]);

  const load = async () => {
    const [p, s] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone").order("full_name"),
      supabase.from("subscriptions").select("*").order("purchase_date", { ascending: false }),
    ]);
    setProfiles(p.data ?? []);
    setSubs((s.data ?? []) as any);
  };
  useEffect(() => { load(); }, []);

  const togglePaid = async (subId: string, p: boolean) => {
    const { error } = await supabase.from("subscriptions").update({ paid: p }).eq("id", subId);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const editLessons = async (s: Sub) => {
    const txt = prompt(`Naujas treniruočių skaičius (dabar ${s.lessons_total}):`, String(s.lessons_total));
    if (txt === null) return;
    const n = parseInt(txt);
    if (!Number.isFinite(n) || n < 1 || n > 100) { toast.error("Skaičius turi būti 1–100"); return; }
    const newUsed = Math.min(s.lessons_used, n);
    const { error } = await supabase.from("subscriptions")
      .update({ lessons_total: n, lessons_used: newUsed }).eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta"); load();
  };

  const deleteSub = async (s: Sub) => {
    if (!confirm(`Ištrinti abonementą (${s.lessons_used}/${s.lessons_total})?`)) return;
    const { error } = await supabase.from("subscriptions").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Ištrinta"); load();
  };

  const newPrice = calculateSubPriceByType(lessons, lessonType);

  const addSub = async () => {
    if (!selUser) { toast.error("Pasirinkite vartotoją"); return; }
    const lt = lessonType === "vienkartine" ? 1 : lessons;
    setSaving(true);
    const { error } = await supabase.from("subscriptions").insert({
      user_id: selUser,
      lessons_total: lt,
      lesson_type: lessonType,
      price: newPrice,
      purchase_date: purchaseDate,
      expires_at: expiryFromPurchase(purchaseDate),
      paid,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Pridėta");
    setOpen(false);
    setSelUser(""); setLessons(8); setPaid(false); setLessonType("sportine");
    load();
  };

  const filteredProfiles = profiles.filter((p) => {
    if (filter && !p.full_name.toLowerCase().includes(filter.toLowerCase())) return false;
    const us = subs.filter((s) => s.user_id === p.id);
    if (showOnlyUnpaid && !us.some((s) => !s.paid)) return false;
    if (subFilter === "with" && us.length === 0) return false;
    if (subFilter === "without" && us.length > 0) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Input
          placeholder="Ieškoti vartotojo..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={subFilter}
          onChange={(e) => setSubFilter(e.target.value as any)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">Visi vartotojai</option>
          <option value="with">Su abonimentu</option>
          <option value="without">Be abonimento</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={showOnlyUnpaid} onChange={(e) => setShowOnlyUnpaid(e.target.checked)} className="accent-gold" />
          Tik su neapmokėtais
        </label>
        <div className="flex-1" />
        <Button variant="gold" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Naujas abonementas</Button>
      </div>

      <div className="space-y-2">
        {filteredProfiles.map((p) => {
          const us = subs.filter((s) => s.user_id === p.id);
          const unpaid = us.some((s) => !s.paid);
          return (
            <details key={p.id} className="bg-gradient-card border border-gold/15 rounded-lg" open={us.length > 0 && unpaid}>
              <summary className="px-5 py-3 cursor-pointer flex items-center justify-between">
                <div>
                  <div className="font-display text-base text-gold">{p.full_name}</div>
                  <div className="text-xs text-muted-foreground">{p.phone ?? "—"} · {us.length} ab.</div>
                </div>
                <div className="flex items-center gap-2">
                  {unpaid && <span className="text-xs px-2 py-0.5 rounded-full bg-blush/15 text-blush border border-blush/30">Neapmokėta</span>}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelUser(p.id); setOpen(true);
                    }}
                    className="text-xs px-2 py-1 rounded border border-gold/30 text-gold hover:bg-gold/10"
                  >
                    + Pridėti
                  </button>
                </div>
              </summary>
              <div className="border-t border-gold/10 px-5 py-3">
                {us.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Nėra abonementų</p>
                ) : (
                  <ul className="space-y-2">
                    {us.map((s) => {
                      const actual = Math.max(usageMap[s.id] ?? 0, s.lessons_used ?? 0);
                      return (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-1.5 border-b border-gold/5 last:border-0">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => editLessons(s)} className="tabular-nums hover:text-gold" title="Įvykusios treniruotės / iš viso">
                            {actual}/{s.lessons_total} · {Number(s.price).toFixed(0)}€
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailSub(s)}
                            className="text-[11px] px-1.5 py-0.5 rounded border border-gold/20 text-gold hover:bg-gold/10 inline-flex items-center gap-1"
                            title="Žiūrėti, kurios pamokos įskaičiuotos"
                          >
                            <ListTree className="w-3 h-3" /> Įvykusios treniruotės
                          </button>
                        </div>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gold/10 text-gold border border-gold/20">
                          {LESSON_TYPE_LABEL[(s.lesson_type ?? "sportine") as LessonType] ?? s.lesson_type}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">{s.purchase_date} → {s.expires_at}</span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => togglePaid(s.id, !s.paid)}
                            className={`text-xs px-2 py-1 rounded border ${s.paid ? "border-gold/30 text-gold bg-gold/10" : "border-blush/30 text-blush bg-blush/10"}`}>
                            {s.paid ? "Apmokėta" : "Neapmokėta"}
                          </button>
                          <button onClick={() => deleteSub(s)} className="text-muted-foreground hover:text-destructive p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    );})}
                  </ul>
                )}
              </div>
            </details>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader><DialogTitle className="font-display text-2xl text-gradient-gold">Naujas abonementas</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Vartotojas</Label>
              <select value={selUser} onChange={(e) => setSelUser(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">— pasirinkite —</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <Label>Tipas</Label>
              <select value={lessonType} onChange={(e) => setLessonType(e.target.value as LessonType)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="sportine">Sportinė (8 → 30€/pam, kitaip 35€)</option>
                <option value="nesportine">Nesportinė (1=35€, 4=120€, 8=200€)</option>
                <option value="vienkartine">Vienkartinė (35€)</option>
              </select>
            </div>
            {lessonType !== "vienkartine" && (
              <div>
                <Label>Pamokų sk.</Label>
                <Input type="number" min={1} max={50} value={lessons}
                  onChange={(e) => setLessons(parseInt(e.target.value) || 0)} />
              </div>
            )}
            <div>
              <Label>Pirkimo data</Label>
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>
            <div className="flex items-baseline justify-between p-3 rounded-md bg-gold/5 border border-gold/15">
              <span className="text-sm">Iš viso</span>
              <span className="text-2xl font-display text-gradient-gold tabular-nums">{newPrice} €</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="accent-gold" />
              Jau apmokėta
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={addSub} disabled={saving}>Pridėti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detailSub && (
        <SubDetailDialog
          sub={detailSub}
          userName={profiles.find((p) => p.id === detailSub.user_id)?.full_name ?? "—"}
          onClose={() => setDetailSub(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* ---------- SUBSCRIPTION DETAIL DIALOG ---------- */
function SubDetailDialog({
  sub, userName, onClose, onChanged,
}: { sub: Sub; userName: string; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<{ id: string; slot_date: string; slot_time: string; status: string; counts_in_subscription: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("bookings")
      .select("id, slot_date, slot_time, status, counts_in_subscription")
      .eq("subscription_id", sub.id)
      .order("slot_date", { ascending: false });
    setRows((data ?? []) as any);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [sub.id]);

  const detach = async (bookingId: string) => {
    if (!confirm("Pašalinti šią pamoką iš abonimento? (Pati pamoka nebus ištrinta — tik atkabinta.)")) return;
    const { error } = await supabase.from("bookings")
      .update({ subscription_id: null } as any).eq("id", bookingId);
    if (error) { toast.error(error.message); return; }
    // Decrement stored counter if it's > 0
    if (sub.lessons_used > 0) {
      await supabase.from("subscriptions")
        .update({ lessons_used: sub.lessons_used - 1 }).eq("id", sub.id);
    }
    toast.success("Atkabinta");
    load();
    onChanged();
  };

  const counted = rows.filter((r) => r.status !== "cancelled" && r.counts_in_subscription !== false);
  const cancelled = rows.filter((r) => r.status === "cancelled" || r.counts_in_subscription === false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-gradient-card border-gold/20 max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-gradient-gold">{userName} · abonimento detalės</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-gold/5 border border-gold/15 px-3 py-2 tabular-nums">
            <div className="text-base">Įvykusios treniruotės: <span className="text-gold">{counted.length}/{sub.lessons_total}</span></div>
            <div className="text-xs text-muted-foreground mt-1">{sub.purchase_date} → {sub.expires_at}</div>
            {counted.length !== sub.lessons_used && (
              <button
                type="button"
                onClick={async () => {
                  const { error } = await supabase.from("subscriptions")
                    .update({ lessons_used: counted.length }).eq("id", sub.id);
                  if (error) { toast.error(error.message); return; }
                  toast.success("Sinchronizuota"); onChanged();
                }}
                className="mt-2 text-[11px] px-2 py-1 rounded border border-blush/40 text-blush hover:bg-blush/10"
                title={`Vidinis skaitiklis: ${sub.lessons_used} — paspauskite, kad sutaptų su tikru`}
              >
                Sinchronizuoti vidinį skaitiklį ({sub.lessons_used} → {counted.length})
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                // Auto-attach this user's completed bookings from the current month that have no subscription
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, "0");
                const monthStart = `${y}-${m}-01`;
                const monthEnd = `${y}-${m}-31`;
                const remaining = sub.lessons_total - counted.length;
                if (remaining <= 0) { toast.error("Abonementas pilnas"); return; }
                const { data: bks } = await supabase.from("bookings")
                  .select("id")
                  .eq("user_id", sub.user_id)
                  .eq("status", "completed")
                  .neq("counts_in_subscription", false)
                  .is("subscription_id", null)
                  .gte("slot_date", monthStart)
                  .lte("slot_date", monthEnd)
                  .order("slot_date", { ascending: true })
                  .limit(remaining);
                const ids = (bks ?? []).map((b: any) => b.id);
                if (ids.length === 0) { toast.message("Šio mėnesio neįskaičiuotų nėra"); return; }
                const { error } = await supabase.from("bookings")
                  .update({ subscription_id: sub.id } as any).in("id", ids);
                if (error) { toast.error(error.message); return; }
                await supabase.from("subscriptions")
                  .update({ lessons_used: counted.length + ids.length }).eq("id", sub.id);
                toast.success(`Priskirta ${ids.length}`); load(); onChanged();
              }}
              className="text-xs px-2 py-1 rounded border border-gold/30 text-gold hover:bg-gold/10"
            >
              Auto-priskirti šio mėnesio įvykusias
            </button>
            <button
              type="button"
              onClick={async () => {
                const txt = prompt(`Kiek pamokų jau panaudota? (0–${sub.lessons_total})`, String(sub.lessons_used));
                if (txt === null) return;
                const n = parseInt(txt);
                if (!Number.isFinite(n) || n < 0 || n > sub.lessons_total) { toast.error("Neteisingas skaičius"); return; }
                const { error } = await supabase.from("subscriptions")
                  .update({ lessons_used: n }).eq("id", sub.id);
                if (error) { toast.error(error.message); return; }
                toast.success("Atnaujinta"); onChanged();
              }}
              className="text-xs px-2 py-1 rounded border border-gold/30 text-gold hover:bg-gold/10"
            >
              Pridėti rankiniu būdu
            </button>
          </div>


          {loading ? (
            <p className="text-muted-foreground italic">Kraunama…</p>
          ) : (
            <>
              <div>
                <h4 className="text-xs uppercase tracking-wider text-gold/70 mb-1.5">Įskaičiuotos pamokos ({counted.length})</h4>
                {counted.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nėra</p>
                ) : (
                  <ul className="space-y-1">
                    {counted.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-gold/5">
                        <span className="tabular-nums">{r.slot_date} · {formatTime(r.slot_time)}</span>
                        <button onClick={() => detach(r.id)} className="text-[11px] text-muted-foreground hover:text-destructive">Atkabinti</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {cancelled.length > 0 && (
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-blush/70 mb-1.5">Atšauktos / nesiskaičiuoja ({cancelled.length})</h4>
                  <ul className="space-y-1">
                    {cancelled.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-gold/5">
                        <span className="tabular-nums text-muted-foreground">{r.slot_date} · {formatTime(r.slot_time)} <span className="text-[10px]">({r.status})</span></span>
                        <button onClick={() => detach(r.id)} className="text-[11px] text-muted-foreground hover:text-destructive">Atkabinti</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Uždaryti</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- CANCELLATIONS ---------- */
function CancellationsTab() {
  const [reqs, setReqs] = useState<CancelReq[]>([]);

  const load = async () => {
    const { data } = await supabase.from("cancellation_requests")
      .select("*, bookings(slot_date, slot_time)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    const userIds = (data ?? []).map((r: any) => r.user_id);
    let nameMap: Record<string, string> = {};
    if (userIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      nameMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    }
    setReqs((data ?? []).map((r: any) => ({
      ...r, profile_name: nameMap[r.user_id],
      slot_date: r.bookings?.slot_date, slot_time: r.bookings?.slot_time,
    })));
  };

  const docUrl = async (path: string): Promise<string | null> => {
    const { data } = await supabase.storage.from("cancellation-docs").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  };
  const openDoc = async (path: string) => {
    const u = await docUrl(path);
    if (u) window.open(u, "_blank");
    else toast.error("Nepavyko atidaryti dokumento");
  };
  useEffect(() => { load(); }, []);

  // Returns Sunday (end of week) of given ISO date
  const endOfWeek = (iso: string): string => {
    const d = new Date(iso + "T00:00:00");
    const dow = d.getDay(); // 0=Sun..6=Sat
    const daysUntilSun = dow === 0 ? 0 : 7 - dow;
    d.setDate(d.getDate() + daysUntilSun);
    return d.toISOString().slice(0, 10);
  };

  const sendUserMessage = async (userId: string, body: string) => {
    await supabase.from("messages").insert({
      user_id: userId, body, from_admin: true, read_by_user: false, read_by_admin: true,
    });
  };

  const decide = async (req: CancelReq, counts: boolean) => {
    const { error: e1 } = await supabase.from("cancellation_requests")
      .update({
        status: "approved", admin_decision_counts: counts,
        makeup_deadline: null, decided_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from("bookings")
      .update({ counts_in_subscription: counts }).eq("id", req.booking_id);
    if (e2) { toast.error(e2.message); return; }
    await sendUserMessage(req.user_id, counts
      ? `Jūsų atšaukta pamoka (${req.slot_date} ${req.slot_time?.slice(0, 5)}) buvo įskaityta į abonementą.`
      : `Jūsų atšaukta pamoka (${req.slot_date} ${req.slot_time?.slice(0, 5)}) NEbus įskaityta į abonementą.`);
    toast.success(counts ? "Pamoka skaičiuosis" : "Pamoka neskaičiuosis");
    load();
  };

  const grantMakeup = async (req: CancelReq) => {
    if (!req.slot_date) return;
    const deadline = endOfWeek(req.slot_date);
    const { error: e1 } = await supabase.from("cancellation_requests")
      .update({
        status: "approved", admin_decision_counts: false,
        makeup_deadline: deadline, decided_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    if (e1) { toast.error(e1.message); return; }
    const { error: e2 } = await supabase.from("bookings")
      .update({ counts_in_subscription: false }).eq("id", req.booking_id);
    if (e2) { toast.error(e2.message); return; }
    await sendUserMessage(req.user_id,
      `Jūsų atšaukimas (${req.slot_date} ${req.slot_time?.slice(0, 5)}) patvirtintas su sąlyga: ` +
      `pamoką turite atidirbti iki ${deadline} (sekmadienio imtinai). ` +
      `Užsiregistruokite į kitą laiką tą pačią savaitę. ` +
      `Jei to nepadarysite, pamoka bus įskaityta į abonementą automatiškai.`);
    toast.success(`Atidirbti iki ${deadline}`);
    load();
  };

  if (reqs.length === 0) {
    return <p className="text-center text-muted-foreground italic py-12">Nėra laukiančių prašymų</p>;
  }

  return (
    <div className="space-y-3">
      {reqs.map((r) => (
        <div key={r.id} className="bg-gradient-card border border-gold/15 rounded-lg p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <div className="font-display text-xl text-gold">{r.profile_name}</div>
            <div className="text-sm text-muted-foreground tabular-nums">
              {r.slot_date} {r.slot_time && formatTime(r.slot_time)}
            </div>
          </div>
          <p className="text-sm text-foreground/80 mb-4">
            <span className="text-muted-foreground">Priežastis: </span>{r.reason}
            {r.sickness && <span className="ml-2 px-2 py-0.5 rounded bg-blush/15 text-blush text-xs">Liga</span>}
            {r.sickness && (
              r.document_url
                ? <button onClick={() => openDoc(r.document_url!)} className="ml-2 text-xs text-gold underline">Pažiūrėti pažymą</button>
                : <span className="ml-2 text-xs text-muted-foreground italic">
                    {r.document_deadline && r.document_deadline < new Date().toISOString().slice(0,10)
                      ? "Pažyma neįkelta — terminas pasibaigęs"
                      : `Laukiama pažymos iki ${r.document_deadline ?? "—"}`}
                  </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outlineGold" size="sm" onClick={() => decide(r, false)}>
              <Check className="w-4 h-4" /> NEskaičiuoti
            </Button>
            <Button
              variant="ghostGold"
              size="sm"
              onClick={() => grantMakeup(r)}
              className="border border-gold/40 bg-gold/10"
              title="Pamoką atidirbti iki sekmadienio (tos pačios savaitės)"
            >
              <Clock className="w-4 h-4" /> Atidirbti šią savaitę
            </Button>
            <Button variant="gold" size="sm" onClick={() => decide(r, true)}>
              <X className="w-4 h-4" /> Skaičiuoti
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- USERS ---------- */
function UsersTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    const [p, s] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone").order("full_name"),
      supabase.from("subscriptions").select("*").order("purchase_date", { ascending: false }),
    ]);
    setProfiles(p.data ?? []);
    setSubs(s.data ?? []);
  };
  useEffect(() => { load(); }, []);

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
    const { error } = await supabase.from("subscriptions")
      .update({ lessons_total: n, lessons_used: newUsed }).eq("id", s.id);
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

  const deleteUser = async (p: Profile) => {
    const txt = prompt(
      `Visiškai ištrinti vartotoją "${p.full_name}"?\n\nVisi jo duomenys (pamokos, abonementai, žinutės, nuolatiniai laikai) bus negrįžtamai pašalinti.\n\nĮrašykite vartotojo vardą patvirtinti:`
    );
    if (txt !== p.full_name) { if (txt !== null) toast.error("Vardas nesutampa — atšaukta"); return; }
    setDeleting(p.id);
    const { data, error } = await supabase.functions.invoke("admin-delete-user", {
      body: { user_id: p.id },
    });
    setDeleting(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success(`${p.full_name} ištrintas`);
    load();
  };

  const renameUser = async (p: Profile) => {
    const txt = prompt(`Pakeisti vardą ir pavardę (dabar: ${p.full_name}):`, p.full_name);
    if (txt === null) return;
    const newName = txt.trim();
    if (!newName) { toast.error("Vardas negali būti tuščias"); return; }
    if (newName === p.full_name) return;
    const { error } = await supabase.from("profiles").update({ full_name: newName }).eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta");
    load();
  };

  return (
    <div className="space-y-3">
      {profiles.map((p) => {
        const userSubs = subs.filter((s) => s.user_id === p.id);
        const unpaid = userSubs.some((s) => !s.paid);
        return (
          <details key={p.id} className="bg-gradient-card border border-gold/15 rounded-lg group">
            <summary className="px-5 py-3 cursor-pointer flex items-center justify-between">
              <div>
                <div className="font-display text-lg text-gold">{p.full_name}</div>
                <div className="text-xs text-muted-foreground">{p.phone ?? "—"}</div>
              </div>
              {unpaid && <span className="text-xs px-2 py-0.5 rounded-full bg-blush/15 text-blush border border-blush/30">Yra neapmokėta</span>}
            </summary>
            <div className="border-t border-gold/10 px-5 py-3 space-y-3">
              {userSubs.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nėra abonementų</p>
              ) : (
                <ul className="space-y-2">
                  {userSubs.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-1.5">
                      <button
                        type="button"
                        onClick={() => editLessons(s)}
                        className="tabular-nums hover:text-gold transition-colors"
                        title="Spauskite, kad pakeistumėte treniruočių skaičių"
                      >
                        {s.lessons_used}/{s.lessons_total} · {s.price}€
                      </button>
                      <span className="text-xs text-muted-foreground">{s.purchase_date} → {s.expires_at}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => togglePaid(s.id, !s.paid)}
                          className={`text-xs px-2 py-1 rounded border ${s.paid ? "border-gold/30 text-gold bg-gold/10" : "border-blush/30 text-blush bg-blush/10"}`}
                        >
                          {s.paid ? "Apmokėta" : "Neapmokėta"}
                        </button>
                        <button
                          onClick={() => deleteSub(s)}
                          className="text-muted-foreground hover:text-destructive p-1"
                          title="Ištrinti abonementą"
                          aria-label="Ištrinti"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end pt-2 border-t border-gold/5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-foreground/80 hover:text-gold hover:bg-gold/10"
                  onClick={() => renameUser(p)}
                >
                  Pervardyti
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gold hover:text-gold hover:bg-gold/10"
                  onClick={async () => {
                    if (!confirm(`Atstatyti ${p.full_name} slaptažodį į „vardas_equus123"?`)) return;
                    const { data, error } = await supabase.functions.invoke("admin-reset-password", { body: { user_id: p.id } });
                    if (error || (data as any)?.error) {
                      toast.error((data as any)?.error || error?.message || "Klaida");
                      return;
                    }
                    toast.success(`Naujas slaptažodis: ${(data as any).password}`);
                  }}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Atstatyti slaptažodį
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={deleting === p.id}
                  onClick={() => deleteUser(p)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {deleting === p.id ? "Trinama…" : "Ištrinti vartotoją"}
                </Button>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/* ---------- MESSAGES (threaded) ---------- */
function MessagesTab() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [replyOpen, setReplyOpen] = useState<string | null>(null); // user_id being replied to
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(500);
    const ids = Array.from(new Set((data ?? []).map((m) => m.user_id)));
    let nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      nameMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    }
    setMsgs((data ?? []).map((m) => ({ ...m, profile_name: nameMap[m.user_id] })));
  };
  useEffect(() => { load(); }, []);

  // Group by user_id, show newest thread first
  const threads = (() => {
    const byUser: Record<string, Msg[]> = {};
    for (const m of msgs) {
      (byUser[m.user_id] ||= []).push(m);
    }
    return Object.entries(byUser)
      .map(([uid, list]) => ({
        user_id: uid,
        name: list[0]?.profile_name ?? "—",
        list,
        last: list[list.length - 1],
        hasUnread: list.some((m) => !m.from_admin && !m.read_by_admin),
      }))
      .sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());
  })();

  const markRead = async (userId: string) => {
    const ids = msgs.filter((m) => m.user_id === userId && !m.from_admin && !m.read_by_admin).map((m) => m.id);
    if (ids.length === 0) return;
    await supabase.from("messages").update({ read_by_admin: true }).in("id", ids);
    load();
  };

  const sendReply = async (userId: string) => {
    const body = replyBody.trim();
    if (!body) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({
      user_id: userId,
      body,
      from_admin: true,
      read_by_admin: true,
      read_by_user: false,
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Atsakymas išsiųstas");
    setReplyBody("");
    setReplyOpen(null);
    load();
  };

  if (threads.length === 0) return <p className="text-center text-muted-foreground italic py-12">Nėra žinučių</p>;

  return (
    <ul className="space-y-3">
      {threads.map((t) => (
        <li
          key={t.user_id}
          className={`bg-gradient-card border rounded-lg overflow-hidden ${t.hasUnread ? "border-gold/40 shadow-gold" : "border-gold/15"}`}
        >
          <div className="flex items-baseline justify-between gap-2 px-5 pt-4 pb-2">
            <span className="font-display text-gold text-lg">{t.name}</span>
            <span className="text-xs text-muted-foreground">{new Date(t.last.created_at).toLocaleString("lt-LT")}</span>
          </div>
          <ul className="divide-y divide-gold/5 max-h-64 overflow-auto">
            {t.list.map((m) => (
              <li key={m.id} className={`px-5 py-2.5 ${m.from_admin ? "bg-gold/5" : ""}`}>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  {m.from_admin ? "✦ Jūs (admin)" : t.name}
                </div>
                <p className="text-sm whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
          <div className="border-t border-gold/10 px-5 py-3 flex flex-wrap gap-2 justify-end">
            {t.hasUnread && (
              <Button variant="ghostGold" size="sm" onClick={() => markRead(t.user_id)}>Pažymėti perskaityta</Button>
            )}
            <Button variant="gold" size="sm" onClick={() => { setReplyOpen(t.user_id); setReplyBody(""); markRead(t.user_id); }}>
              Atsakyti
            </Button>
          </div>
          {replyOpen === t.user_id && (
            <div className="border-t border-gold/10 p-4 space-y-2 bg-background/40">
              <Label htmlFor={`reply-${t.user_id}`}>Atsakymas {t.name}</Label>
              <textarea
                id={`reply-${t.user_id}`}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={3}
                maxLength={2000}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Rašykite atsakymą..."
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReplyOpen(null)}>Atšaukti</Button>
                <Button variant="gold" size="sm" disabled={sending || !replyBody.trim()} onClick={() => sendReply(t.user_id)}>
                  Siųsti
                </Button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---------- PERMANENT SLOTS (admin: view + add + remove) ---------- */
interface PermSlotRow { id: string; user_id: string; day_of_week: number; slot_time: string; profile_name?: string; }
interface TimeSlotLite { id: string; day_of_week: number; slot_time: string; }

function PermanentSlotsAdminTab() {
  const [rows, setRows] = useState<PermSlotRow[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotLite[]>([]);
  const [loading, setLoading] = useState(true);

  // Add dialog
  const [open, setOpen] = useState(false);
  const [selUser, setSelUser] = useState("");
  const [selDay, setSelDay] = useState(1);
  const [selTime, setSelTime] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [r, p, t] = await Promise.all([
      supabase.from("permanent_slots").select("*").order("day_of_week").order("slot_time"),
      supabase.from("profiles").select("id, full_name, phone").order("full_name"),
      supabase.from("time_slots").select("id, day_of_week, slot_time").eq("active", true).order("day_of_week").order("slot_time"),
    ]);
    const profs = p.data ?? [];
    const nameMap = Object.fromEntries(profs.map((x) => [x.id, x.full_name]));
    setRows((r.data ?? []).map((x) => ({ ...x, profile_name: nameMap[x.user_id] ?? "—" })));
    setProfiles(profs);
    setTimeSlots(t.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const remove = async (row: PermSlotRow) => {
    if (!confirm(`Pašalinti ${row.profile_name} nuolatinį laiką (${WEEKDAYS_LT[row.day_of_week - 1]} ${formatTime(row.slot_time)})?\n\nVisos būsimos pamokos šiuo laiku bus ATŠAUKTOS ir nuolatinis laikas nustos kartotis.`)) return;
    // 1) Delete the recurring rule
    const { error: e1 } = await supabase.from("permanent_slots").delete().eq("id", row.id);
    if (e1) { toast.error(e1.message); return; }
    // 2) Cancel all future active bookings for this user at this weekday/time
    const todayISO = new Date().toISOString().slice(0, 10);
    const { data: future } = await supabase
      .from("bookings")
      .select("id, slot_date")
      .eq("user_id", row.user_id)
      .eq("slot_time", row.slot_time)
      .eq("status", "active")
      .gte("slot_date", todayISO);
    const ids = (future ?? [])
      .filter((b) => {
        // map Postgres dow (0=Sun..6=Sat) → app dow (1=Mon..7=Sun)
        const d = new Date(b.slot_date + "T00:00:00");
        const dow = d.getDay() === 0 ? 7 : d.getDay();
        return dow === row.day_of_week;
      })
      .map((b) => b.id);
    if (ids.length > 0) {
      await supabase.from("bookings").update({ status: "cancelled" }).in("id", ids);
    }
    toast.success(`Pašalinta. Atšaukta ${ids.length} būsimų pamokų.`);
    load();
  };

  const add = async () => {
    if (!selUser) { toast.error("Pasirinkite vartotoją"); return; }
    if (!selTime) { toast.error("Pasirinkite laiką"); return; }
    setSaving(true);
    const { error } = await supabase.from("permanent_slots").insert({
      user_id: selUser,
      day_of_week: selDay,
      slot_time: selTime,
    });
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "Šis nuolatinis laikas jau pridėtas" : error.message);
      return;
    }
    toast.success("Pridėta. Vartotojas užregistruotas 12-os savaičių į priekį.");
    setOpen(false);
    setSelUser(""); setSelTime(""); setSelDay(1);
    load();
  };

  const slotsForSelDay = timeSlots.filter((s) => s.day_of_week === selDay);

  const byDay: Record<number, Record<string, PermSlotRow[]>> = {};
  for (const r of rows) {
    (byDay[r.day_of_week] ||= {})[r.slot_time] ||= [];
    byDay[r.day_of_week][r.slot_time].push(r);
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button variant="gold" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4" /> Pridėti nuolatinį laiką
        </Button>
      </div>

      {loading ? (
        <p className="text-center text-muted-foreground italic py-12">Kraunama…</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-muted-foreground italic py-12">Niekas neturi nuolatinių laikų</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1,2,3,4,5,6,7].filter((d) => byDay[d]).map((dow) => (
            <div key={dow} className="bg-gradient-card border border-gold/15 rounded-lg p-4">
              <h3 className="font-display text-lg text-gold mb-3 flex items-center gap-2">
                <Star className="w-4 h-4 fill-gold" /> {WEEKDAYS_LT[dow - 1]}
              </h3>
              <ul className="space-y-3">
                {Object.entries(byDay[dow]).sort(([a],[b]) => a.localeCompare(b)).map(([time, list]) => (
                  <li key={time}>
                    <div className="text-sm font-medium tabular-nums text-foreground mb-1">{formatTime(time)}</div>
                    <ul className="pl-3 space-y-1">
                      {list.map((r) => (
                        <li key={r.id} className="flex items-center justify-between text-sm">
                          <span className="text-foreground/85">• {r.profile_name}</span>
                          <button onClick={() => remove(r)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold flex items-center gap-2">
              <Star className="w-5 h-5 fill-gold text-gold" /> Naujas nuolatinis laikas
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vartotojas bus automatiškai užregistruotas į pasirinktą laiką kiekvieną savaitę (12 sav. į priekį).
            </p>
            <div>
              <Label>Vartotojas</Label>
              <select
                value={selUser}
                onChange={(e) => setSelUser(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— pasirinkite vartotoją —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Diena</Label>
              <select
                value={selDay}
                onChange={(e) => { setSelDay(Number(e.target.value)); setSelTime(""); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{WEEKDAYS_LT[d - 1]}</option>)}
              </select>
            </div>
            <div>
              <Label>Laikas</Label>
              <select
                value={selTime}
                onChange={(e) => setSelTime(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— pasirinkite —</option>
                {slotsForSelDay.map((s) => (
                  <option key={s.id} value={s.slot_time}>{formatTime(s.slot_time)}</option>
                ))}
              </select>
              {slotsForSelDay.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1.5 italic">Šią dieną tvarkaraštyje nėra pamokų</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={add} disabled={saving || !selUser || !selTime}>
              {saving ? "Pridedama…" : "Pridėti"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
