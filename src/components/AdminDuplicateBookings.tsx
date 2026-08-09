import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserDuplicateBookings } from "@/components/UserDuplicateBookings";
import { Input } from "@/components/ui/input";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

type Profile = { id: string; full_name: string | null };

export function AdminDuplicateBookings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);

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