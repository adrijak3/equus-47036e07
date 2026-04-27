import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { WEEKDAYS_LT, formatTime } from "@/lib/equus";
import { Plus, Trash2, Check, X, Inbox, Users, CalendarCog, MessageSquare, Star, Clock } from "lucide-react";

interface TimeSlot { id: string; day_of_week: number; slot_time: string; max_capacity: number; }
interface CancelReq {
  id: string; booking_id: string; user_id: string; reason: string; sickness: boolean;
  status: string; created_at: string; admin_decision_counts: boolean | null;
  profile_name?: string; slot_date?: string; slot_time?: string;
}
interface Profile { id: string; full_name: string; phone: string | null; }
interface Sub {
  id: string; user_id: string; lessons_total: number; lessons_used: number;
  price: number; purchase_date: string; expires_at: string; paid: boolean;
}
interface Msg { id: string; user_id: string; body: string; created_at: string; read_by_admin: boolean; from_admin: boolean; parent_id: string | null; profile_name?: string; }

export default function Admin() {
  return (
    <div className="container max-w-6xl py-8 sm:py-14">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70 mb-2">Administracija</p>
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold">Valdymas</h1>
        <div className="gold-divider mt-4 max-w-[120px]" />
      </header>

      <Tabs defaultValue="schedule">
        <TabsList className="grid grid-cols-3 sm:grid-cols-5 w-full bg-background/50 mb-6 h-auto">
          <TabsTrigger value="schedule" className="gap-1.5 text-xs sm:text-sm"><CalendarCog className="w-4 h-4" /> <span className="hidden sm:inline">Tvarkaraštis</span></TabsTrigger>
          <TabsTrigger value="permanent" className="gap-1.5 text-xs sm:text-sm"><Star className="w-4 h-4" /> <span className="hidden sm:inline">Nuolatiniai</span></TabsTrigger>
          <TabsTrigger value="cancels" className="gap-1.5 text-xs sm:text-sm"><Inbox className="w-4 h-4" /> <span className="hidden sm:inline">Atšaukimai</span></TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5 text-xs sm:text-sm"><Users className="w-4 h-4" /> <span className="hidden sm:inline">Vartotojai</span></TabsTrigger>
          <TabsTrigger value="messages" className="gap-1.5 text-xs sm:text-sm"><MessageSquare className="w-4 h-4" /> <span className="hidden sm:inline">Žinutės</span></TabsTrigger>
        </TabsList>

        <TabsContent value="schedule"><ScheduleTab /></TabsContent>
        <TabsContent value="permanent"><PermanentSlotsAdminTab /></TabsContent>
        <TabsContent value="cancels"><CancellationsTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
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

  const load = async () => {
    const { data } = await supabase.from("time_slots").select("*").eq("active", true)
      .order("day_of_week").order("slot_time");
    setSlots(data ?? []);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const { error } = await supabase.from("time_slots").insert({
      day_of_week: newDay, slot_time: newTime, max_capacity: newCap,
    });
    if (error) { toast.error(error.code === "23505" ? "Toks slot jau egzistuoja" : error.message); return; }
    toast.success("Pridėta"); setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Pašalinti šį laiką?")) return;
    const { error } = await supabase.from("time_slots").update({ active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta"); load();
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button variant="gold" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Naujas laikas</Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[1,2,3,4,5,6,7].map((dow) => (
          <div key={dow} className="bg-gradient-card border border-gold/15 rounded-lg p-4">
            <h3 className="font-display text-lg text-gold mb-3">{WEEKDAYS_LT[dow - 1]}</h3>
            <ul className="space-y-1.5">
              {slots.filter((s) => s.day_of_week === dow).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-gold/5">
                  <span className="tabular-nums">{formatTime(s.slot_time)}</span>
                  <span className="text-xs text-muted-foreground">cap {s.max_capacity}</span>
                  <button onClick={() => remove(s.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
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
            <div>
              <Label>Diena</Label>
              <select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{WEEKDAYS_LT[d - 1]}</option>)}
              </select>
            </div>
            <div>
              <Label>Laikas</Label>
              <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            </div>
            <div>
              <Label>Talpa</Label>
              <Input type="number" min={1} max={20} value={newCap} onChange={(e) => setNewCap(parseInt(e.target.value) || 5)} />
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
    if (n < s.lessons_used) { toast.error(`Negalima mažiau už jau panaudotų (${s.lessons_used})`); return; }
    const { error } = await supabase.from("subscriptions").update({ lessons_total: n }).eq("id", s.id);
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
