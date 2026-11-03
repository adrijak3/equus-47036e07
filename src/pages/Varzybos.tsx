import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CalendarDays, ExternalLink, MapPin, Plus, Save, Trophy, UserRound, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EventRow = {
  id: string; title: string; event_date: string; location: string;
  details: string; program_url: string; registration_open: boolean;
};
type EntryRow = {
  id: string; event_id: string; user_id: string; participant_name: string;
  horse_id: string; horse_name: string; height_text: string;
};
type HorseRow = { id: string; name: string; active: boolean };
type Form = { title: string; event_date: string; location: string; program_url: string; details: string; registration_open: boolean };
const emptyForm = (): Form => ({ title: "", event_date: "", location: "", program_url: "", details: "", registration_open: true });

function prettyDate(value: string) {
  return new Intl.DateTimeFormat("lt-LT", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T12:00:00Z"));
}
function safeProgramUrl(value: string): string | null {
  try { const u = new URL(value); return u.protocol === "https:" ? u.href : null; }
  catch { return null; }
}

/** Display-only formatting: preserve the saved height field exactly as entered. */
function formatJumpHeights(value: string): string {
  const raw = value.trim();
  if (!raw) return raw;

  // A list of numbers separated by spaces, dashes, commas or semicolons
  // is displayed as separate jumps, e.g. 20-20-20 -> 20 cm.; 20 cm.; 20 cm.
  const numericList = /^\d+(?:[.,]\d+)?(?:\s*cm)?(?:[\s;\-–/]+\d+(?:[.,]\d+)?(?:\s*cm)?)*$/i;
  if (numericList.test(raw)) {
    const values = [...raw.matchAll(/\d+(?:[.,]\d+)?/g)].map(match => match[0]);
    return values.map((number, index) => number + " cm" + (index < values.length - 1 ? ".;" : "")).join(" ");
  }

  // When a rider writes prose, leave their words and punctuation intact;
  // simply add cm next to numerical heights that do not already have it.
  return raw.replace(/(\d+(?:[.,]\d+)?)(?!\s*cm\b)/gi, "$1 cm");
}

export default function Varzybos() {
  const { user, isAdmin } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [horses, setHorses] = useState<HorseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [chosenHorses, setChosenHorses] = useState<Record<string, string>>({});
  const [heights, setHeights] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<EntryRow | null>(null);

  const load = useCallback(async () => {
    const [e, r, h] = await Promise.all([
      (supabase as any).from("competition_events").select("id,title,event_date,location,details,program_url,registration_open").order("event_date", { ascending: true }),
      (supabase as any).from("competition_entries").select("id,event_id,user_id,participant_name,horse_id,horse_name,height_text"),
      supabase.from("horses").select("id,name,active").order("name"),
    ]);
    if (e.error || r.error || h.error) {
      toast.error(e.error?.message || r.error?.message || h.error?.message || "Nepavyko įkelti varžybų.");
    } else {
      setEvents((e.data ?? []) as unknown as EventRow[]);
      setEntries((r.data ?? []) as unknown as EntryRow[]);
      setHorses((h.data ?? []) as HorseRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveEvent = async () => {
    if (!isAdmin || saving) return;
    if (!form.title.trim() || !form.event_date || !safeProgramUrl(form.program_url)) {
      toast.error("Įrašykite pavadinimą, datą ir pilną HTTPS programos nuorodą.");
      return;
    }
    setSaving(true);
    const values = {
      title: form.title.trim(), event_date: form.event_date, location: form.location.trim(),
      details: form.details.trim(), program_url: form.program_url.trim(), registration_open: form.registration_open,
    };
    const result = editingEvent
      ? await (supabase as any).from("competition_events").update(values).eq("id", editingEvent).select("id")
      : await (supabase as any).from("competition_events").insert({ ...values, created_by: user?.id }).select("id");
    setSaving(false);
    if (result.error || !result.data?.length) { toast.error(result.error?.message ?? "Nepavyko išsaugoti varžybų."); return; }
    toast.success("Varžybos išsaugotos.");
    setShowEventForm(false); setEditingEvent(null); setForm(emptyForm()); await load();
  };

  const editEvent = (event: EventRow) => {
    setEditingEvent(event.id);
    setForm({ title: event.title, event_date: event.event_date, location: event.location, details: event.details, program_url: event.program_url, registration_open: event.registration_open });
    setShowEventForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeEvent = async (event: EventRow) => {
    if (!isAdmin || !window.confirm(`Pašalinti varžybas „${event.title}“ ir visus jų dalyvių įrašus?`)) return;
    const { error } = await (supabase as any).from("competition_events").delete().eq("id", event.id);
    if (error) toast.error(error.message);
    else { toast.success("Varžybos pašalintos."); await load(); }
  };

  const join = async (event: EventRow) => {
    const horseId = chosenHorses[event.id];
    const height = (heights[event.id] ?? "").trim();
    if (!user) { toast.error("Pirma prisijunkite."); return; }
    if (!horseId || !height) { toast.error("Pasirinkite žirgą ir įveskite norimą šokti aukštį."); return; }
    setPending(event.id);
    const { data, error } = editingEntry?.event_id === event.id
      ? await (supabase as any).rpc("competition_update_entry", { _entry_id: editingEntry.id, _horse_id: horseId, _height_text: height })
      : await (supabase as any).rpc("competition_join", { _event_id: event.id, _horse_id: horseId, _height_text: height });
    setPending(null);
    if (error || !data?.ok) toast.error(error?.message ?? "Nepavyko užsiregistruoti.");
    else { toast.success(editingEntry ? "Įrašas atnaujintas." : "Pridėtas naujas žirgo pasirinkimas."); setEditingEntry(null); setChosenHorses(v => ({...v,[event.id]: ""})); setHeights(v => ({...v,[event.id]:""})); await load(); }
  };

  const editOwnEntry = (entry: EntryRow) => {
    setEditingEntry(entry);
    setChosenHorses(current => ({ ...current, [entry.event_id]: entry.horse_id }));
    setHeights(current => ({ ...current, [entry.event_id]: entry.height_text }));
  };
  const removeOwnEntry = async (entry: EntryRow) => {
    if (!window.confirm("Pašalinti šį savo žirgo pasirinkimą iš sąrašo?")) return;
    setPending(entry.event_id);
    const { data, error } = await (supabase as any).rpc("competition_remove_my_entry", { _entry_id: entry.id });
    setPending(null);
    if (error || !data?.ok) { toast.error(error?.message ?? "Nepavyko pašalinti įrašo."); return; }
    if (editingEntry?.id === entry.id) setEditingEntry(null);
    toast.success("Jūsų įrašas pašalintas.");
    await load();
  };
  const removeEntry = async (id: string) => {
    if (!window.confirm("Pašalinti šį dalyvį iš sąrašo?")) return;
    const { data, error } = await (supabase as any).rpc("competition_admin_remove_entry", { _entry_id: id });
    if (error || !data?.ok) toast.error(error?.message ?? "Nepavyko pašalinti.");
    else { toast.success("Dalyvis pašalintas."); await load(); }
  };

  return (
    <div className="container max-w-5xl space-y-8 py-10 sm:py-14">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-gold/80"><Trophy className="h-4 w-4" /> Equus renginiai</div>
        <h1 className="font-display text-4xl text-gradient-gold sm:text-5xl">Varžybos</h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          Artėjančios varžybos ir norinčių dalyvauti sąrašas. Pasirinkite žirgą ir įrašykite aukštį, kurį norėtumėte šokti.
          Dalyvių vardai ir pasirinkimai šiame puslapyje matomi visiems.
        </p>
        <div className="gold-divider max-w-[150px]" />
      </header>

      {isAdmin && (
        <section className="space-y-4">
          <Button variant="gold" onClick={() => {
            if (showEventForm) { setShowEventForm(false); setEditingEvent(null); }
            else { setForm(emptyForm()); setEditingEvent(null); setShowEventForm(true); }
          }}>
            {showEventForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showEventForm ? "Uždaryti" : "Pridėti varžybas"}
          </Button>
          {showEventForm && (
            <div className="space-y-4 rounded-2xl border border-gold/25 bg-gradient-card p-5 sm:p-7">
              <h2 className="font-display text-2xl text-foreground">{editingEvent ? "Redaguoti varžybas" : "Naujos varžybos"}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Pavadinimas</Label><Input maxLength={120} value={form.title} onChange={e => setForm(s => ({ ...s, title: e.target.value }))} placeholder="Pvz. Rudens konkūrai" /></div>
                <div className="space-y-1.5"><Label>Data</Label><Input type="date" value={form.event_date} onChange={e => setForm(s => ({ ...s, event_date: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Vieta</Label><Input maxLength={160} value={form.location} onChange={e => setForm(s => ({ ...s, location: e.target.value }))} placeholder="Žirgynas, miestas" /></div>
                <div className="space-y-1.5"><Label>LiveJumping programos nuoroda</Label><Input type="url" maxLength={1000} value={form.program_url} onChange={e => setForm(s => ({ ...s, program_url: e.target.value }))} placeholder="https://..." /></div>
              </div>
              <div className="space-y-1.5"><Label>Papildoma informacija</Label><Textarea maxLength={1000} value={form.details} onChange={e => setForm(s => ({ ...s, details: e.target.value }))} placeholder="Varžybų informacija (nebūtina)" /></div>
              <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={form.registration_open} onChange={e => setForm(s => ({ ...s, registration_open: e.target.checked }))} /> Priimti norinčiųjų įrašus</label>
              <Button variant="gold" onClick={saveEvent} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Saugoma…" : "Išsaugoti varžybas"}</Button>
            </div>
          )}
        </section>
      )}

      {loading ? <p className="py-14 text-center text-muted-foreground">Kraunamos varžybos…</p> :
      events.length === 0 ? (
        <div className="rounded-2xl border border-gold/15 bg-gradient-card px-6 py-14 text-center">
          <Trophy className="mx-auto mb-3 h-8 w-8 text-gold/60" />
          <p className="font-display text-xl text-foreground">Šiuo metu varžybų nėra</p>
          <p className="mt-2 text-sm text-muted-foreground">Kai administracija paskelbs varžybas, jas matysite čia.</p>
        </div>
      ) : (
        <div className="space-y-9">
          {events.map(event => {
            const eventEntries = entries.filter(e => e.event_id === event.id);
            const groups = new Map<string, EntryRow[]>();
            for (const e of eventEntries) {
              const key = e.horse_id;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(e);
            }
            const sortedGroups = [...groups.entries()].sort((a, b) => (a[1][0]?.horse_name ?? "").localeCompare(b[1][0]?.horse_name ?? "", "lt"));
            const ownEntries = eventEntries.filter(entry => entry.user_id === user?.id);
            const editingThisEvent = editingEntry?.event_id === event.id;
            const past = event.event_date < new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Vilnius" });
            const canJoin = !past && event.registration_open;
            return (
              <motion.section key={event.id} initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.35 }} className="overflow-hidden rounded-3xl border border-gold/20 bg-gradient-card shadow-lg">
                <div className="space-y-4 border-b border-gold/15 p-5 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-gold/80"><CalendarDays className="h-4 w-4" /> {prettyDate(event.event_date)}</div>
                      <h2 className="mt-2 font-display text-2xl text-gradient-gold sm:text-3xl">{event.title}</h2>
                      {event.location && <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-4 w-4" />{event.location}</div>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-gold/20 bg-gold/5 px-3 py-1 text-xs text-gold">{eventEntries.length} norinčių</span>
                      {isAdmin && <><Button variant="outline" size="sm" onClick={() => editEvent(event)}>Redaguoti</Button><Button variant="ghost" size="sm" onClick={() => removeEvent(event)}>Pašalinti</Button></>}
                    </div>
                  </div>
                  {event.details && <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{event.details}</p>}
                  {safeProgramUrl(event.program_url) && (
                    <a href={event.program_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/10">
                      LiveJumping programa <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>

                {user && ownEntries.length > 0 && (
                  <div className="border-b border-border/60 px-5 py-4 sm:px-8">
                    {ownEntries.length > 0 && <div className="space-y-2 rounded-xl border border-border/60 bg-background/25 p-3">
                      <p className="text-xs font-medium text-muted-foreground">Mano pasirinkimai · {ownEntries.length}</p>
                      {ownEntries.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-foreground">{entry.horse_name} <span className="text-muted-foreground">· {formatJumpHeights(entry.height_text)}</span></span>
                        <div className="flex items-center gap-3 text-xs"><button type="button" onClick={() => editOwnEntry(entry)} disabled={!canJoin} className="text-gold hover:underline disabled:opacity-30">Redaguoti</button><button type="button" onClick={() => removeOwnEntry(entry)} className="text-destructive hover:underline">Ištrinti</button></div>
                      </div>)}
                    </div>}
                  </div>
                )}
                {user && canJoin && (
                  <div className="space-y-3 border-b border-gold/15 bg-background/20 p-5 sm:px-8">
                    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-foreground"><UserRound className="h-4 w-4 text-gold" /> {editingThisEvent ? "Redaguoti savo pasirinkimą" : "Pridėti žirgą į norinčiųjų sąrašą"}</div>{editingThisEvent && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setEditingEntry(null); setChosenHorses(v=>({...v,[event.id]:""})); setHeights(v=>({...v,[event.id]:""})); }}>Atšaukti redagavimą</button>}</div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <div className="space-y-1.5">
                        <Label>Žirgas</Label>
                        <select value={chosenHorses[event.id] ?? ""} onChange={e => setChosenHorses(s => ({ ...s, [event.id]: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Pasirinkite žirgą</option>
                          {horses.filter(h => h.active || h.id === editingEntry?.horse_id).map(h => <option key={h.id} value={h.id} disabled={ownEntries.some(e => e.horse_id === h.id && e.id !== editingEntry?.id)}>{h.name}{ownEntries.some(e => e.horse_id === h.id && e.id !== editingEntry?.id) ? " (jau pasirinktas)" : ""}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1.5"><Label>Norimas šokti aukštis</Label><Input value={heights[event.id] ?? ""} maxLength={80} onChange={e => setHeights(s => ({ ...s, [event.id]: e.target.value }))} placeholder="Pvz. 60–80 cm" /></div>
                      <Button variant="gold" disabled={pending === event.id} onClick={() => join(event)}>{editingThisEvent ? "Išsaugoti pakeitimus" : "Pridėti žirgą"}</Button>
                    </div>

                    <p className="text-xs text-muted-foreground">Tai norinčiųjų sąrašas, ne oficiali registracija į varžybas. Jūsų vardas, žirgas ir aukštis bus matomi visiems.</p>
                  </div>
                )}
                {!user && <div className="border-b border-gold/15 px-5 py-4 text-sm text-muted-foreground sm:px-8">Norite įtraukti save? <Link to="/auth" className="font-semibold text-gold underline">Prisijunkite</Link>.</div>}
                {!canJoin && <div className="border-b border-gold/15 px-5 py-3 text-xs text-muted-foreground sm:px-8">Norinčiųjų registracija uždaryta.</div>}

                <div className="space-y-4 p-5 sm:p-8">
                  <div className="flex items-center gap-2"><Trophy className="h-4 w-4 text-gold" /><h3 className="font-display text-xl text-foreground">Varžybų norintys</h3></div>
                  {sortedGroups.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">Dar niekas neužsiregistravo į norinčiųjų sąrašą.</p> : sortedGroups.map(([horseId, group], index) => (
                    <div key={horseId}>
                      {index > 0 && <div className="my-6 flex items-center gap-3 text-gold/55"><div className="h-px flex-1 bg-gold/20"/><span className="text-xs tracking-[0.4em]">✦ · ✦</span><div className="h-px flex-1 bg-gold/20"/></div>}
                      <div className="rounded-xl border border-gold/10 bg-background/25">
                        <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
                          <h4 className="font-display text-lg text-gold">{group[0].horse_name}</h4>
                          <span className="text-xs text-muted-foreground">{group.length} {group.length === 1 ? "raitelis" : "raiteliai"}</span>
                        </div>
                        {group.map((entry, i) => <div key={entry.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${i > 0 ? "border-t border-border/50" : ""}`}>
                          <span className="flex items-center gap-2 font-medium text-foreground">{entry.user_id === user?.id && <CheckCircle2 className="h-4 w-4 text-gold" />}{entry.participant_name}</span>
                          <div className="flex items-center gap-3"><span className="rounded-full bg-gold/10 px-3 py-1 text-xs text-gold">{formatJumpHeights(entry.height_text)}</span>{isAdmin && <button type="button" onClick={() => removeEntry(entry.id)} title="Pašalinti dalyvį" className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4"/></button>}</div>
                        </div>)}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.section>
            );
          })}
        </div>
      )}
    </div>
  );
}
