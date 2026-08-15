import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Search, Trash2, X, Pencil, Save } from "lucide-react";
import { LEVEL_META, type RidingLevel } from "@/lib/levels";
import { useTrainerRoster, riderKey } from "@/components/trainer/useTrainerRoster";

interface PickerCandidate {
  key: string;
  name: string;
  kind: "user" | "guest";
  id: string;
}

export function TrainerRidersTab() {
  const { user } = useAuth();
  const { rows, loading, reload } = useTrainerRoster();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const setLevel = async (id: string, level: RidingLevel) => {
    const { error } = await supabase.from("trainer_riders").update({ level }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    void reload();
  };

  const beginNoteEdit = (id: string, current: string | null) => {
    setEditingNote(id);
    setNoteDraft(current ?? "");
  };

  const saveNote = async (id: string) => {
    const { error } = await supabase.from("trainer_riders").update({ note: noteDraft.trim() || null }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEditingNote(null);
    toast.success("Pastaba išsaugota");
    void reload();
  };

  const removeRider = async (id: string, name: string) => {
    if (!confirm(`Pašalinti ${name} iš jūsų raitelių sąrašo? Profilis ir treniruotės nebus ištrinti.`)) return;
    const { error } = await supabase.from("trainer_riders").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Pašalinta iš sąrašo");
    void reload();
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gold/15 bg-gradient-card p-4">
        <p className="text-sm text-muted-foreground">
          Čia matote tik savo raitelius. Raiteliai, kurių čia nėra, visur laikomi{" "}
          <strong className="text-foreground">pradedančiaisiais</strong>.
        </p>
      </section>

      <Button variant="gold" className="h-12 w-full text-base" onClick={() => setPickerOpen(true)}>
        <Plus className="h-5 w-5" /> Pridėti raitelį
      </Button>

      {loading ? (
        <p className="py-8 text-center italic text-muted-foreground">Kraunama…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center italic text-muted-foreground">Kol kas nė vieno raitelio nepridėjote.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-gold/15 bg-gradient-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{r.name}</span>
                    {r.guest?.is_newcomer && (
                      <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                        naujokė
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeRider(r.id, r.name)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Pašalinti iš sąrašo"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {(Object.keys(LEVEL_META) as RidingLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLevel(r.id, lvl)}
                    className={`h-10 rounded-full border px-4 text-sm transition ${
                      r.level === lvl ? LEVEL_META[lvl].cls : "border-border text-muted-foreground"
                    }`}
                  >
                    {LEVEL_META[lvl].emoji} {LEVEL_META[lvl].label}
                  </button>
                ))}
              </div>

              {editingNote === r.id ? (
                <div className="mt-3 space-y-2">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    maxLength={300}
                    placeholder="Trumpa pastaba apie raitelį…"
                    className="min-h-20"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" className="h-10" onClick={() => setEditingNote(null)}>
                      <X className="h-4 w-4" /> Atšaukti
                    </Button>
                    <Button variant="gold" className="h-10" onClick={() => saveNote(r.id)}>
                      <Save className="h-4 w-4" /> Išsaugoti
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {r.note || <span className="italic">Pastabų nėra</span>}
                  </p>
                  <button
                    onClick={() => beginNoteEdit(r.id, r.note)}
                    className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-gold/10 hover:text-gold"
                    aria-label="Redaguoti pastabą"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pickerOpen && (
        <RiderPicker
          existingKeys={new Set(rows.map((r) => riderKey(r.rider_user_id, r.guest_rider_id)))}
          onClose={() => setPickerOpen(false)}
          onAdded={() => { setPickerOpen(false); void reload(); }}
        />
      )}
    </div>
  );
}

function RiderPicker({
  existingKeys,
  onClose,
  onAdded,
}: {
  existingKeys: Set<string | null>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PickerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setCandidates([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const [{ data: profs }, { data: guests }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").ilike("full_name", `%${q}%`).limit(15),
        supabase.from("guest_riders").select("id, first_name, last_name").limit(50),
      ]);
      if (cancelled) return;
      const guestMatches = (guests ?? []).filter((g: any) =>
        `${g.first_name} ${g.last_name}`.toLowerCase().includes(q.toLowerCase())
      );
      const list: PickerCandidate[] = [
        ...(profs ?? []).map((p: any) => ({ key: `u:${p.id}`, name: p.full_name ?? "—", kind: "user" as const, id: p.id })),
        ...guestMatches.map((g: any) => ({ key: `g:${g.id}`, name: `${g.first_name} ${g.last_name}`.trim(), kind: "guest" as const, id: g.id })),
      ].filter((c) => !existingKeys.has(c.key));
      setCandidates(list);
      setSearching(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const add = async (c: PickerCandidate) => {
    if (!user) return;
    setAdding(c.key);
    const { error } = await supabase.from("trainer_riders").insert({
      trainer_user_id: user.id,
      rider_user_id: c.kind === "user" ? c.id : null,
      guest_rider_id: c.kind === "guest" ? c.id : null,
      level: "beginner",
    } as any);
    setAdding(null);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "Šis raitelis jau yra jūsų sąraše." : error.message);
      return;
    }
    toast.success("Raitelis pridėtas");
    onAdded();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-gold/20 bg-card p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg text-foreground">Pridėti raitelį</h3>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-gold/10" aria-label="Uždaryti">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="h-12 pl-9 text-base"
            placeholder="Vardas, pavardė…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <ul className="mt-3 space-y-2">
          {searching && <p className="py-4 text-center text-sm italic text-muted-foreground">Ieškoma…</p>}
          {!searching && query.trim().length >= 2 && candidates.length === 0 && (
            <p className="py-4 text-center text-sm italic text-muted-foreground">Nieko nerasta.</p>
          )}
          {!searching && query.trim().length < 2 && (
            <p className="py-4 text-center text-sm italic text-muted-foreground">Įveskite bent 2 raidžių paieškai.</p>
          )}
          {candidates.map((c) => (
            <li key={c.key}>
              <button
                onClick={() => void add(c)}
                disabled={adding === c.key}
                className="flex h-14 w-full items-center justify-between rounded-lg border border-gold/15 bg-background/40 px-4 text-left text-base hover:border-gold/40 disabled:opacity-50"
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{c.kind === "guest" ? "svečias" : "registruotas"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
