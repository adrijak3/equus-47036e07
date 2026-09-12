import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Search, ClipboardPenLine, History } from "lucide-react";
import { UserProfileSheet } from "@/components/admin/UserProfileSheet";

interface Profile { id: string; full_name: string; phone: string | null; }

export function AdminGlobalSearch({ onGo }: { onGo: (section: string, query: string) => void }) {
  const [q, setQ] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, full_name, phone").order("full_name");
      setProfiles((data ?? []) as Profile[]);
    })();
  }, []);

  // Any 1+ character query shows matches right away — no reason to make people
  // type a minimum before they see anything.
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 1) return [];
    return profiles
      .filter((p) => p.full_name.toLowerCase().includes(term) || (p.phone ?? "").includes(term))
      .slice(0, 8);
  }, [q, profiles]);

  const openProfile = (p: Profile) => {
    setOpenId(p.id);
    setOpenName(p.full_name);
  };

  return (
    <div className="mb-5 rounded-lg border border-gold/15 bg-gradient-card p-3 shadow-elegant">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold/60" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ieškoti vartotojo..."
          className="pl-9"
          aria-label="Ieškoti vartotojo"
        />
      </div>

      {q.trim().length >= 1 && (
        <div className="mt-2">
          {results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => openProfile(p)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gold/5"
                  >
                    <span className="truncate">{p.full_name}</span>
                    <span className="text-xs text-muted-foreground">{p.phone ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cn("px-1 text-xs text-muted-foreground")}>Vartotojų nerasta.</p>
          )}
        </div>
      )}

      {/* Everything about the user (profile, subs, permanent times, holidays, lessons, actions)
          lives in one shared popup — the same one used from the Vartotojai table. */}
      <UserProfileSheet
        userId={openId}
        open={!!openId}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
      />

      {openId && (
        <div className="mt-3 flex items-center gap-2 border-t border-gold/10 pt-3">
          <span className="text-xs text-muted-foreground">Daugiau apie {openName}:</span>
          <Button variant="ghost" size="sm" onClick={() => onGo("registrations", openName)}>
            <ClipboardPenLine className="w-3.5 h-3.5" /> Registracijos
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onGo("cancels", openName)}>
            <History className="w-3.5 h-3.5" /> Atšaukimai
          </Button>
        </div>
      )}
    </div>
  );
}
