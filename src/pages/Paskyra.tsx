import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { calculateSubscriptionPrice, dbDayOfWeek, expiryFromPurchase, formatDateISO, formatTime, MONTHS_LT_NOM, WEEKDAYS_LT } from "@/lib/equus";
import { CalendarDays, Clock, CheckCircle2, XCircle, Plus, MessageSquare, Star, Trash2, Settings, KeyRound, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { FloralAccent } from "@/components/Decorations";

interface Booking {
  id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  counts_in_subscription: boolean;
}
interface Subscription {
  id: string;
  lessons_total: number;
  lessons_used: number;
  sickness_credits: number;
  price: number;
  purchase_date: string;
  expires_at: string;
  paid: boolean;
}
interface PermanentSlot {
  id: string;
  day_of_week: number;
  slot_time: string;
}
interface AvailableSlot {
  id: string;
  day_of_week: number;
  slot_time: string;
}

export default function Paskyra() {
  const { user, profile, refreshProfile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [messages, setMessages] = useState<{ id: string; body: string; created_at: string; read_by_admin: boolean; from_admin: boolean; parent_id: string | null; read_by_user: boolean }[]>([]);
  const [permanents, setPermanents] = useState<PermanentSlot[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Add subscription dialog
  const [subDialog, setSubDialog] = useState(false);
  const [newSubLessons, setNewSubLessons] = useState(8);
  const [newSubDate, setNewSubDate] = useState(formatDateISO(new Date()));
  const [newSubPaid, setNewSubPaid] = useState(false);

  // Permanent slot dialog
  const [permDialog, setPermDialog] = useState(false);
  const [permDay, setPermDay] = useState(1);
  const [permTime, setPermTime] = useState("");

  // Message
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    // Auto-process past lessons (Vilnius TZ) so subscription counters are fresh
    try { await supabase.functions.invoke("process-lessons"); } catch { /* non-fatal */ }
    const [b, s, m, p, ts] = await Promise.all([
      supabase.from("bookings").select("*").eq("user_id", user.id).order("slot_date").order("slot_time"),
      supabase.from("subscriptions").select("*").eq("user_id", user.id).order("purchase_date", { ascending: false }),
      supabase.from("messages").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(200),
      supabase.from("permanent_slots").select("*").eq("user_id", user.id).order("day_of_week").order("slot_time"),
      supabase.from("time_slots").select("id, day_of_week, slot_time").eq("active", true).order("day_of_week").order("slot_time"),
    ]);
    setBookings(b.data ?? []);
    setSubs(s.data ?? []);
    setMessages(m.data ?? []);
    setPermanents(p.data ?? []);
    setAvailableSlots(ts.data ?? []);
    setLoading(false);
  };

  // Mark received admin replies as read once user opens the page
  useEffect(() => {
    if (!user) return;
    const unread = messages.filter((m) => m.from_admin && !m.read_by_user).map((m) => m.id);
    if (unread.length > 0) {
      supabase.from("messages").update({ read_by_user: true }).in("id", unread);
    }
  }, [messages, user]);

  useEffect(() => { load(); }, [user]);

  const now = new Date();
  const future = bookings.filter((b) => b.status === "active" && new Date(`${b.slot_date}T${b.slot_time}`) >= now);
  const past = bookings.filter((b) => new Date(`${b.slot_date}T${b.slot_time}`) < now);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthBookings = past.filter((b) => {
    const d = new Date(`${b.slot_date}T${b.slot_time}`);
    return d >= monthStart && d < monthEnd;
  });
  const monthAttended = monthBookings.filter((b) => b.status === "active" || b.status === "completed");

  const newSubPrice = calculateSubscriptionPrice(newSubLessons);

  const addSubscription = async () => {
    if (!user) return;
    if (newSubLessons < 1 || newSubLessons > 50) { toast.error("Pamokų skaičius 1–50"); return; }
    const { error } = await supabase.from("subscriptions").insert({
      user_id: user.id,
      lessons_total: newSubLessons,
      price: newSubPrice,
      purchase_date: newSubDate,
      expires_at: expiryFromPurchase(newSubDate),
      paid: newSubPaid,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Abonementas pridėtas");
    setSubDialog(false);
    setNewSubLessons(8);
    setNewSubPaid(false);
    load();
  };

  const sendMessage = async () => {
    if (!user || msgBody.trim().length < 1) return;
    setSending(true);
    const { error } = await supabase.from("messages").insert({ user_id: user.id, body: msgBody.trim() });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setMsgBody("");
    toast.success("Žinutė išsiųsta");
    load();
  };

  // Permanent slots
  const slotsForPermDay = availableSlots.filter((s) => s.day_of_week === permDay);

  const addPermanent = async () => {
    if (!user || !permTime) { toast.error("Pasirinkite laiką"); return; }
    const { error } = await supabase.from("permanent_slots").insert({
      user_id: user.id,
      day_of_week: permDay,
      slot_time: permTime,
    });
    if (error) {
      toast.error(error.code === "23505" ? "Šis nuolatinis laikas jau pridėtas" : error.message);
      return;
    }
    toast.success("Pridėtas nuolatinis laikas. Užregistruoti į pamokas 12-os savaičių į priekį.");
    setPermDialog(false);
    setPermTime("");
    load();
  };

  const removePermanent = async (id: string) => {
    const slot = permanents.find((p) => p.id === id);
    if (!slot) return;
    if (!confirm("Pašalinti nuolatinį laiką? Visos jūsų būsimos pamokos šiuo laiku bus atšauktos.")) return;
    const { error } = await supabase.from("permanent_slots").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    // Cancel all future active bookings for this user that fall on this weekday + time
    const todayISO = formatDateISO(new Date());
    const { data: future } = await supabase
      .from("bookings")
      .select("id, slot_date")
      .eq("user_id", user!.id)
      .eq("slot_time", slot.slot_time)
      .gte("slot_date", todayISO)
      .eq("status", "active");
    const ids = (future ?? [])
      .filter((b) => dbDayOfWeek(new Date(`${b.slot_date}T00:00:00`)) === slot.day_of_week)
      .map((b) => b.id);
    if (ids.length > 0) {
      await supabase.from("bookings").update({ status: "cancelled" }).in("id", ids);
    }
    toast.success("Pašalinta. Būsimos pamokos atšauktos.");
    load();
  };

  const markSubPaid = async (subId: string) => {
    if (!confirm("Pažymėti šį abonementą kaip APMOKĖTĄ?")) return;
    const { error } = await supabase.from("subscriptions").update({ paid: true }).eq("id", subId);
    if (error) { toast.error(error.message); return; }
    toast.success("Pažymėta apmokėta. Administracija patvirtins.");
    load();
  };

  const monthLabel = MONTHS_LT_NOM[now.getMonth()];

  return (
    <div className="container max-w-4xl py-8 sm:py-14 relative">
      <FloralAccent className="absolute -top-4 -right-12 hidden md:block" size={140} delay={0.3} rotate={25} />

      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70 mb-2">Sveiki sugrįžę</p>
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold">{profile?.full_name ?? "—"}</h1>
        <div className="gold-divider mt-4 max-w-[120px]" />
      </motion.header>

      <Tabs defaultValue="lessons">
        <TabsList className="grid grid-cols-4 w-full bg-background/50 mb-6">
          <TabsTrigger value="lessons">Pamokos</TabsTrigger>
          <TabsTrigger value="subs">Abonementai</TabsTrigger>
          <TabsTrigger value="messages">Žinutės</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5"><Settings className="w-3.5 h-3.5" /><span className="hidden sm:inline">Nuostatos</span></TabsTrigger>
        </TabsList>

        {/* LESSONS */}
        <TabsContent value="lessons" className="space-y-6">
          <Section title="Ateities pamokos" icon={<CalendarDays className="w-4 h-4" />}>
            {future.length === 0 ? (
              <Empty text="Nėra suplanuotų pamokų" />
            ) : (
              <ul className="divide-y divide-gold/5">
                {future.map((b) => <BookingRow key={b.id} b={b} />)}
              </ul>
            )}
          </Section>

          <Section title={`${monthLabel} lankomumas`} icon={<CheckCircle2 className="w-4 h-4" />}>
            <div className="flex items-baseline gap-3 px-5 py-3">
              <span className="font-display text-4xl text-gradient-gold tabular-nums">{monthAttended.length}</span>
              <span className="text-sm text-muted-foreground">pamokų šį mėnesį</span>
            </div>
            {monthBookings.length > 0 && (
              <ul className="divide-y divide-gold/5 border-t border-gold/10">
                {monthBookings.map((b) => <BookingRow key={b.id} b={b} past />)}
              </ul>
            )}
          </Section>

          <Section title="Visos praėjusios" icon={<Clock className="w-4 h-4" />}>
            {past.length === 0 ? (
              <Empty text="Dar nebuvo pamokų" />
            ) : (
              <ul className="divide-y divide-gold/5 max-h-96 overflow-auto">
                {past.slice().reverse().map((b) => <BookingRow key={b.id} b={b} past />)}
              </ul>
            )}
          </Section>
        </TabsContent>

        {/* SUBSCRIPTIONS */}
        <TabsContent value="subs" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="gold" onClick={() => setSubDialog(true)}>
              <Plus className="w-4 h-4" /> Pridėti abonementą
            </Button>
          </div>
          {subs.length === 0 ? (
            <Empty text="Nėra abonementų" />
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {subs.map((s) => <SubscriptionCard key={s.id} s={s} onMarkPaid={markSubPaid} />)}
            </div>
          )}
        </TabsContent>

        {/* MESSAGES */}
        <TabsContent value="messages" className="space-y-4">
          <div className="bg-gradient-card border border-gold/15 rounded-lg p-5">
            <Label htmlFor="msg" className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-gold" /> Žinutė administracijai
            </Label>
            <Textarea
              id="msg"
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Rašykite čia..."
            />
            <div className="flex justify-end mt-3">
              <Button variant="gold" disabled={sending || !msgBody.trim()} onClick={sendMessage}>
                Siųsti
              </Button>
            </div>
          </div>
          {messages.length > 0 && (
            <Section title="Pokalbis su administracija">
              <ul className="divide-y divide-gold/5 max-h-[500px] overflow-auto">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "px-5 py-3",
                      m.from_admin && "bg-gold/5",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className={cn("text-xs uppercase tracking-wide", m.from_admin ? "text-gold" : "text-muted-foreground")}>
                        {m.from_admin ? "✦ Administracija" : "Jūs"}
                      </span>
                      <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("lt-LT")}</span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                    {!m.from_admin && (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {m.read_by_admin ? "✓ Perskaityta" : "Išsiųsta"}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </TabsContent>

        {/* SETTINGS */}
        <TabsContent value="settings" className="space-y-6">
          <ProfileSettings onSaved={refreshProfile} />
          <PermanentSlotsSection
            permanents={permanents}
            onAdd={() => { setPermDay(1); setPermTime(""); setPermDialog(true); }}
            onRemove={removePermanent}
          />
          <PasswordChange />
        </TabsContent>
      </Tabs>

      {/* Add subscription dialog */}
      <Dialog open={subDialog} onOpenChange={setSubDialog}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold">Naujas abonementas</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sub-date">Pirkimo data</Label>
              <Input id="sub-date" type="date" value={newSubDate} onChange={(e) => setNewSubDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sub-lessons">Pamokų skaičius</Label>
              <Input id="sub-lessons" type="number" min={1} max={50} value={newSubLessons}
                onChange={(e) => setNewSubLessons(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground mt-1.5">
                Galioja 30 dienų · {newSubLessons >= 8 ? "30 €" : "35 €"} už pamoką
              </p>
            </div>
            <div className="flex items-baseline justify-between p-4 rounded-md bg-gold/5 border border-gold/15">
              <span className="text-sm">Iš viso</span>
              <span className="text-3xl font-display text-gradient-gold tabular-nums">{newSubPrice} €</span>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={newSubPaid} onChange={(e) => setNewSubPaid(e.target.checked)} className="accent-gold" />
              Jau apmokėta
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSubDialog(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={addSubscription}>Pridėti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent slot dialog */}
      <Dialog open={permDialog} onOpenChange={setPermDialog}>
        <DialogContent className="bg-gradient-card border-gold/20">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold flex items-center gap-2">
              <Star className="w-5 h-5 fill-gold text-gold" /> Nuolatinis laikas
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Jūs būsite automatiškai užregistruota į šią pamoką kiekvieną savaitę. Vardas tvarkaraštyje bus pažymėtas paryškintai.
            </p>
            <div>
              <Label>Diena</Label>
              <select
                value={permDay}
                onChange={(e) => { setPermDay(Number(e.target.value)); setPermTime(""); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {[1,2,3,4,5,6,7].map((d) => <option key={d} value={d}>{WEEKDAYS_LT[d - 1]}</option>)}
              </select>
            </div>
            <div>
              <Label>Laikas</Label>
              <select
                value={permTime}
                onChange={(e) => setPermTime(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— pasirinkite —</option>
                {slotsForPermDay.map((s) => (
                  <option key={s.id} value={s.slot_time}>{formatTime(s.slot_time)}</option>
                ))}
              </select>
              {slotsForPermDay.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1.5 italic">Šią dieną nėra pamokų</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPermDialog(false)}>Atšaukti</Button>
            <Button variant="gold" onClick={addPermanent} disabled={!permTime}>Pridėti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ───────────── Settings sub-sections ───────────── */

function ProfileSettings({ onSaved }: { onSaved: () => void | Promise<void> }) {
  const { user, profile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile]);

  const save = async () => {
    if (!user) return;
    if (name.trim().length < 2) { toast.error("Vardas per trumpas"); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles")
      .update({ full_name: name.trim(), phone: phone.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Išsaugota");
    await onSaved();
  };

  return (
    <Section title="Profilis" icon={<UserIcon className="w-4 h-4" />}>
      <div className="p-5 space-y-3">
        <div>
          <Label htmlFor="pf-name">Vardas ir pavardė</Label>
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div>
          <Label htmlFor="pf-phone">Telefonas</Label>
          <Input id="pf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
          <p className="text-xs text-muted-foreground mt-1">Naudojamas slaptažodžio atstatymui</p>
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="gold" onClick={save} disabled={saving}>{saving ? "Saugoma…" : "Išsaugoti"}</Button>
        </div>
      </div>
    </Section>
  );
}

function PermanentSlotsSection({
  permanents,
  onAdd,
  onRemove,
}: {
  permanents: PermanentSlot[];
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section title="Nuolatiniai laikai" icon={<Star className="w-4 h-4" />}>
      <div className="p-5">
        <p className="text-sm text-muted-foreground mb-4">
          Pridėkite savaitės laiką, ir būsite automatiškai užregistruota kiekvieną savaitę.
        </p>
        {permanents.length === 0 ? (
          <p className="text-sm italic text-muted-foreground py-3">Nepridėta nė vieno nuolatinio laiko</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {permanents.map((p) => (
              <li key={p.id} className="flex items-center justify-between bg-gold/5 border border-gold/15 rounded-md px-4 py-2.5">
                <span className="flex items-center gap-2">
                  <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                  <span className="font-medium">{WEEKDAYS_LT[p.day_of_week - 1]}</span>
                  <span className="text-muted-foreground tabular-nums">{formatTime(p.slot_time)}</span>
                </span>
                <button
                  onClick={() => onRemove(p.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Pašalinti"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outlineGold" onClick={onAdd}>
          <Plus className="w-4 h-4" /> Pridėti nuolatinį laiką
        </Button>
      </div>
    </Section>
  );
}

function PasswordChange() {
  const { user, profile } = useAuth();
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user?.email) return;
    if (pw.length < 8) { toast.error("Slaptažodis turi būti bent 8 simbolių"); return; }
    if (pw !== pw2) { toast.error("Slaptažodžiai nesutampa"); return; }
    if (!phone.trim()) { toast.error("Įveskite telefono numerį"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("reset-password-by-phone", {
      body: { email: user.email, phone: phone.trim(), new_password: pw },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Klaida");
      return;
    }
    toast.success("Slaptažodis pakeistas");
    setPhone(""); setPw(""); setPw2("");
  };

  return (
    <Section title="Pakeisti slaptažodį" icon={<KeyRound className="w-4 h-4" />}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          Įveskite savo telefono numerį (turi sutapti su paskyroje nurodytu — <span className="text-foreground/80">{profile?.phone ?? "nenurodytas"}</span>) ir naują slaptažodį.
        </p>
        <div>
          <Label htmlFor="pc-phone">Telefonas patvirtinimui</Label>
          <Input id="pc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pc-pw">Naujas slaptažodis</Label>
            <Input id="pc-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} />
          </div>
          <div>
            <Label htmlFor="pc-pw2">Pakartokite</Label>
            <Input id="pc-pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} />
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="gold" onClick={submit} disabled={busy}>{busy ? "Keičiama…" : "Pakeisti"}</Button>
        </div>
      </div>
    </Section>
  );
}

/* ───────────── Shared bits ───────────── */

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="bg-gradient-card border border-gold/15 rounded-lg overflow-hidden shadow-elegant"
    >
      <h2 className="px-5 py-3 border-b border-gold/10 font-display text-lg text-gold flex items-center gap-2">
        {icon} {title}
      </h2>
      {children}
    </motion.section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground italic">{text}</p>;
}

function BookingRow({ b, past }: { b: Booking; past?: boolean }) {
  const d = new Date(`${b.slot_date}T${b.slot_time}`);
  return (
    <li className="flex items-center justify-between px-5 py-3 text-sm">
      <div>
        <div className="font-medium">
          {d.toLocaleDateString("lt-LT", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <div className="text-muted-foreground tabular-nums">{formatTime(b.slot_time)}</div>
      </div>
      <div>
        {b.status === "cancelled" && <span className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive">Atšaukta</span>}
        {past && (b.status === "completed" || b.status === "active") && (
          <span className="text-xs text-gold/80">
            ✓ {b.counts_in_subscription === false ? "Įvyko (nesiskaičiuoja)" : "Įvyko"}
          </span>
        )}
      </div>
    </li>
  );
}

function SubscriptionCard({ s, onMarkPaid }: { s: Subscription; onMarkPaid?: (id: string) => void }) {
  const remaining = s.lessons_total - s.lessons_used;
  const expired = new Date(s.expires_at) < new Date();
  const empty = remaining <= 0;
  return (
    <div className={cn(
      "p-5 rounded-lg border bg-gradient-card transition-all",
      empty ? "border-destructive/40 shadow-[0_0_30px_-8px_hsl(var(--destructive)/0.3)]" : "border-gold/15",
      expired && "opacity-60",
    )}>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-3xl font-display text-gradient-gold tabular-nums">
          {s.lessons_used}/{s.lessons_total}
        </span>
        {s.paid ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Apmokėta
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onMarkPaid?.(s.id)}
            className="text-xs px-2 py-0.5 rounded-full bg-blush/15 text-blush border border-blush/30 flex items-center gap-1 hover:bg-blush/25 transition-colors cursor-pointer"
            title="Spauskite, kad pažymėtumėte kaip apmokėtą"
          >
            <XCircle className="w-3 h-3" /> Neapmokėta · pažymėti
          </button>
        )}
      </div>
      <div className="text-sm space-y-1 text-muted-foreground">
        <div>Pirkta: <span className="text-foreground">{s.purchase_date}</span></div>
        <div>Galioja iki: <span className={cn("text-foreground", expired && "text-destructive")}>{s.expires_at}</span></div>
        <div>Suma: <span className="text-foreground tabular-nums">{Number(s.price).toFixed(2)} €</span></div>
        {s.sickness_credits > 0 && (
          <div className="text-blush">+{s.sickness_credits} (liga)</div>
        )}
      </div>
      {empty && !expired && (
        <p className="mt-3 text-xs text-destructive font-medium">Pamokos baigėsi — pridėkite naują abonementą</p>
      )}
    </div>
  );
}

