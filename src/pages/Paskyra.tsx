import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { SINGLE_LESSON_PRICE, calculateSubPriceByType, canonicalBookings, dbDayOfWeek, formatDateISO, formatTime, MONTHS_LT_NOM, WEEKDAYS_LT } from "@/lib/equus";
import { CalendarDays, Clock, Bell, QrCode, CheckCircle2, XCircle, Plus, MessageSquare, Star, Trash2, KeyRound, User as UserIcon, Wallet, Inbox, Mail, Phone, IdCard, Pencil, Sparkles, BarChart3, ChevronRight, Palette } from "lucide-react";
import { Horse } from "@/components/icons/Horse";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { FloralAccent } from "@/components/Decorations";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { VacationsPanel, VacationBanner } from "@/components/VacationsPanel";
import { UnpaidLessonsOverview } from "@/components/UnpaidLessonsOverview";
import { UserDuplicateBookings } from "@/components/UserDuplicateBookings";
import { useLanguage } from "@/contexts/LanguageContext";
import { disablePushNotifications, enablePushNotifications, getPushSubscription, pushNotificationsSupported, syncPushLanguage } from "@/lib/pushNotifications";

interface Booking {
  id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  counts_in_subscription: boolean;
  subscription_id?: string | null;
  horse_name?: string | null;
  is_individual?: boolean;
  slot_capacity?: number | null;
  lesson_price?: number | null;
  lesson_kind?: "individual" | "po2" | "group";
}
interface Subscription {
  id: string;
  lessons_total: number;
  lessons_used: number;
  sickness_credits: number;
  price: number;
  purchase_date: string;
  start_from_date?: string | null;
  start_pending?: boolean;
  expires_at: string | null;
  paid: boolean;
  lesson_type?: string;
  covered_riders?: 1 | 2;
}
interface PermanentSlot {
  id: string;
  day_of_week: number;
  slot_time: string;
}
interface PendingSickReq {
  id: string;
  booking_id: string;
  document_url: string | null;
  document_deadline: string | null;
  slot_date?: string;
  slot_time?: string;
}
interface AvailableSlot {
  id: string;
  day_of_week: number;
  slot_time: string;
  max_capacity: number;
}
interface PermanentRequest { id: string; day_of_week: number; slot_time: string; status: string; admin_note: string | null; }
interface AccountProfile {
  id: string;
  full_name: string | null;
  phone: string | null;
}

