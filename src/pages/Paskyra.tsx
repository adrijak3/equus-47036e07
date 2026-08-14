import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { calculateSubPriceByType, dbDayOfWeek, expiryFromPurchase, formatDateISO, formatTime, LESSON_TYPE_LABEL, MONTHS_LT_NOM, WEEKDAYS_LT, type LessonType } from "@/lib/equus";
import { CalendarDays, Clock, CheckCircle2, XCircle, Plus, MessageSquare, Star, Trash2, KeyRound, User as UserIcon, Wallet, Inbox, Mail, Phone, IdCard, Pencil, Sparkles } from "lucide-react";
import { Horse } from "@/components/icons/Horse";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { FloralAccent } from "@/components/Decorations";
import { VacationsPanel, VacationBanner } from "@/components/VacationsPanel";
import { UnpaidLessonsOverview } from "@/components/UnpaidLessonsOverview";
import { UserDuplicateBookings } from "@/components/UserDuplicateBookings";
import { useLanguage } from "@/contexts/LanguageContext";

interface Booking {
  id: string;
  slot_date: string;
  slot_time: string;
  status: string;
  counts_in_subscription: boolean;
  subscription_id?: string | null;
  horse_name?: string | null;
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
  lesson_type?: string;
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
  display_name: string | null;
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
  const [activeTab, setActiveTab] = useState("profile");
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const { language } = useLanguage();

  // Add subscription dialog
  const [subDialog, setSubDialog] = useState(false);
  const [newSubLessons, setNewSubLessons] = useState(8);
  const [newSubDate, setNewSubDate] = useState(formatDateISO(new Date()));
  const [newSubPaid, setNewSubPaid] = useState(false);
  const [newSubType, setNewSubType] = useState<LessonType>("sportine");
  const [newSubAlreadyUsed, setNewSubAlreadyUsed] = useState(0);
  /** Past bookings without a subscription (offered to attribute when buying) */
  const [unattributedPast, setUnattributedPast] = useState<Booking[]>([]);
  const [attributeIds, setAttributeIds] = useState<Set<string>>(new Set());



