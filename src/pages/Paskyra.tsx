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
import { calculateSubscriptionPrice, expiryFromPurchase, formatDateISO, formatTime, MONTHS_LT_NOM } from "@/lib/equus";
import { CalendarDays, Clock, CheckCircle2, XCircle, Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

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

export default function Paskyra() {
  const { user, profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [messages, setMessages] = useState<{ id: string; body: string; created_at: string; read_by_admin: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  // Add subscription dialog
  const [subDialog, setSubDialog] = useState(false);
  const [newSubLessons, setNewSubLessons] = useState(8);
  const [newSubDate, setNewSubDate] = useState(formatDateISO(new Date()));
  const [newSubPaid, setNewSubPaid] = useState(false);

  // Message
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [b, s, m] = await Promise.all([
      supabase.from("bookings").select("*").eq("user_id", user.id).order("slot_date").order("slot_time"),
      supabase.from("subscriptions").select("*").eq("user_id", user.id).order("purchase_date", { ascending: false }),
      supabase.from("messages").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    ]);
    setBookings(b.data ?? []);
    setSubs(s.data ?? []);
    setMessages(m.data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const now = new Date();
  const future = bookings.filter((b) => b.status === "active" && new Date(`${b.slot_date}T${b.slot_time}`) >= now);
  const past = bookings.filter((b) => new Date(`${b.slot_date}T${b.slot_time}`) < now);

  // Attendance for current month
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

  const monthLabel = MONTHS_LT_NOM[now.getMonth()];

  return (
    <div className="container max-w-4xl py-8 sm:py-14">
      <header className="mb-8 animate-fade-up">
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70 mb-2">Sveiki sugrįžę</p>
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold">{profile?.full_name ?? "—"}</h1>
        <div className="gold-divider mt-4 max-w-[120px]" />
      </header>

      <Tabs defaultValue="lessons">
        <TabsList className="grid grid-cols-3 w-full bg-background/50 mb-6">
          <TabsTrigger value="lessons">Pamokos</TabsTrigger>
          <TabsTrigger value="subs">Abonementai</TabsTrigger>
          <TabsTrigger value="messages">Žinutės</TabsTrigger>
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
              {subs.map((s) => <SubscriptionCard key={s.id} s={s} />)}
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
            <Section title="Išsiųstos žinutės">
              <ul className="divide-y divide-gold/5">
                {messages.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                    <div className="text-xs text-muted-foreground mt-1.5 flex justify-between">
                      <span>{new Date(m.created_at).toLocaleString("lt-LT")}</span>
                      <span className={m.read_by_admin ? "text-gold/70" : ""}>
                        {m.read_by_admin ? "✓ Perskaityta" : "Nauja"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
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
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-gradient-card border border-gold/15 rounded-lg overflow-hidden shadow-elegant">
      <h2 className="px-5 py-3 border-b border-gold/10 font-display text-lg text-gold flex items-center gap-2">
        {icon} {title}
      </h2>
      {children}
    </section>
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
        {past && b.status === "active" && <span className="text-xs text-gold/80">✓ Įvyko</span>}
      </div>
    </li>
  );
}

function SubscriptionCard({ s }: { s: Subscription }) {
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
          <span className="text-xs px-2 py-0.5 rounded-full bg-blush/15 text-blush border border-blush/30 flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Neapmokėta
          </span>
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