export default function Paskyra() {
  const { user, profile, refreshProfile, activeProfileId, activeProfileName, linkedProfiles } = useAuth();
  const acting = activeProfileId ?? user?.id ?? null;
  const isLinked = !!user && acting !== user.id;
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [messages, setMessages] = useState<{ id: string; body: string; created_at: string; read_by_admin: boolean; from_admin: boolean; parent_id: string | null; read_by_user: boolean }[]>([]);
  const [permanents, setPermanents] = useState<PermanentSlot[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [permanentRequests, setPermanentRequests] = useState<PermanentRequest[]>([]);
  const [sickReqs, setSickReqs] = useState<PendingSickReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTab = new URLSearchParams(location.search).get("tab") || "profile";
  const activeTab = ["profile", "lessons", "subs", "messages", "permanent", "vacations"].includes(requestedTab)
    ? requestedTab
    : "profile";
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [vacationOpen, setVacationOpen] = useState(false);
  const { language } = useLanguage();
  useEffect(() => {
    void syncPushLanguage(language);
  }, [language]);


  // Message
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!user || !acting) return;
    setLoading(true);
    // Auto-process past lessons (Vilnius TZ) so subscription counters are fresh
    try { await supabase.functions.invoke("process-lessons"); } catch { /* non-fatal */ }
    const [b, s, m, p, ts, ap, pr, ov] = await Promise.all([
      supabase.from("bookings").select("*").eq("user_id", acting).order("slot_date").order("slot_time"),
      supabase.from("subscriptions").select("*").eq("user_id", acting).order("purchase_date", { ascending: false }),
      supabase.from("messages").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(200),
      supabase.from("permanent_slots").select("*").eq("user_id", acting).order("day_of_week").order("slot_time"),
      supabase.from("time_slots").select("id, day_of_week, slot_time, max_capacity").eq("active", true).is("one_off_date", null).order("day_of_week").order("slot_time"),
      supabase.from("profiles").select("id, full_name, phone").eq("id", acting).maybeSingle(),
      (supabase as any).from("permanent_slot_requests").select("id,day_of_week,slot_time,status,admin_note").eq("user_id", acting).order("created_at", { ascending: false }),
      (supabase as any).from("slot_overrides").select("slot_date,slot_time,max_capacity").order("slot_date"),
    ]);
    // attach horse names from horse_assignments
    const bs = (b.data ?? []) as any[];
    if (bs.length) {
      const ids = bs.map((x) => x.id);
      const { data: ha } = await supabase
        .from("horse_assignments")
        .select("booking_id, horse_id, slot_date, slot_time")
        .in("booking_id", ids);
      const horseIds = Array.from(new Set((ha ?? []).map((x: any) => x.horse_id)));
      let horseMap: Record<string, string> = {};
      if (horseIds.length) {
        const { data: hs } = await supabase.from("horses").select("id, name").in("id", horseIds);
        horseMap = Object.fromEntries((hs ?? []).map((h: any) => [h.id, h.name]));
      }
      const haMap: Record<string, string> = {};
      (ha ?? []).forEach((x: any) => { if (x.booking_id) haMap[x.booking_id] = horseMap[x.horse_id]; });
      const baseSlots = (ts.data ?? []) as any[];
      const overrides = (ov.data ?? []) as any[];
      const getCapacity = (date: string, time: string) => {
        const override = overrides.find((x) => x.slot_date === date && x.slot_time === time);
        if (override) return Number(override.max_capacity);
        const dow = dbDayOfWeek(new Date(date + "T12:00:00"));
        const slot = baseSlots.find((x) => Number(x.day_of_week) === dow && x.slot_time === time);
        return slot ? Number(slot.max_capacity) : null;
      };
      const withMeta = bs.map((x) => {
        const capacity = getCapacity(x.slot_date, x.slot_time);
        const kind = x.is_individual ? "individual" : capacity !== null && capacity <= 2 ? "po2" : "group";
        const price = kind === "individual" ? SINGLE_LESSON_PRICE.individual : kind === "po2" ? SINGLE_LESSON_PRICE.po2 : SINGLE_LESSON_PRICE.group;
        return { ...x, horse_name: haMap[x.id] ?? null, slot_capacity: capacity, lesson_kind: kind, lesson_price: price };
      });
      setBookings(canonicalBookings(withMeta));
    } else {
      setBookings([]);
    }
    setSubs(s.data ?? []);
    setMessages(m.data ?? []);
    setPermanents(p.data ?? []);
    setAvailableSlots(ts.data ?? []);
    setAccountProfile((ap.data as AccountProfile | null) ?? null);
    setPermanentRequests((pr.data ?? []) as PermanentRequest[]);

    // Load pending sickness cancellations awaiting / with documents
    const { data: sr } = await supabase
      .from("cancellation_requests")
      .select("id, booking_id, document_url, document_deadline, status, sickness, bookings(slot_date, slot_time)")
      .eq("user_id", acting)
      .eq("sickness", true)
      .order("created_at", { ascending: false })
      .limit(20);
    setSickReqs((sr ?? []).map((r: any) => ({
      id: r.id, booking_id: r.booking_id,
      document_url: r.document_url, document_deadline: r.document_deadline,
      slot_date: r.bookings?.slot_date, slot_time: r.bookings?.slot_time,
    })));

    setLoading(false);
  };
  const markSickDocSubmitted = async (req: PendingSickReq, sentinel: string) => {
    const { error } = await supabase.from("cancellation_requests")
      .update({ document_url: sentinel, document_uploaded_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) { toast.error(error.message); return false; }
    return true;
  };

  const sendSickDocViaMessage = async (req: PendingSickReq) => {
    if (!user) return;
    const body = `[Ligos pažyma] Pamoka ${req.slot_date} ${req.slot_time?.slice(0,5)} — pažymą atsiųsiu žinute (prikabinsiu nuotrauką arba PDF).`;
    const { error } = await supabase.from("messages").insert({ user_id: user.id, body });
    if (error) { toast.error(error.message); return; }
    if (await markSickDocSubmitted(req, "SENT_VIA_MESSAGE")) {
      toast.success("Pranešta administracijai — prisekite failą žinučių skiltyje");
      load();
    }
  };

  const sendSickDocViaEmail = async (req: PendingSickReq) => {
    const adminEmail = "jojimomokykla@gmail.com";
    const subject = encodeURIComponent(`Ligos pažyma — ${req.slot_date} ${req.slot_time?.slice(0,5)}`);
    const bodyTxt = encodeURIComponent(`Sveiki,\n\nSiunčiu ligos pažymą už pamoką ${req.slot_date} ${req.slot_time?.slice(0,5)}.\n\nAčiū.`);
    window.open(`mailto:${adminEmail}?subject=${subject}&body=${bodyTxt}`, "_blank");
    if (await markSickDocSubmitted(req, "SENT_VIA_EMAIL")) {
      toast.success("Pažymėta — neužmirškite išsiųsti laiško");
      load();
    }
  };


  // Mark received admin replies as read once user opens the page
  useEffect(() => {
    if (!user) return;
    const unread = messages.filter((m) => m.from_admin && !m.read_by_user).map((m) => m.id);
    if (unread.length > 0) {
      supabase.from("messages").update({ read_by_user: true }).in("id", unread);
    }
  }, [messages, user]);

  useEffect(() => { load(); }, [user, acting]);

  const now = new Date();
  const future = bookings.filter(
    (b: any) =>
      b.status === "active" &&
      b.is_paused_for_subscription !== true &&
      new Date(`${b.slot_date}T${b.slot_time}`) >= now,
  );
  const past = bookings.filter((b) => new Date(`${b.slot_date}T${b.slot_time}`) < now);
  const pausedFuture = bookings.filter(
    (b: any) =>
      b.status === "active" &&
      b.is_paused_for_subscription === true &&
      new Date(`${b.slot_date}T${b.slot_time}`) >= now,
  );

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthBookings = past.filter((b) => {
    const d = new Date(`${b.slot_date}T${b.slot_time}`);
    return d >= monthStart && d < monthEnd;
  });
  const monthAttended = monthBookings.filter((b) => b.status === "active" || b.status === "completed");
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthAttended = past.filter((b) => {
    const d = new Date(`${b.slot_date}T${b.slot_time}`);
    return d >= previousMonthStart && d < previousMonthEnd && (b.status === "active" || b.status === "completed");
  });

  // Lifetime stats
  const totalAttended = past.filter(
    (b) => (b.status === "active" || b.status === "completed") && b.counts_in_subscription === true,
  ).length;
  const totalCancelled = bookings.filter((b) => b.status === "cancelled").length;
  // Separate-payment lessons are intentionally outside subscription usage.
  const separatelyPaid = past.filter((b) =>
    (b.status === "active" || b.status === "completed") &&
    !b.subscription_id && b.counts_in_subscription === false,
  );

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

  // Permanent slots — users can only view & remove (admin adds them)

  const addPermanent = async (slot: AvailableSlot) => {
    const { data, error } = await (supabase as any).rpc("request_or_create_permanent_slot", { _day: slot.day_of_week, _time: slot.slot_time });
    if (error) { toast.error(error.message); return; }
    if (!data?.ok) { toast.error(data?.message ?? "Nepavyko pridėti"); return; }
    if (data?.requested) {
      toast.success("Prašymas išsiųstas administracijai");
    } else {
      toast.success("Nuolatinis laikas pridėtas");
    }
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
      .eq("user_id", acting!)
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

  const monthLabel = MONTHS_LT_NOM[now.getMonth()];

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-14 relative">
      <FloralAccent className="absolute -top-4 -right-12 hidden md:block" size={140} delay={0.3} rotate={25} />

      <motion.header
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mb-8"
      >
        <p className="text-xs uppercase tracking-[0.25em] text-gold/70 mb-2">Sveiki sugrįžę</p>
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold">{activeProfileName || profile?.full_name || "—"}</h1>
        {isLinked && (
          <p className="text-xs text-blush/80 mt-1 italic">
            Aktyvus profilis: {activeProfileName} · perjungti meniu
          </p>
        )}
        <div className="gold-divider mt-4 max-w-[120px]" />
      </motion.header>

      <VacationBanner userId={acting} />

      <Tabs value={activeTab} onValueChange={(value) => navigate(`/paskyra?tab=${value}`)}>
        <TabsList className="hidden sm:grid grid-cols-4 w-full bg-background/50 mb-6 h-auto gap-1 p-1">
          <TabsTrigger value="profile" className="py-2.5 text-xs sm:text-sm">Pagrindinis</TabsTrigger>
          <TabsTrigger value="lessons" className="py-2.5 text-xs sm:text-sm">Pamokos</TabsTrigger>
          <TabsTrigger value="subs" className="py-2.5 text-xs sm:text-sm">Abonementas</TabsTrigger>
          <TabsTrigger value="messages" className="py-2.5 text-xs sm:text-sm">Žinutės</TabsTrigger>
        </TabsList>

        {/* PROFILE OVERVIEW */}
        <TabsContent value="profile" className="space-y-5">
          <ProfileOverview profile={accountProfile} email={user?.email ?? null} isLinked={isLinked} activeProfileName={activeProfileName} />
          {!isLinked && user && <FamilyRidersSection parentUserId={user.id} />}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <QuickAction label="Mano informacija" icon={<UserIcon className="h-4 w-4" />} onClick={() => setEditOpen(true)} />
            <QuickAction label="Mano QR" icon={<QrCode className="h-4 w-4" />} onClick={() => navigate("/mano-qr")} />
            <QuickAction label="Pranešimai" icon={<Bell className="h-4 w-4" />} onClick={() => setPushOpen(true)} />
            <QuickAction label="Atostogos" icon={<CalendarDays className="h-4 w-4" />} onClick={() => setVacationOpen(true)} />
            <QuickAction label="Slaptažodis" icon={<KeyRound className="h-4 w-4" />} onClick={() => setPwOpen(true)} />
          </div>
          <ReadOnlyRecurringCard permanents={permanents} />
          <Section title="Kontaktai" icon={<Phone className="h-4 w-4" />}>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <a href="tel:+37062876090" className="group rounded-2xl border border-gold/15 bg-gradient-card p-4 transition-colors hover:border-gold/35">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Adrija</p>
                    <p className="mt-1 text-xs text-muted-foreground">Svetainės ir registracijos klausimai</p>
                    <p className="mt-2 text-sm text-gold">+370 628 76090</p>
                  </div>
                  <Phone className="h-4 w-4 text-gold" />
                </div>
              </a>
              <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Laura</p>
                    <p className="mt-1 text-xs text-muted-foreground">Treniruočių klausimai ir rezervacijos</p>
                    <p className="mt-2 text-sm text-gold">+370 658 22872</p>
                  </div>
                  <Phone className="h-4 w-4 text-gold" />
                </div>
                <div className="mt-3 flex gap-2">
                  <a href="tel:+37065822872" className="inline-flex min-h-9 items-center rounded-lg border border-gold/20 px-3 text-xs hover:bg-gold/5">Skambinti</a>
                  <a href="https://wa.me/37065822872" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg border border-gold/20 px-3 text-xs hover:bg-gold/5">WhatsApp</a>
                </div>
              </div>
              <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4 sm:col-span-2">
                <p className="text-xs text-muted-foreground">Parašyti administracijai per svetainę</p>
                <Button variant="outlineGold" size="sm" className="mt-3" onClick={() => navigate("/paskyra?tab=messages")}>
                  <MessageSquare className="mr-2 h-4 w-4" /> Susisiekti žinute
                </Button>
              </div>
            </div>
          </Section>
          <Section title="Spalvų ir šviesumo tema" icon={<Palette className="h-4 w-4" />}><div className="p-5"><ThemeSwitcher /></div></Section>
          <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Mano informacija</DialogTitle></DialogHeader><ProfileSettings onSaved={async () => { await refreshProfile(); await load(); setEditOpen(false); }} /></DialogContent></Dialog>
          <Dialog open={pwOpen} onOpenChange={setPwOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Slaptažodžio keitimas</DialogTitle></DialogHeader><PasswordChange /></DialogContent></Dialog>
          <Dialog open={pushOpen} onOpenChange={setPushOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Telefono pranešimai</DialogTitle></DialogHeader><PushNotificationSettings language={language} /></DialogContent></Dialog>
          <Dialog open={vacationOpen} onOpenChange={setVacationOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Atostogos / nedalyvavimas</DialogTitle></DialogHeader><VacationsPanel userId={acting} onChanged={() => void load()} /></DialogContent></Dialog>
        </TabsContent>

        {/* LESSONS */}
        <TabsContent value="lessons" className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
  <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4 text-center"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{monthLabel}</div><div className="mt-1 font-display text-4xl text-gradient-gold tabular-nums">{monthAttended.length}</div><div className="text-xs text-muted-foreground">pamokos</div></div>
  <div className="rounded-2xl border border-gold/15 bg-gradient-card p-4 text-center"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Praėjęs mėnuo</div><div className="mt-1 font-display text-4xl text-gradient-gold tabular-nums">{previousMonthAttended.length}</div><div className="text-xs text-muted-foreground">pamokos</div></div>
  <div className="col-span-2 sm:col-span-1 rounded-2xl border border-gold/15 bg-gradient-card p-4 text-center"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Iš viso</div><div className="mt-1 font-display text-4xl text-gradient-gold tabular-nums">{totalAttended}</div><div className="text-xs text-muted-foreground">pamokų</div></div>
</div>
          {pausedFuture.length > 0 && (
            <section className="rounded-2xl border border-blush/25 bg-blush/5 px-5 py-4">
              <div className="font-medium text-blush">Kai kurios būsimos rezervacijos laikinai sustabdytos</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Šios rezervacijos neberodomos grafike ir nenaudoja abonemento pamokų. Įsigijus tinkamą abonementą, jos bus automatiškai atkurtos, jei dar patenka į jo galiojimo laiką ir atitinka treniruotės tipą.
              </p>
            </section>
          )}
          <Section title="Artimiausios pamokos" icon={<CalendarDays className="w-4 h-4" />}>{future.length === 0 ? <Empty text="Artimiausių pamokų nėra." /> : <ul className="divide-y divide-gold/5">{future.slice(0, 7).map((b) => <BookingRow key={b.id} b={b} />)}</ul>}</Section>
          <Section title={`Šio mėnesio pamokos · ${monthAttended.length}`} icon={<CheckCircle2 className="w-4 h-4" />}>{monthBookings.length === 0 ? <Empty text="Šį mėnesį pamokų dar nėra." /> : <ul className="divide-y divide-gold/5">{monthBookings.slice().reverse().map((b) => <BookingRow key={b.id} b={b} past />)}</ul>}</Section>
          <Section title="Ankstesnės pamokos" icon={<BarChart3 className="w-4 h-4" />}>{past.filter((b) => b.status === "active" || b.status === "completed").length === 0 ? <Empty text="Ankstesnių pamokų nėra." /> : <ul className="divide-y divide-gold/5 max-h-80 overflow-auto">{past.filter((b) => b.status === "active" || b.status === "completed").slice().reverse().map((b) => <BookingRow key={b.id} b={b} past />)}</ul>}</Section>
          <Section title="Apmokėta atskirai nuo abonemento" icon={<Wallet className="w-4 h-4" />}>
            <div className="px-5 py-3 border-b border-gold/10 text-xs text-muted-foreground">
              Šios pamokos yra apmokamos atskirai ir <span className="text-foreground font-medium">nemažina abonemento</span>.
            </div>
            {separatelyPaid.length === 0 ? (
              <Empty text="Atskirai apmokėtų pamokų nėra." />
            ) : (
              <ul className="divide-y divide-gold/5 max-h-64 overflow-auto">
                {separatelyPaid.slice().reverse().map((b) => <BookingRow key={b.id} b={b} past separatelyPaid />)}
              </ul>
            )}
          </Section>
        </TabsContent>

        {/* SUBSCRIPTIONS */}
        <TabsContent value="subs" className="space-y-4">
          <Section title="Mano QR kodas" icon={<QrCode className="h-4 w-4" />}>
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Mano QR kodas</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Parodykite QR administratoriui arba treneriui, kad Jus greitai rastų ir galėtų tvarkyti abonementą.
                </p>
              </div>
              <Button variant="outlineGold" onClick={() => navigate("/mano-qr")} className="shrink-0">
                <QrCode className="mr-2 h-4 w-4" /> Atidaryti QR
              </Button>
            </div>
          </Section>
{subs.length === 0 ? (
            <Empty text="Nėra abonementų" />
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {subs.map((s) => {
                const attributedUsed = bookings.filter((b) =>
                  b.subscription_id === s.id &&
                  b.status === "completed" &&
                  b.counts_in_subscription !== false,
                ).length;
                // Usage is derived from bookings assigned to this subscription.
                const actualUsed = attributedUsed;
                const remaining = s.lessons_total - actualUsed;
                const expDays = s.expires_at ? Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 86400000) : Infinity;
                const lowRemaining = !s.start_pending && (remaining <= 1 || (expDays <= 7 && expDays >= 0));
                return (
                  <div key={s.id} className="relative">
                    {lowRemaining && (
                      <div className="absolute -top-2 left-3 z-10 px-2 py-0.5 rounded-full bg-destructive/80 text-destructive-foreground text-[10px] uppercase tracking-wider font-semibold animate-pulse">
                        {remaining <= 1 ? "Liko ≤1 treniruotė" : `Baigiasi po ${expDays} d.`}
                      </div>
                    )}
                    <SubscriptionCard
                      s={s}
                      effectiveUsed={actualUsed}
                      onMarkPaid={undefined}
                      onDelete={undefined}
                      onEditLessons={undefined}
                      lessons={bookings
                        .filter((b) => b.subscription_id === s.id)
                        .map((b) => ({
                          id: b.id,
                          slot_date: b.slot_date,
                          slot_time: b.slot_time,
                          status: b.status,
                          is_individual: !!b.is_individual,
                          horse_name: b.horse_name,
                          slot_capacity: b.slot_capacity,
                          lesson_price: b.lesson_price,
                          lesson_kind: b.lesson_kind,
                        }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* MESSAGES */}
        <TabsContent value="messages" className="space-y-4"><Section title="Susisiekti su administracija" icon={<MessageSquare className="w-4 h-4" />}><div className="p-5"><p className="mb-3 text-sm text-muted-foreground">Parašykite klausimą ar informaciją. Administracija atsakys čia.</p><Textarea id="msg" value={msgBody} onChange={(e) => setMsgBody(e.target.value)} maxLength={2000} rows={3} placeholder="Jūsų žinutė…" /><div className="mt-3 flex justify-end"><Button variant="gold" disabled={sending || !msgBody.trim()} onClick={sendMessage}>Siųsti žinutę</Button></div></div></Section>{messages.length > 0 && <Section title="Pokalbis" icon={<Inbox className="w-4 h-4" />}><ul className="divide-y divide-gold/5 max-h-[500px] overflow-auto">{messages.map((m) => <li key={m.id} className={cn("px-5 py-3", m.from_admin && "bg-gold/5")}><div className="flex items-baseline justify-between gap-2 mb-1"><span className={cn("text-xs", m.from_admin ? "text-gold" : "text-muted-foreground")}>{m.from_admin ? "Administracija" : "Jūs"}</span><span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString("lt-LT")}</span></div><div className="text-sm whitespace-pre-wrap">{m.body}</div></li>)}</ul></Section>}</TabsContent>

        {/* PERMANENT SLOTS */}
        <TabsContent value="permanent" className="space-y-4">
          <UserDuplicateBookings userId={acting} />
          <PermanentSlotsSection
            permanents={permanents}
            availableSlots={availableSlots}
            requests={permanentRequests}
            onAdd={addPermanent}
            onRemove={removePermanent}
          />
        </TabsContent>

        {/* VACATIONS */}
        <TabsContent value="vacations" className="space-y-6">
          <Section title="Mano atostogos" icon={<CalendarDays className="w-4 h-4" />}>
            <VacationsPanel userId={acting} />
          </Section>
        </TabsContent>
      </Tabs>


    </div>
  );
}

function PushNotificationSettings({ language }: { language: "lt" | "en" }) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enableFailed, setEnableFailed] = useState(false);
  const [reminderHours, setReminderHours] = useState<5 | 24>(24);

  useEffect(() => {
    if (!pushNotificationsSupported()) return;

    getPushSubscription()
      .then((subscription) => setEnabled(!!subscription))
      .catch(() => setEnabled(false));

    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      (supabase as any)
        .from("profiles")
        .select("notify_lesson_reminder_hours")
        .eq("id", data.user.id)
        .maybeSingle()
        .then(({ data: p }: any) => {
          if (p?.notify_lesson_reminder_hours === 5 || p?.notify_lesson_reminder_hours === 24) {
            setReminderHours(p.notify_lesson_reminder_hours);
          }
        });
    });
  }, []);

  const toggle = async () => {
    setBusy(true);
    setEnableFailed(false);
    try {
      if (enabled) {
        await disablePushNotifications();
        setEnabled(false);
        toast.success(
          language === "lt"
            ? "Telefono pranešimai išjungti. Jūsų treniruočių rezervacijos ir abonementas liko nepakeisti."
            : "Phone notifications are off. Your training bookings and lesson subscription were not changed.",
        );
      } else {
        await enablePushNotifications(language);
        setEnabled(true);
        toast.success(
          language === "lt"
            ? "Telefono pranešimai įjungti 🐴"
            : "Phone notifications enabled 🐴",
        );
      }
    } catch (error: any) {
      setEnabled(false);
      setEnableFailed(true);
      toast.error(
        error?.message ??
          (language === "lt"
            ? "Nepavyko įjungti telefono pranešimų."
            : "Could not enable phone notifications."),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveReminder = async (hours: 5 | 24) => {
    const previous = reminderHours;
    setReminderHours(hours);
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ notify_lesson_reminders: true, notify_lesson_reminder_hours: hours })
      .eq("id", data.user.id);
    if (error) {
      setReminderHours(previous);
      toast.error(
        language === "lt"
          ? "Nepavyko išsaugoti priminimo."
          : "Could not save reminder setting.",
      );
    }
  };

  const disableReminder = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ notify_lesson_reminders: false })
      .eq("id", data.user.id);
    if (error) {
      toast.error(
        language === "lt"
          ? "Nepavyko išjungti priminimo."
          : "Could not disable reminders.",
      );
    }
  };

  return (
    <Section
      title={language === "lt" ? "Pranešimai" : "Notifications"}
      icon={<Bell className="w-4 h-4" />}
    >
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium">
              {language === "lt" ? "Telefono pranešimai" : "Phone notifications"}
            </div>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              {language === "lt"
                ? "Tai tik telefono push pranešimai. Jūsų treniruočių rezervacijos ir abonementas nuo šio nustatymo nepriklauso."
                : "These are phone push notifications only. This setting does not change your training bookings or lesson subscription."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {enabled && (
              <span className="text-xs font-medium text-emerald-500">
                {language === "lt" ? "Įjungta" : "Enabled"}
              </span>
            )}
            <Button
            variant={enabled ? "outlineGold" : "gold"}
            size="sm"
            onClick={() => void toggle()}
            disabled={busy || !pushNotificationsSupported()}
          >
            {busy
              ? language === "lt"
                ? "Jungiamasi…"
                : "Connecting…"
              : enabled
                ? language === "lt"
                  ? "Išjungti telefono pranešimus"
                  : "Disable phone notifications"
                : enableFailed
                  ? language === "lt"
                    ? "Nepavyko įjungti"
                    : "Enable failed"
                  : language === "lt"
                    ? "Įjungti telefono pranešimus"
                    : "Enable phone notifications"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-gold/15 bg-background/25 p-4">
          <div className="font-medium">
            {language === "lt" ? "Treniruočių priminimai" : "Training reminders"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {language === "lt"
              ? "Pasirinkite, kada norite būti priminti apie artėjančią treniruotę. Šie priminimai yra neprivalomi."
              : "Choose when you want to be reminded about an upcoming training. These reminders are optional."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={reminderHours === 24 ? "gold" : "outlineGold"}
              onClick={() => void saveReminder(24)}
            >
              24 {language === "lt" ? "val. prieš" : "hours before"}
            </Button>
            <Button
              size="sm"
              variant={reminderHours === 5 ? "gold" : "outlineGold"}
              onClick={() => void saveReminder(5)}
            >
              5 {language === "lt" ? "val. prieš" : "hours before"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void disableReminder()}>
              {language === "lt" ? "Išjungti priminimą" : "Turn reminders off"}
            </Button>
          </div>
        </div>

        <p className="text-[11px] leading-5 text-muted-foreground">
          {language === "lt"
            ? "Svarbūs Equus atnaujinimai nėra reklama ir naudojami tik tam, kad žinotumėte apie jūsų rezervacijos pokyčius."
            : "Important Equus updates are not advertising and are used only to keep you informed about changes to your booking."}
        </p>
      </div>
    </Section>
  );
}

/* ───────────── Profile overview ───────────── */

function ProfileOverview({ profile, email, isLinked, activeProfileName }: { profile: AccountProfile | null; email: string | null; isLinked: boolean; activeProfileName: string }) {
  const fullName = profile?.full_name?.trim() || activeProfileName || "—";
  return <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-card p-5 shadow-elegant sm:p-7">
    <div className="flex items-center gap-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10 text-gold sm:h-20 sm:w-20"><Horse size={42} /></div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.22em] text-gold/70">Mano paskyra</p>
        <h2 className="truncate font-display text-2xl text-gradient-gold sm:text-3xl">{fullName}</h2>
        {isLinked && <p className="text-xs text-muted-foreground">Aktyvus profilis: {activeProfileName}</p>}
        <p className="truncate text-xs text-muted-foreground">{email || "El. paštas nenurodytas"}</p>
      </div>
    </div>
  </motion.section>;
}
function QuickAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex min-h-16 items-center justify-between gap-2 rounded-xl border border-gold/15 bg-gradient-card px-3 py-3 text-left hover:border-gold/35 hover:bg-gold/5"><span className="flex items-center gap-2 text-xs sm:text-sm"><span className="text-gold">{icon}</span>{label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>; }
function ReadOnlyRecurringCard({ permanents }: { permanents: PermanentSlot[] }) { return <Section title="Nuolatinis laikas" icon={<Star className="h-4 w-4" />}><div className="px-5 py-4">{permanents.length ? <div className="flex flex-wrap gap-2">{permanents.map((p) => <span key={p.id} className="rounded-full border border-gold/20 bg-gold/5 px-3 py-1.5 text-sm">{WEEKDAYS_LT[p.day_of_week - 1]} · {formatTime(p.slot_time)}</span>)}</div> : <p className="text-sm text-muted-foreground">Nuolatinio laiko dar nėra.</p>}<p className="mt-2 text-xs text-muted-foreground">Nuolatinius laikus nustato administracija.</p></div></Section>; }

function ProfileStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-gold/15 bg-gradient-card p-4 shadow-elegant"
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span className="text-gold">{icon}</span>
        {label}
      </div>
      <div className="font-display text-3xl text-gradient-gold tabular-nums">{value}</div>
    </motion.div>
  );
}

/* ───────────── Settings sub-sections ───────────── */

function ProfileSettings({ onSaved }: { onSaved: () => void | Promise<void> }) {
  const { user, profile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
    setEmail(user?.email ?? "");
  }, [profile, user?.email]);

  const save = async () => {
    if (!user) return;
    if (name.trim().length < 2) { toast.error("Vardas per trumpas"); return; }

    let normalizedEmail = email.trim().toLowerCase().replace(/\s+/g, "");
    let correctedGmailTypo = false;
    if (/@gmail\.gom$/i.test(normalizedEmail)) {
      normalizedEmail = normalizedEmail.replace(/@gmail\.gom$/i, "@gmail.com");
      correctedGmailTypo = true;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error("Įveskite galiojantį el. pašto adresą");
      return;
    }

    setSaving(true);

    const emailChanged = normalizedEmail !== (user.email ?? "").trim().toLowerCase();
    if (emailChanged) {
      const { error: emailError } = await supabase.auth.updateUser({
        email: normalizedEmail,
      });
      if (emailError) {
        setSaving(false);
        toast.error(emailError.message || "Nepavyko pakeisti el. pašto");
        return;
      }
    }

    const { error } = await supabase.from("profiles")
      .update({
        full_name: name.trim(),
        phone: phone.trim() || null,
      } as any)
      .eq("id", user.id);

    setSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (emailChanged) {
      setEmail(normalizedEmail);
      toast.success(
        correctedGmailTypo
          ? "El. paštas pataisytas į gmail.com. Patikrinkite patvirtinimo laišką."
          : "El. pašto keitimas pradėtas. Patikrinkite patvirtinimo laišką.",
      );
    } else {
      toast.success("Išsaugota!:)");
    }

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
        <div>
          <Label htmlFor="pf-email">El. paštas</Label>
          <Input
            id="pf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="email"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Jei pakeisite el. paštą, reikės patvirtinti naują adresą el. paštu.
          </p>
          {/@gmail\.gom$/i.test(email.trim()) && (
            <p className="text-xs text-blush mt-1">
              Atrodo, kad turėjote omenyje <strong>{email.trim().replace(/@gmail\.gom$/i, "@gmail.com")}</strong>.
            </p>
          )}
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
  availableSlots,
  requests,
  onAdd,
  onRemove,
}: {
  permanents: PermanentSlot[];
  availableSlots: AvailableSlot[];
  requests: PermanentRequest[];
  onAdd: (slot: AvailableSlot) => void;
  onRemove: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const options = availableSlots.filter((slot) => !permanents.some((p) => p.day_of_week === slot.day_of_week && p.slot_time === slot.slot_time));
  const chosen = options.find((x) => x.id === selected);
  return (
    <Section title="Mano savaitinis grafikas" icon={<Star className="w-4 h-4" />}>
      <div className="p-5 space-y-5">
        <div>
          <p className="text-sm text-muted-foreground mb-3">Pasirinkite laiką, į kurį norite būti automatiškai registruojama kiekvieną savaitę.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">— pasirinkite laiką —</option>
              {options.map((slot) => <option key={slot.id} value={slot.id}>{WEEKDAYS_LT[slot.day_of_week - 1]} · {formatTime(slot.slot_time)} · talpa {slot.max_capacity}</option>)}
            </select>
            <Button variant="gold" disabled={!chosen} onClick={() => chosen && onAdd(chosen)}>
              <Plus className="w-4 h-4" /> {chosen && chosen.max_capacity <= 2 ? "Siųsti prašymą" : "Pridėti laiką"}
            </Button>
          </div>
          {chosen && <p className="text-xs text-muted-foreground mt-2">{chosen.max_capacity <= 2 ? "Kadangi šios treniruotės talpa yra 1–2, laiką turi patvirtinti administratorius." : "Šis laikas bus patikrintas pagal būsimas savaites. Viena treniruotė gali turėti daugiausia 5 nuolatines vietas."}</p>}
        </div>

        {requests.filter((r) => r.status === "pending").length > 0 && <div className="space-y-2"><div className="text-xs uppercase tracking-wider text-muted-foreground">Laukiantys prašymai</div>{requests.filter((r) => r.status === "pending").map((r) => <div key={r.id} className="flex items-center justify-between rounded-md border border-gold/20 bg-gold/5 px-4 py-2.5"><span>{WEEKDAYS_LT[r.day_of_week - 1]} · {formatTime(r.slot_time)}</span><span className="text-xs text-gold">Laukia patvirtinimo</span></div>)}</div>}

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Aktyvūs nuolatiniai laikai</div>
          {permanents.length === 0 ? <p className="text-sm italic text-muted-foreground py-3">Šiuo metu neturite nuolatinių laikų</p> : <ul className="space-y-2">{permanents.map((p) => <li key={p.id} className="flex items-center justify-between bg-gold/5 border border-gold/15 rounded-md px-4 py-3"><span className="flex items-center gap-2"><Star className="w-3.5 h-3.5 fill-gold text-gold"/><span className="font-medium">{WEEKDAYS_LT[p.day_of_week - 1]}</span><span className="text-muted-foreground tabular-nums">{formatTime(p.slot_time)}</span></span><button onClick={() => onRemove(p.id)} className="text-muted-foreground hover:text-destructive" title="Pašalinti"><Trash2 className="w-4 h-4"/></button></li>)}</ul>}
        </div>
      </div>
    </Section>
  );
}

function FamilyRidersSection({ parentUserId }: { parentUserId: string }) {
  type FamilyRider = {
    id: string;
    first_name: string;
    last_name: string;
    experience_text: string | null;
    always_together: boolean;
  };

  const [riders, setRiders] = useState<FamilyRider[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyRider | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [experience, setExperience] = useState("");
  const [alwaysTogether, setAlwaysTogether] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await (supabase as any)
      .from("family_riders")
      .select("id,first_name,last_name,experience_text,always_together")
      .eq("parent_user_id", parentUserId)
      .order("first_name");

    if (!error) setRiders((data ?? []) as FamilyRider[]);
  };

  useEffect(() => {
    void load();
  }, [parentUserId]);

  const reset = () => {
    setEditing(null);
    setFirstName("");
    setLastName("");
    setExperience("");
    setAlwaysTogether(false);
  };

  const openAdd = () => {
    reset();
    setOpen(true);
  };

  const openEdit = (rider: FamilyRider) => {
    setEditing(rider);
    setFirstName(rider.first_name);
    setLastName(rider.last_name);
    setExperience(rider.experience_text ?? "");
    setAlwaysTogether(rider.always_together);
    setOpen(true);
  };

  const save = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    const exp = experience.trim();

    if (first.length < 1 || last.length < 1) {
      toast.error("Įveskite vardą ir pavardę.");
      return;
    }
    if (exp.length < 30) {
      toast.error("Aprašykite jojimo patirtį bent 30 simbolių.");
      return;
    }

    setSaving(true);

    const payload = {
      first_name: first,
      last_name: last,
      experience_text: exp,
      always_together: alwaysTogether,
    };

    const { error } = editing
      ? await (supabase as any)
          .from("family_riders")
          .update(payload)
          .eq("id", editing.id)
          .eq("parent_user_id", parentUserId)
      : await (supabase as any)
          .from("family_riders")
          .insert({ ...payload, parent_user_id: parentUserId });

    setSaving(false);

    if (error) {
      toast.error(error.message || "Nepavyko išsaugoti raitelio.");
      return;
    }

    setOpen(false);
    reset();
    await load();
    toast.success(editing ? "Raitelio informacija atnaujinta." : "Raitelis pridėtas.");
  };

  const remove = async (rider: FamilyRider) => {
    const { count, error: countError } = await (supabase as any)
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", parentUserId)
      .eq("family_rider_id", rider.id);

    if (countError) {
      toast.error("Nepavyko patikrinti raitelio rezervacijų.");
      return;
    }

    if ((count ?? 0) > 0) {
      toast.error("Raitelio pašalinti negalima, nes jo rezervacijų istorija turi būti išsaugota. Galite išjungti „Visada registruoti kartu“ ir redaguoti duomenis.");
      return;
    }

    if (!window.confirm(`Pašalinti ${rider.first_name} ${rider.last_name} iš paskyros?`)) return;

    const { error } = await (supabase as any)
      .from("family_riders")
      .delete()
      .eq("id", rider.id)
      .eq("parent_user_id", parentUserId);

    if (error) {
      toast.error(error.message || "Nepavyko pašalinti.");
      return;
    }

    await load();
    toast.success("Raitelis pašalintas.");
  };

  return (
    <>
      <Section title="Kartu lankantys raiteliai" icon={<UserIcon className="h-4 w-4" />}>
        <div className="space-y-4 p-5">
          <div className="rounded-2xl border border-gold/15 bg-gold/5 p-4 text-sm leading-6">
            <p className="font-medium">Vaiką ar kitą kartu lankantį raitelį galite turėti savo paskyroje.</p>
            <p className="mt-1 text-muted-foreground">
              Jam nereikia atskiro prisijungimo. Rezervuojant galėsite parodyti „+ Pridėti“,
              o vieno raitelio atšaukimas kito rezervacijos nepakeis.
            </p>
          </div>

          {riders.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {riders.map((rider) => (
                <div key={rider.id} className="rounded-2xl border border-gold/15 bg-gradient-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-xl text-gold">
                        {rider.first_name} {rider.last_name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {rider.always_together ? "Numatyta registruoti kartu" : "Pridedamas pagal poreikį"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(rider)}
                      className="rounded-lg border border-gold/20 px-2.5 py-1.5 text-xs text-gold hover:bg-gold/5"
                    >
                      Redaguoti
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {rider.experience_text}
                  </p>
                  <button
                    type="button"
                    onClick={() => void remove(rider)}
                    className="mt-3 text-xs text-muted-foreground hover:text-destructive"
                  >
                    Pašalinti
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button variant="outlineGold" onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Pridėti raitelį
          </Button>
        </div>
      </Section>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !saving) {
            setOpen(false);
            reset();
          }
        }}
      >
        <DialogContent className="max-h-[88dvh] overflow-y-auto border-gold/25 bg-gradient-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-gradient-gold">
              {editing ? "Redaguoti raitelį" : "Pridėti raitelį"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Vardas</Label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} />
              </div>
              <div>
                <Label>Pavardė</Label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} />
              </div>
            </div>

            <div>
              <div className="flex items-end justify-between gap-3">
                <Label>Jojimo patirtis</Label>
                <span className={cn("text-xs tabular-nums", experience.trim().length >= 30 ? "text-emerald-500" : "text-muted-foreground")}>
                  {experience.length}/30 min.
                </span>
              </div>
              <Textarea
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                minLength={30}
                maxLength={500}
                rows={6}
                className="mt-1.5"
                placeholder="Kiek laiko jodinėja, ką moka, ar turi varžybų patirties…"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gold/20 bg-gold/5 p-4">
              <input
                type="checkbox"
                checked={alwaysTogether}
                onChange={(e) => setAlwaysTogether(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--gold))]"
              />
              <span>
                <span className="block text-sm font-medium">Visada registruoti kartu</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Rezervuojant šis raitelis bus pasirinktas iš karto. Jūs vis tiek
                  galėsite nuimti varnelę ir registruotis tik pats.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={saving}>
              Atšaukti
            </Button>
            <Button variant="gold" onClick={save} disabled={saving}>
              {saving ? "Saugoma…" : "Išsaugoti"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PasswordChange() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pw.length < 8) {
      toast.error("Slaptažodis turi būti bent 8 simbolių");
      return;
    }
    if (pw !== pw2) {
      toast.error("Slaptažodžiai nesutampa");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);

    if (error) {
      toast.error(error.message || "Nepavyko pakeisti slaptažodžio");
      return;
    }

    toast.success("Slaptažodis pakeistas");
    setPw("");
    setPw2("");
  };

  return (
    <Section title="Pakeisti slaptažodį" icon={<KeyRound className="w-4 h-4" />}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          Kadangi jau esate prisijungę, slaptažodį galite pakeisti tiesiogiai.
          Telefono numerio papildomai tikrinti nereikia.
        </p>
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
          <Button variant="gold" onClick={submit} disabled={busy}>
            {busy ? "Keičiama…" : "Pakeisti"}
          </Button>
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

function BookingRow({ b, past, separatelyPaid }: { b: Booking; past?: boolean; separatelyPaid?: boolean }) {
  const d = new Date(`${b.slot_date}T${b.slot_time}`);
  return (
    <li className="flex items-center justify-between px-5 py-3 text-sm">
      <div>
        <div className="font-medium">
          {d.toLocaleDateString("lt-LT", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <div className="text-muted-foreground tabular-nums">
          {formatTime(b.slot_time)}
          {b.is_grace_booking && !past && (
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-blush">
              · Vienintelė būsima be abonemento
            </span>
          )}
          <span className="ml-2 text-xs text-gold/80 font-medium">
            {b.lesson_kind === "individual" || b.is_individual ? "· Individuali" : b.lesson_kind === "po2" ? "· Po 2" : "· Grupinė"}
          </span>
          {b.horse_name && (
            <span className="ml-2 text-xs text-gold/80 font-mono">({b.horse_name})</span>
          )}
        </div>
      </div>
      <div>
        {b.status === "cancelled" && <span className="text-xs px-2 py-0.5 rounded bg-destructive/15 text-destructive">Atšaukta</span>}
        {past && (b.status === "completed" || b.status === "active") && (
          <span className="text-xs text-gold/80">
            {separatelyPaid && b.lesson_price != null && <span className="mr-2 text-xs font-semibold text-gold">{b.lesson_price.toFixed(2)} €</span>}
          ✓ {separatelyPaid ? "Apmokėta atskirai" : b.counts_in_subscription === false ? "Įvyko (nesiskaičiuoja)" : "Įvyko"}
          </span>
        )}
      </div>
    </li>
  );
}

export function SubscriptionCard({ s, effectiveUsed, onMarkPaid, onDelete, onEditLessons, onEditUsed, extra, lessons }: { s: Subscription; effectiveUsed?: number; onMarkPaid?: (id: string) => void; lessons?: { id: string; slot_date: string; slot_time: string; status: string; horse_name?: string | null; slot_capacity?: number | null; lesson_price?: number | null; lesson_kind?: "individual" | "po2" | "group" }[]; onDelete?: (id: string) => void; onEditLessons?: (s: Subscription) => void; onEditUsed?: (s: Subscription) => void; extra?: React.ReactNode }) {
  const used = effectiveUsed ?? s.lessons_used;
  const remaining = s.lessons_total - used;
  const startDate = s.start_from_date || null;
  const notStarted = !!s.start_pending || (startDate ? new Date(`${startDate}T23:59:59`) > new Date() : false);
  const expired = !s.start_pending && !!s.expires_at && new Date(`${s.expires_at}T23:59:59`) < new Date();
  const [showLessons, setShowLessons] = useState(false);
  return <div className={cn("rounded-2xl border bg-gradient-card p-5", remaining <= 0 ? "border-destructive/40" : "border-gold/15", expired && "opacity-60")}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground"> {s.start_pending ? "Laukia pirmos treniruotės" : notStarted ? "Kitas abonementas" : expired ? "Pasibaigęs abonementas" : "Aktyvus abonementas"}</p><div className="mt-1 font-display text-xl">{s.lessons_total} pamokos</div></div>{s.paid ? <span className="text-xs px-2 py-1 rounded-full bg-gold/15 text-gold border border-gold/30"><CheckCircle2 className="inline h-3 w-3 mr-1" />Apmokėta</span> : <button type="button" onClick={() => onMarkPaid?.(s.id)} className="text-xs px-2 py-1 rounded-full bg-blush/15 text-blush border border-blush/30">Neapmokėta</button>}</div>
    <div className="mt-4 flex items-end justify-between gap-4"><div><div className="font-display text-4xl text-gradient-gold">{remaining}</div>{onEditLessons && <button type="button" onClick={() => onEditLessons(s)} className="mt-1 text-[10px] text-muted-foreground hover:text-gold">Keisti visą kiekį</button>}{onEditUsed && <button type="button" onClick={() => onEditUsed(s)} className="ml-2 mt-1 text-[10px] text-muted-foreground hover:text-gold">Keisti panaudota</button>}<div className="text-xs text-muted-foreground">panaudota {used} · liko {remaining}</div></div><div className="text-right text-xs text-muted-foreground">{s.start_pending ? <><div className="text-foreground">Pradžia po pirmos treniruotės</div><div className="mt-1">Galioja 30 dienų nuo pradžios</div></> : <><div>Pradžia <span className="text-foreground">{startDate}</span></div><div className="mt-1">Galioja iki <span className="text-foreground">{s.expires_at}</span></div></>}<div className="mt-1">{Number(s.price).toFixed(2)} €</div></div></div>
    {!extra && (
      <div className="mt-4 border-t border-gold/10 pt-3 text-xs text-muted-foreground">
        {Number(s.covered_riders ?? 1) === 2
          ? "👥 Šis abonementas dengia 2 raitelius · bendra rezervacija sunaudoja 2 treniruotes"
          : "👤 Šis abonementas dengia 1 raitelį"}
      </div>
    )}
    {extra && <div className="mt-4 border-t border-gold/10 pt-3">{extra}</div>}
    {onDelete && <div className="mt-4 flex justify-end border-t border-gold/10 pt-3"><button type="button" onClick={() => onDelete(s.id)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"><Trash2 className="h-3 w-3" /> Ištrinti</button></div>}
    {lessons && <div className="mt-4 border-t border-gold/10 pt-3"><button type="button" onClick={() => setShowLessons(v => !v)} className="flex w-full items-center justify-between text-sm font-medium"><span>Pamokos šiame abonemente</span><ChevronRight className={cn("h-4 w-4 text-gold", showLessons && "rotate-90")} /></button>{showLessons && <ul className="mt-3 space-y-2">{lessons.map((l) => { const kind = l.lesson_kind === "individual" ? "Individuali" : l.lesson_kind === "po2" ? "Po 2" : "Grupinė"; const extra = l.lesson_kind === "individual" || (l.lesson_kind === "po2" && s.lesson_type !== "sportine_po2"); return <li key={l.id} className="rounded-xl border border-gold/10 bg-background/30 px-3 py-2.5"><div className="flex justify-between gap-3"><div><div className="text-sm">{l.slot_date} · {formatTime(l.slot_time)}</div><div className="text-xs text-muted-foreground">{kind}{l.horse_name ? " · 🐎 " + l.horse_name : ""}{l.slot_capacity ? " · talpa " + l.slot_capacity : ""}</div></div><div className="text-right">{l.lesson_price != null ? <div className="text-sm font-semibold text-gold">{l.lesson_price.toFixed(2)} €</div> : <div className="text-xs font-semibold text-blush">Individualus tarifas</div>}<div className="text-[10px] text-muted-foreground">{extra ? "mokama atskirai" : l.status === "cancelled" ? "atšaukta" : "įskaičiuota"}</div></div></div></li>; })}</ul>}</div>}
  </div>;
}