  // Message
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!user || !acting) return;
    setLoading(true);
    // Auto-process past lessons (Vilnius TZ) so subscription counters are fresh
    try { await supabase.functions.invoke("process-lessons"); } catch { /* non-fatal */ }
    const [b, s, m, p, ts, ap, pr] = await Promise.all([
      supabase.from("bookings").select("*").eq("user_id", acting).order("slot_date").order("slot_time"),
      supabase.from("subscriptions").select("*").eq("user_id", acting).order("purchase_date", { ascending: false }),
      supabase.from("messages").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(200),
      supabase.from("permanent_slots").select("*").eq("user_id", acting).order("day_of_week").order("slot_time"),
      supabase.from("time_slots").select("id, day_of_week, slot_time, max_capacity").eq("active", true).is("one_off_date", null).order("day_of_week").order("slot_time"),
      supabase.from("profiles").select("id, full_name, phone, display_name").eq("id", acting).maybeSingle(),
      (supabase as any).from("permanent_slot_requests").select("id,day_of_week,slot_time,status,admin_note").eq("user_id", acting).order("created_at", { ascending: false }),
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
      setBookings(bs.map((x) => ({ ...x, horse_name: haMap[x.id] ?? null })));
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
  const future = bookings.filter((b) => b.status === "active" && new Date(`${b.slot_date}T${b.slot_time}`) >= now);
  const past = bookings.filter((b) => new Date(`${b.slot_date}T${b.slot_time}`) < now);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthBookings = past.filter((b) => {
    const d = new Date(`${b.slot_date}T${b.slot_time}`);
    return d >= monthStart && d < monthEnd;
  });
  const monthAttended = monthBookings.filter((b) => b.status === "active" || b.status === "completed");

  // Lifetime stats
  const totalAttended = past.filter(
    (b) => (b.status === "active" || b.status === "completed") && b.counts_in_subscription === true,
  ).length;
  const totalCancelled = bookings.filter((b) => b.status === "cancelled").length;

  const effLessons = newSubType === "vienkartine" ? 1 : newSubLessons;
  const newSubPrice = calculateSubPriceByType(effLessons, newSubType);

  // When subscription dialog opens, pre-load past bookings that aren't tied to any subscription.
  useEffect(() => {
    if (!subDialog || !acting) return;
    (async () => {
      // Include today's bookings too — admin/user chooses whether today counts
      const { data } = await supabase
        .from("bookings")
        .select("id, slot_date, slot_time, status, counts_in_subscription, subscription_id")
        .eq("user_id", acting)
        .is("subscription_id", null)
        .lte("slot_date", formatDateISO(new Date()))
        .neq("status", "cancelled")
        .gte("slot_date", newSubDate)
        .order("slot_date", { ascending: false })
        .limit(30);
      setUnattributedPast((data ?? []) as any);
      setAttributeIds(new Set());
    })();
  }, [subDialog, acting, newSubDate]);

  const addSubscription = async () => {
    if (!user || !acting) return;
    if (effLessons < 1 || effLessons > 50) { toast.error("Pamokų skaičius 1–50"); return; }
    const fromAttribution = attributeIds.size;
    const totalUsed = newSubAlreadyUsed + fromAttribution;
    if (totalUsed > effLessons) {
      toast.error(`Panaudota (${totalUsed}) negali viršyti pamokų sk. (${effLessons})`);
      return;
    }
    const { data: ins, error } = await supabase.from("subscriptions").insert({
      user_id: acting,
      lessons_total: effLessons,
      lessons_used: totalUsed,
      lesson_type: newSubType,
      price: newSubPrice,
      purchase_date: newSubDate,
      expires_at: expiryFromPurchase(newSubDate),
      paid: newSubPaid,
    } as any).select("id").maybeSingle();
    if (error) { toast.error(error.message); return; }
    // Attribute selected past bookings to this new subscription
    if (ins?.id && attributeIds.size > 0) {
      await supabase.from("bookings")
        .update({ subscription_id: ins.id, counts_in_subscription: true } as any)
        .in("id", Array.from(attributeIds));
    }
    toast.success("Abonementas pridėtas");
    setSubDialog(false);
    setNewSubLessons(8);
    setNewSubPaid(false);
    setNewSubType("sportine");
    setNewSubAlreadyUsed(0);
    setAttributeIds(new Set());
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

  // Permanent slots — users can only view & remove (admin adds them)

  const addPermanent = async (slot: AvailableSlot) => {
    const { data, error } = await (supabase as any).rpc("request_or_create_permanent_slot", { _day: slot.day_of_week, _time: slot.slot_time });
    if (error) { toast.error(error.message); return; }
    if (!data?.ok) { toast.error(data?.message ?? "Nepavyko pridėti"); return; }
    data?.requested ? toast.success("Prašymas išsiųstas administracijai") : toast.success("Nuolatinis laikas pridėtas");
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

  const markSubPaid = async (subId: string) => {
    if (!confirm("Pažymėti šį abonementą kaip APMOKĖTĄ?")) return;
    const { error } = await supabase.from("subscriptions").update({ paid: true }).eq("id", subId);
    if (error) { toast.error(error.message); return; }
    toast.success("Pažymėta apmokėta. Administracija patvirtins.");
    load();
  };

  const deleteSub = async (subId: string) => {
    if (!confirm("Ar tikrai norite ištrinti šį abonementą? Šio veiksmo atšaukti negalėsite.")) return;
    const { error } = await supabase.from("subscriptions").delete().eq("id", subId);
    if (error) { toast.error(error.message); return; }
    toast.success("Abonementas ištrintas");
    load();
  };

  const editSubLessons = async (s: Subscription) => {
    const txt = prompt(
      `Pakeisti treniruočių skaičių abonemente.\n\nDabar: ${s.lessons_used}/${s.lessons_total}\nGalima padidinti arba sumažinti. Jei sumažinsite mažiau už panaudotų, panaudotų skaičius bus automatiškai sumažintas.`,
      String(s.lessons_total),
    );
    if (txt === null) return;
    const n = parseInt(txt);
    if (!Number.isFinite(n) || n < 1 || n > 100) { toast.error("Įveskite skaičių 1–100"); return; }
    const newUsed = Math.min(s.lessons_used, n);
    const { error } = await supabase.from("subscriptions")
      .update({ lessons_total: n, lessons_used: newUsed }).eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atnaujinta");
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
        <h1 className="text-4xl sm:text-5xl font-display text-gradient-gold">{activeProfileName || profile?.full_name || "—"}</h1>
        {isLinked && (
          <p className="text-xs text-blush/80 mt-1 italic">
            Aktyvus profilis: {activeProfileName} · perjungti meniu
          </p>
        )}
        <div className="gold-divider mt-4 max-w-[120px]" />
      </motion.header>

      <VacationBanner userId={acting} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-6 w-full bg-background/50 mb-6 h-auto gap-1 p-1">
          <TabsTrigger value="profile" aria-label="Profilis" title="Profilis" className="py-2">
            <UserIcon className="w-[18px] h-[18px]" />
          </TabsTrigger>
          <TabsTrigger value="lessons" aria-label="Treniruotės" title="Treniruotės" className="py-2">
            <Horse size={18} />
          </TabsTrigger>
          <TabsTrigger value="subs" aria-label="Abonementai" title="Abonementai" className="py-2">
            <Wallet className="w-[18px] h-[18px]" />
          </TabsTrigger>
          <TabsTrigger value="permanent" aria-label="Nuolatiniai" title="Nuolatiniai laikai" className="py-2">
            <Star className="w-[18px] h-[18px]" />
          </TabsTrigger>
          <TabsTrigger value="messages" aria-label="Žinutės" title="Žinutės" className="py-2">
            <Inbox className="w-[18px] h-[18px]" />
          </TabsTrigger>
          <TabsTrigger value="vacations" aria-label="Atostogos" title="Atostogos" className="py-2">
            <CalendarDays className="w-[18px] h-[18px]" />
          </TabsTrigger>
        </TabsList>

        {/* PROFILE OVERVIEW */}
        <TabsContent value="profile" className="space-y-6">
          <ProfileOverview
            profile={accountProfile}
            email={user?.email ?? null}
            isLinked={isLinked}
            activeProfileName={activeProfileName}
            futureLessons={future.length}
            totalAttended={totalAttended}
            subscriptions={subs}
            onEdit={() => setEditOpen(true)}
            onPassword={() => setPwOpen(true)}
          />

          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{language === "lt" ? "Asmeninė informacija" : "Personal information"}</DialogTitle>
              </DialogHeader>
              <ProfileSettings
                onSaved={async () => {
                  await refreshProfile();
                  await load();
                  setEditOpen(false);
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={pwOpen} onOpenChange={setPwOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{language === "lt" ? "Slaptažodžio keitimas" : "Change password"}</DialogTitle>
              </DialogHeader>
              <PasswordChange />
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* LESSONS */}
        <TabsContent value="lessons" className="space-y-6">
          <UnpaidLessonsOverview userId={acting} />
          {sickReqs.filter((r) => !r.document_url && r.document_deadline).length > 0 && (
            <Section title="Ligos pažymos" icon={<XCircle className="w-4 h-4" />}>
              <ul className="divide-y divide-gold/5">
                {sickReqs.filter((r) => !r.document_url && r.document_deadline).map((r) => {
                  const overdue = r.document_deadline && r.document_deadline < formatDateISO(new Date());
                  return (
                    <li key={r.id} className="px-5 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">
                          Pamoka {r.slot_date} {r.slot_time?.slice(0, 5)}
                        </div>
                        <div className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
                          {overdue
                            ? "Terminas pasibaigęs — laukia administracijos sprendimo"
                            : `Įkelti pažymą iki: ${r.document_deadline}`}
                        </div>
                      </div>
                      {!overdue && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="gold" onClick={() => sendSickDocViaMessage(r)}>
                            <MessageSquare className="w-4 h-4" /> Žinute administracijai
                          </Button>
                          <Button size="sm" variant="outlineGold" onClick={() => sendSickDocViaEmail(r)}>
                            El. paštu
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {/* Lifetime stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-card border border-gold/15 rounded-lg p-5 text-center shadow-elegant">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Iš viso treniruočių</div>
              <div className="font-display text-4xl text-gradient-gold tabular-nums mt-1">{totalAttended}</div>
            </div>
            <div className="bg-gradient-card border border-gold/15 rounded-lg p-5 text-center shadow-elegant">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Atšauktų</div>
              <div className="font-display text-4xl text-blush tabular-nums mt-1">{totalCancelled}</div>
            </div>
          </div>

          <Section title="Užsirašytos treniruotės" icon={<CalendarDays className="w-4 h-4" />}>
            {future.length === 0 ? (
              <Empty text="Nėra suplanuotų treniruočių" />
            ) : (
              <ul className="divide-y divide-gold/5">
                {future.map((b) => <BookingRow key={b.id} b={b} />)}
              </ul>
            )}
          </Section>

          <Section title={`${monthLabel} lankomumas`} icon={<CheckCircle2 className="w-4 h-4" />}>
            <div className="flex items-baseline gap-3 px-5 py-3">
              <span className="font-display text-4xl text-gradient-gold tabular-nums">{monthAttended.length}</span>
              <span className="text-sm text-muted-foreground">treniruočių šį mėnesį</span>
            </div>
            {monthBookings.length > 0 && (
              <ul className="divide-y divide-gold/5 border-t border-gold/10">
                {monthBookings.map((b) => <BookingRow key={b.id} b={b} past />)}
              </ul>
            )}
          </Section>

          {(() => {
            const pastAttended = past.filter((b) => b.status === "active" || b.status === "completed");
            const pastCancelled = bookings.filter((b) => b.status === "cancelled");
            return (
              <>
                <Section title="Įvykusios treniruotės" icon={<CheckCircle2 className="w-4 h-4" />}>
                  {pastAttended.length === 0 ? (
                    <Empty text="Dar nebuvo įvykusių treniruočių" />
                  ) : (
                    <ul className="divide-y divide-gold/5 max-h-96 overflow-auto">
                      {pastAttended.slice().reverse().map((b) => <BookingRow key={b.id} b={b} past />)}
                    </ul>
                  )}
                </Section>

                <Section title="Atšauktos treniruotės" icon={<XCircle className="w-4 h-4" />}>
                  {pastCancelled.length === 0 ? (
                    <Empty text="Atšauktų treniruočių nėra" />
                  ) : (
                    <ul className="divide-y divide-gold/5 max-h-96 overflow-auto">
                      {pastCancelled.slice().reverse().map((b) => <BookingRow key={b.id} b={b} past />)}
                    </ul>
                  )}
                </Section>
              </>
            );
          })()}
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
              {subs.map((s) => {
                const attributedUsed = bookings.filter((b) =>
                  b.subscription_id === s.id &&
                  b.status !== "cancelled" &&
                  b.counts_in_subscription !== false,
                ).length;
                // Honor manually-entered "already used" baseline stored in lessons_used
                const actualUsed = Math.max(attributedUsed, s.lessons_used ?? 0);
                const remaining = s.lessons_total - actualUsed;
                const expDays = Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 86400000);
                const lowRemaining = remaining <= 1 || (expDays <= 7 && expDays >= 0);
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
                      onMarkPaid={markSubPaid}
                      onDelete={undefined}
                      onEditLessons={undefined}
                      lessons={bookings
                        .filter((b) => b.subscription_id === s.id)
                        .map((b) => ({ id: b.id, slot_date: b.slot_date, slot_time: b.slot_time, status: b.status }))}
                    />
                  </div>
                );
              })}
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
              <p className="px-5 pt-3 text-[11px] text-muted-foreground italic">
                Pokalbiai automatiškai ištrinami po 3 dienų nuo paskutinės žinutės.
              </p>
              <ul className="divide-y divide-gold/5 max-h-[500px] overflow-auto mt-2">
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
              <Label htmlFor="sub-type">Tipas</Label>
              <select id="sub-type" value={newSubType} onChange={(e) => setNewSubType(e.target.value as LessonType)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="sportine">Sportinė</option>
                <option value="nesportine">Nesportinė</option>
                <option value="vienkartine">Vienkartinė (1 pamoka)</option>
              </select>
            </div>
            {newSubType !== "vienkartine" && (
            <div>
              <Label htmlFor="sub-lessons">Pamokų skaičius</Label>
              <Input id="sub-lessons" type="number" min={1} max={50} value={newSubLessons}
                onChange={(e) => setNewSubLessons(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground mt-1.5">
                Galioja 30 dienų
              </p>
            </div>
            )}
            <div>
              <Label htmlFor="sub-used">Jau panaudota treniruočių</Label>
              <Input
                id="sub-used"
                type="number"
                min={0}
                max={effLessons}
                value={newSubAlreadyUsed}
                onChange={(e) => setNewSubAlreadyUsed(Math.max(0, parseInt(e.target.value) || 0))}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Jeigu šio abonemento jau buvote panaudoję — įrašykite kiek. Naujam abonementui palikite 0.
              </p>
            </div>
            {unattributedPast.length > 0 && (
              <div className="border border-gold/15 rounded-md p-3 bg-background/30">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Įtraukti į šį abonementą (nuo pirkimo dienos)
                </Label>
                <p className="text-[11px] text-muted-foreground mt-1 mb-2">
                  Pažymėkite jau įvykusias treniruotes (įsk. šiandienos), kurios turėtų skaičiuotis šiame abonemente.
                </p>
                <ul className="space-y-1 max-h-44 overflow-auto">
                  {unattributedPast.map((b) => {
                    const checked = attributeIds.has(b.id);
                    const isToday = b.slot_date === formatDateISO(new Date());
                    return (
                      <li key={b.id}>
                        <label className="flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-1 hover:bg-gold/5">
                          <input
                            type="checkbox"
                            className="accent-gold"
                            checked={checked}
                            onChange={(e) => {
                              setAttributeIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(b.id);
                                else next.delete(b.id);
                                return next;
                              });
                            }}
                          />
                          <span className="tabular-nums">{b.slot_date} · {formatTime(b.slot_time)}</span>
                          {isToday && <span className="text-[10px] uppercase tracking-wider text-gold">šiandien</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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

/* ───────────── Profile overview ───────────── */

function ProfileOverview({
  profile,
  email,
  isLinked,
  activeProfileName,
  futureLessons,
  totalAttended,
  subscriptions,
  onEdit,
  onPassword,
}: {
  profile: AccountProfile | null;
  email: string | null;
  isLinked: boolean;
  activeProfileName: string;
  futureLessons: number;
  totalAttended: number;
  subscriptions: Subscription[];
  onEdit: () => void;
  onPassword: () => void;
}) {
  const fullName = profile?.full_name?.trim() || activeProfileName || "—";
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "—";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "—";
  const defaultScheduleName =
    nameParts.length > 1
      ? `${firstName} ${nameParts[nameParts.length - 1].slice(0, 2)}`
      : firstName;
  const scheduleName = profile?.display_name?.trim() || defaultScheduleName || "—";
  const activeSubscription = subscriptions.find(
    (subscription) =>
      new Date(`${subscription.expires_at}T23:59:59`) >= new Date() &&
      subscription.lessons_used < subscription.lessons_total,
  );
  const lessonsLeft = activeSubscription
    ? Math.max(0, activeSubscription.lessons_total - activeSubscription.lessons_used)
    : 0;

  const details = [
    {
      label: "Vardas",
      value: firstName,
      icon: UserIcon,
    },
    {
      label: "Pavardė",
      value: lastName,
      icon: IdCard,
    },
    {
      label: "El. paštas",
      value: email || "Nenurodytas",
      icon: Mail,
      hint: isLinked ? "Valdančios paskyros el. paštas" : undefined,
    },
    {
      label: "Telefonas",
      value: profile?.phone || "Nenurodytas",
      icon: Phone,
    },
    {
      label: "Grafike rodomas vardas",
      value: scheduleName,
      icon: CalendarDays,
      hint: profile?.display_name
        ? "Jūsų pasirinktas vardas"
        : "Sugeneruota automatiškai iš vardo ir pavardės",
    },
    {
      label: "Aktyvus profilis",
      value: activeProfileName || fullName,
      icon: Sparkles,
      hint: isLinked ? "Valdomas susietas profilis" : "Jūsų pagrindinis profilis",
    },
  ];

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-card p-5 shadow-elegant sm:p-7"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10 text-gold shadow-inner sm:h-20 sm:w-20">
              <span className="font-display text-3xl uppercase sm:text-4xl">
                {firstName.charAt(0)}{lastName !== "—" ? lastName.charAt(0) : ""}
              </span>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[10px] uppercase tracking-[0.22em] text-gold/70">
                Mano paskyra
              </p>
              <h2 className="truncate font-display text-2xl text-gradient-gold sm:text-3xl">
                {fullName}
              </h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                Grafike: <span className="font-medium text-foreground">{scheduleName}</span>
              </p>
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outlineGold" className="w-full sm:w-auto" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Redaguoti informaciją
            </Button>
            <Button variant="outlineGold" className="w-full sm:w-auto" onClick={onPassword}>
              <KeyRound className="h-4 w-4" />
              Keisti slaptažodį
            </Button>
          </div>
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ProfileStat label="Artimiausios treniruotės" value={futureLessons} icon={<CalendarDays className="h-4 w-4" />} />
        <ProfileStat label="Iš viso lankyta" value={totalAttended} icon={<CheckCircle2 className="h-4 w-4" />} />
        <ProfileStat label="Liko abonemente" value={lessonsLeft} icon={<Wallet className="h-4 w-4" />} />
      </div>

      <Section title="Asmeninė informacija" icon={<IdCard className="h-4 w-4" />}>
        <div className="grid grid-cols-1 gap-px bg-gold/10 sm:grid-cols-2">
          {details.map(({ label, value, icon: Icon, hint }) => (
            <div key={label} className="bg-card/95 p-4 sm:p-5">
              <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <Icon className="h-3.5 w-3.5 text-gold" />
                {label}
              </div>
              <div className="break-words text-sm font-medium text-foreground sm:text-base">
                {value}
              </div>
              {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            </div>
          ))}
        </div>
      </Section>

    </div>
  );
}

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
  const [displayName, setDisplayName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile]);

  // Load display_name separately (not in AuthContext profile shape)
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle()
      .then(({ data }) => setDisplayName((data as any)?.display_name ?? ""));
  }, [user]);

  const save = async () => {
    if (!user) return;
    if (name.trim().length < 2) { toast.error("Vardas per trumpas"); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles")
      .update({
        full_name: name.trim(),
        phone: phone.trim() || null,
        display_name: displayName.trim() || null,
      } as any)
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
          <Label htmlFor="pf-display">Vardas tvarkaraštyje</Label>
          <Input
            id="pf-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Palikite tuščią — naudosis numatytas"
          />
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
        <div className="text-muted-foreground tabular-nums">
          {formatTime(b.slot_time)}
          {b.horse_name && (
            <span className="ml-2 text-xs text-gold/80 font-mono">({b.horse_name})</span>
          )}
        </div>
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

export function SubscriptionCard({ s, effectiveUsed, onMarkPaid, onDelete, onEditLessons, extra, lessons }: { s: Subscription; effectiveUsed?: number; onMarkPaid?: (id: string) => void; onDelete?: (id: string) => void; onEditLessons?: (s: Subscription) => void; extra?: React.ReactNode; lessons?: { id: string; slot_date: string; slot_time: string; status: string }[] }) {
  const used = effectiveUsed ?? s.lessons_used;
  const remaining = s.lessons_total - used;
  const expired = new Date(s.expires_at) < new Date();
  const empty = remaining <= 0;
  const [showLessons, setShowLessons] = useState(false);
  const dots = Array.from({ length: Math.min(s.lessons_total, 20) });
  return (
    <div className={cn(
      "p-5 rounded-lg border bg-gradient-card transition-all",
      empty ? "border-destructive/40 shadow-[0_0_30px_-8px_hsl(var(--destructive)/0.3)]" : "border-gold/15",
      expired && "opacity-60",
    )}>
      <div className="mb-2 font-display text-lg text-foreground">
        {s.lessons_total} treniruočių abonementas
      </div>
      <div className="flex items-baseline justify-between mb-3">
        {onEditLessons ? (
          <button
            type="button"
            onClick={() => onEditLessons(s)}
            className="text-3xl font-display text-gradient-gold tabular-nums hover:opacity-80 transition-opacity"
            title="Pakeisti treniruočių skaičių"
          >
            {used}/{s.lessons_total}
          </button>
        ) : (
          <span className="text-3xl font-display text-gradient-gold tabular-nums">
            {used}/{s.lessons_total}
          </span>
        )}
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

      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-hidden>
          {dots.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-2.5 w-2.5 rounded-full border",
                i < used ? "border-gold bg-gold" : "border-gold/40 bg-transparent",
              )}
            />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          {used} / {s.lessons_total} panaudota
        </p>
      </div>

      <div className="text-sm space-y-1 text-muted-foreground">
        {s.lesson_type && (
          <div>Tipas: <span className="text-foreground">{LESSON_TYPE_LABEL[(s.lesson_type as LessonType)] ?? s.lesson_type}</span></div>
        )}
        <div>Pirkta: <span className="text-foreground">{s.purchase_date}</span></div>
        <div>Galioja iki: <span className={cn("text-foreground", expired && "text-destructive")}>{s.expires_at}</span></div>
        <div>Suma: <span className="text-foreground tabular-nums">{Number(s.price).toFixed(2)} €</span></div>
        {(s.sickness_credits ?? 0) > 0 && (
          <div className="text-blush">+{s.sickness_credits} (liga)</div>
        )}
      </div>
      {empty && !expired && (
        <p className="mt-3 text-xs text-destructive font-medium">Pamokos baigėsi — pridėkite naują abonementą</p>
      )}
      {extra && (
        <div className="mt-3 pt-3 border-t border-gold/10">{extra}</div>
      )}

      {lessons && (
        <div className="mt-3 pt-3 border-t border-gold/10">
          <button
            type="button"
            onClick={() => setShowLessons((v) => !v)}
            className="text-xs text-gold hover:underline"
          >
            {showLessons ? "Slėpti treniruotes" : "Peržiūrėti treniruotes"}
          </button>
          {showLessons && (
            lessons.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Šiam abonementui dar nepriskirta treniruočių.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {lessons.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 tabular-nums">
                    <span className="text-foreground/85">{l.slot_date} · {l.slot_time.slice(0, 5)}</span>
                    <span className={cn("text-muted-foreground", l.status === "cancelled" && "text-destructive")}>
                      {l.status === "cancelled" ? "atšaukta" : l.status === "completed" ? "įvykusi" : "suplanuota"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
      {onDelete && (
        <div className="mt-4 pt-3 border-t border-gold/10 flex justify-end">
          <button
            type="button"
            onClick={() => onDelete(s.id)}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors inline-flex items-center gap-1"
            title="Ištrinti šį abonementą"
          >
            <Trash2 className="w-3 h-3" /> Ištrinti
          </button>
        </div>
      )}
    </div>
  );
}

