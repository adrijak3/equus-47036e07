import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserDuplicateBookings } from "@/components/UserDuplicateBookings";
import { Input } from "@/components/ui/input";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

type Profile = { id: string; full_name: string | null };
type PotentialDuplicate = { userId: string; date: string; time: string; count: number };

export function AdminDuplicateBookings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [duplicates, setDuplicates] = useState<PotentialDuplicate[]>([]);
  const [scanLoading, setScanLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, full_name")
        .order("full_name", { ascending: true });

      if (error) {
        toast.error("Nepavyko užkrauti vartotojų sąrašo.");
      } else {
        setProfiles((data ?? []) as Profile[]);
      }
      setLoading(false);
    })();
  }, []);

  const scanForDuplicates = async () => {
    setScanLoading(true);
    const start = new Date();
    start.setDate(start.getDate() - 14);
    const iso = [start.getFullYear(), String(start.getMonth() + 1).padStart(2, "0"), String(start.getDate()).padStart(2, "0")].join("-");
    const { data, error } = await supabase
      .from("bookings")
      .select("id,user_id,slot_date,slot_time,status")
      .gte("slot_date", iso)
      .in("status", ["active", "pending_cancel", "completed"])
      .not("user_id", "is", null)
      .order("slot_date", { ascending: false })
      .limit(5000);
    if (error) {
      toast.error("Nepavyko patikrinti pasikartojančių rezervacijų.");
      setScanLoading(false);
      return;
    }
    const groups = new Map<string, PotentialDuplicate>();
    for (const booking of data ?? []) {
      if (!booking.user_id) continue;
      const key = [booking.user_id, booking.slot_date, booking.slot_time].join("|");
      const previous = groups.get(key);
      if (previous) previous.count++;
      else groups.set(key, { userId: booking.user_id, date: booking.slot_date, time: booking.slot_time, count: 1 });
    }
    setDuplicates([...groups.values()].filter((group) => group.count > 1)
      .sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time)));
    setScanLoading(false);
  };

  useEffect(() => { void scanForDuplicates(); }, []);

  const filtered = profiles.filter((p) =>
    (p.full_name ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-semibold">Pasikartojantys laikai</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pasirinkite vartotoją ir peržiūrėkite galimus senus dublikuotus laikus.
        </p>
      </div>

      <section className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Automatinė patikra</h3>
            <p className="text-xs text-muted-foreground">Pastarųjų 14 dienų ir būsimų rezervacijų sutampantys laikai</p>
          </div>
          <button type="button" onClick={() => void scanForDuplicates()} disabled={scanLoading}
            className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60">
            {scanLoading ? "Tikrinama…" : "Tikrinti dar kartą"}
          </button>
        </div>
        {!scanLoading && duplicates.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Galimų dubliuotų rezervacijų nerasta.</p>}
        {!scanLoading && duplicates.length > 0 && (
          <div className="mt-3 max-h-60 divide-y divide-border overflow-y-auto">
            {duplicates.map((duplicate) => (
              <button key={duplicate.userId + duplicate.date + duplicate.time}
                onClick={() => {
                  const profile = profiles.find((p) => p.id === duplicate.userId);
                  if (profile) setSelected(profile);
                }}
                className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-primary">
                <span>{profiles.find((p) => p.id === duplicate.userId)?.full_name ?? "Raitelis"} · {duplicate.date} · {duplicate.time.slice(0, 5)}</span>
                <span className="shrink-0 font-medium">{duplicate.count} įrašai</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Patikra tik parodo galimus sutapimus. Rezervacijų automatiškai netrina.</p>
      </section>

      <Input
        placeholder="Ieškoti vartotojo…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background/30 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Kraunama…
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => setSelected(profile)}
              className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-colors ${
                selected?.id === profile.id
                  ? "border-gold/50 bg-gold/10"
                  : "border-border bg-background/40 hover:bg-muted/40"
              }`}
            >
              <Users className="h-4 w-4 flex-shrink-0 text-gold" />
              <span className="min-w-0 truncate">
                {profile.full_name || "Be vardo"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && <UserDuplicateBookings key={selected.id} userId={selected.id} />}
    </div>
  );
}