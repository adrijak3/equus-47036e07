import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { formatDateISO, formatTime } from "@/lib/equus";

interface Horse { id: string; name: string; notes: string | null; active: boolean; }
interface Booking { id: string; user_id: string; slot_date: string; slot_time: string; status: string; is_guest: boolean; guest_name: string | null; profile_name?: string; }
interface Assignment { id: string; booking_id: string | null; user_id: string | null; guest_name: string | null; slot_date: string; slot_time: string; horse_id: string; }
interface HorseRequest { id: string; user_id: string; slot_date: string; slot_time: string; wished_horse: string; profile_name?: string; }

export default function Trener() {
  const { isTrainer, isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isTrainer && !isAdmin) {
    return <div className="container py-12 text-center text-muted-foreground">Reikia trenerio teisių.</div>;
  }
  return (
    <div className="container max-w-5xl py-8 sm:py-14">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70 mb-2">Trenerio sritis</p>
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-gold" /> Šiandiena
        </h1>
        <div className="gold-divider mt-4 max-w-[120px]" />
      </header>
      <Tabs defaultValue="today">
        <TabsList className="grid grid-cols-3 w-full bg-background/50 mb-6 h-auto">
          <TabsTrigger value="today">Šiandienos žirgai</TabsTrigger>
          <TabsTrigger value="horses">Žirgų sąrašas</TabsTrigger>
          <TabsTrigger value="subs">Abonimentai</TabsTrigger>
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

  const load = async () => {
    const { data } = await supabase.from("horses").select("*").order("name");
    setHorses(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (name.trim().length < 1) return;
    const { error } = await supabase.from("horses").insert({ name: name.trim(), notes: notes.trim() || null });
    if (error) { toast.error(error.message); return; }
    setName(""); setNotes(""); toast.success("Pridėtas"); load();
  };
  const remove = async (id: string) => {
    if (!confirm("Pašalinti šį žirgą?")) return;
    const { error } = await supabase.from("horses").update({ active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-card border border-gold/15 rounded-lg p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Vardas</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="pvz. Bella" />
          </div>
          <div>
            <Label>Pastaba (nebūtina)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="gold" onClick={add}><Plus className="w-4 h-4" /> Pridėti</Button>
        </div>
      </div>
      <ul className="grid sm:grid-cols-2 gap-2">
        {horses.filter((h) => h.active).map((h) => (
          <li key={h.id} className="flex items-center justify-between bg-gradient-card border border-gold/15 rounded-lg px-4 py-3">
            <div>
              <div className="font-display text-gold">{h.name}</div>
              {h.notes && <div className="text-xs text-muted-foreground">{h.notes}</div>}
            </div>
            <button onClick={() => remove(h.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>
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
      supabase.from("horses").select("*").eq("active", true).order("name"),
      supabase.from("horse_assignments").select("*").eq("slot_date", date),
      supabase.from("horse_requests").select("*").eq("slot_date", date),
    ]);
    const ids = Array.from(new Set([...(b.data ?? []).map((x: any) => x.user_id), ...(r.data ?? []).map((x: any) => x.user_id)]));
    let nameMap: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      nameMap = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
    }
    setBookings((b.data ?? []).map((x: any) => ({ ...x, profile_name: nameMap[x.user_id] })));
    setRequests((r.data ?? []).map((x: any) => ({ ...x, profile_name: nameMap[x.user_id] })));
    setHorses(h.data ?? []);
    setAssigns(a.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [date]);

  const getAssignment = (b: Booking) =>
    assigns.find((a) => a.booking_id === b.id || (a.slot_time === b.slot_time && (a.user_id === b.user_id || (b.is_guest && a.guest_name === b.guest_name))));

  const assign = async (b: Booking, horseId: string) => {
    const existing = getAssignment(b);
    if (existing) {
      const { error } = await supabase.from("horse_assignments").update({ horse_id: horseId }).eq("id", existing.id);
      if (error) {
        toast.error(error.message.includes("HORSE_LIMIT_REACHED")
          ? "Šis žirgas jau priskirtas 2 kartus šiandien"
          : error.message);
        return;
      }
    } else {
      const userData = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("horse_assignments").insert({
        booking_id: b.id,
        user_id: b.is_guest ? null : b.user_id,
        guest_name: b.is_guest ? b.guest_name : null,
        slot_date: b.slot_date,
        slot_time: b.slot_time,
        horse_id: horseId,
        assigned_by: userData?.id,
      } as any);
      if (error) {
        toast.error(error.message.includes("HORSE_LIMIT_REACHED")
          ? "Šis žirgas jau priskirtas 2 kartus šiandien"
          : error.message);
        return;
      }
    }
    load();
  };

  const grouped = useMemo(() => {
    const m: Record<string, Booking[]> = {};
    for (const b of bookings) (m[b.slot_time] ||= []).push(b);
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label>Data</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
      </div>
      {loading ? (
        <p className="text-center text-muted-foreground italic py-8">Kraunama…</p>
      ) : grouped.length === 0 ? (
        <p className="text-center text-muted-foreground italic py-8">Nėra užsiregistravusių</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([time, list]) => (
            <div key={time} className="bg-gradient-card border border-gold/15 rounded-lg p-4">
              <h3 className="font-display text-lg text-gold mb-3 tabular-nums">{formatTime(time)}</h3>
              <ul className="space-y-2">
                {list.map((b) => {
                  const a = getAssignment(b);
                  const req = requests.find((r) => (r.user_id === b.user_id) && r.slot_time === b.slot_time);
                  const assignedHorse = a ? horses.find((h) => h.id === a.horse_id) : null;
                  return (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div>
                        <span className="font-medium">{b.is_guest ? `${b.guest_name} (naujokė)` : b.profile_name}</span>
                        {req && <span className="ml-2 text-xs text-blush">pageidauja: {req.wished_horse}</span>}
                        {assignedHorse && <span className="ml-2 text-xs text-gold">→ {assignedHorse.name}</span>}
                      </div>
                      <select
                        value={a?.horse_id ?? ""}
                        onChange={(e) => assign(b, e.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">— priskirti žirgą —</option>
                        {horses.map((h) => {
                          const used = assigns.filter((x) => x.horse_id === h.id && x.id !== a?.id).length;
                          const disabled = used >= 2;
                          return (
                            <option key={h.id} value={h.id} disabled={disabled}>
                              {h.name}{disabled ? " (×2)" : used === 1 ? " (×1)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SubRow { id: string; user_id: string; lessons_total: number; lessons_used: number; lesson_type: string; expires_at: string; paid: boolean; price: number; }

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

  const filtered = rows.filter((r) => !filter || r.full_name.toLowerCase().includes(filter.toLowerCase()));

  if (loading) return <p className="text-center text-muted-foreground italic py-8">Kraunama…</p>;
  return (
    <div className="space-y-3">
      <Input placeholder="Ieškoti pagal vardą…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground italic py-8">Nėra aktyvių abonimentų</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-gradient-card border border-gold/15 rounded-lg px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{s.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.lesson_type} · galioja iki {s.expires_at} {s.paid ? "" : "· neapmokėta"}
                </div>
              </div>
              <div className="font-display text-gold tabular-nums">
                {s.lessons_used}/{s.lessons_total}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}