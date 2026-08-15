import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatDateISO } from "@/lib/equus";
import { AlertCircle, X } from "lucide-react";

interface Row { id: string; name: string; reason: string; }

export function SubscriptionReminders({ onFocusUser, onShowAll }: { onFocusUser: (userId: string) => void; onShowAll: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    (async () => {
      const today = formatDateISO(new Date());
      const in7 = formatDateISO(new Date(Date.now() + 7 * 86400000));
      const { data } = await supabase
        .from("subscriptions")
        .select("id, user_id, lessons_total, lessons_used, expires_at, paid")
        .not("user_id", "is", null)
        .gte("expires_at", today);
      const subs = (data ?? []) as any[];
      const flagged = subs.filter((s) =>
        (s.lessons_total - s.lessons_used) <= 1 || s.expires_at <= in7 || !s.paid
      );
      const ids = Array.from(new Set(flagged.map((s) => s.user_id)));
      let nameMap: Record<string, string> = {};
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        nameMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
      }
      const list: Row[] = flagged.map((s) => {
        const remaining = s.lessons_total - s.lessons_used;
        const reasons: string[] = [];
        if (remaining <= 1) reasons.push(remaining <= 0 ? "baigėsi treniruotės" : "liko 1 treniruotė");
        if (s.expires_at <= in7) reasons.push("baigiasi galiojimas");
        if (!s.paid) reasons.push("neapmokėta");
        return { id: s.id, name: nameMap[s.user_id] ?? "—", reason: reasons.join(", ") };
      });
      setTotal(list.length);
      setRows(list.slice(0, 6));
    })();
  }, []);

  if (dismissed || rows.length === 0) return null;

  return (
    <div className="bg-gradient-card border border-gold/25 rounded-lg p-4 space-y-2 relative">
      <button onClick={() => setDismissed(true)} className="absolute top-3 right-3 text-muted-foreground hover:text-gold">
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 pr-6">
        <AlertCircle className="w-4 h-4 text-gold" />
        <h3 className="font-display text-lg text-gradient-gold">Abonementų priminimas</h3>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onFocusUser(r.id)}
              className="w-full text-left text-sm px-3 py-1.5 rounded border border-gold/10 hover:border-gold/40 flex items-center justify-between gap-2"
            >
              <span className="truncate">{r.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{r.reason}</span>
            </button>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <Button variant="ghost" size="sm" onClick={onShowAll}>Rodyti visus ({total})</Button>
      )}
    </div>
  );
}
